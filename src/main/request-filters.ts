import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Worker } from 'node:worker_threads'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import type { Session, OnBeforeRequestListenerDetails } from 'electron'
import { pageOrigin, siteSettings } from '../shared/browser-tools'
import type { BlockedRequest, BrowserSettings, BrowserToolsState } from '../shared/browser-tools'

export let FILTER_SOURCES = ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt']
type Options = { resources: string; directory: string; settings: () => BrowserSettings; changed: () => void; context: (contentsId: number) => { tabId: string; url: string } | undefined }
export let createRequestFilters = (options: Options) => {
  let engine = FiltersEngine.empty(), custom = FiltersEngine.empty(), rules = ''
  let updatedAt = 0, updating = false, error: string | undefined, closed = false
  let network = 0, cosmetic = 0
  let counters = new Map<string, { blocked: number; recent: BlockedRequest[] }>()
  let sessions = new Set<Session>(), worker: Worker | undefined, controller: AbortController | undefined
  let cached = path.join(options.directory, 'adblock.bin.gz')
  let metadata = path.join(options.directory, 'adblock.json')
  let accept = (data: Uint8Array, timestamp: number) => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Invalid filter date')
    let next = FiltersEngine.deserialize(gunzipSync(data, { maxOutputLength: 64_000_000 }))
    let filters = next.getFilters()
    if (!filters.networkFilters.length) throw new Error('Empty filter list')
    engine = next; updatedAt = timestamp; network = filters.networkFilters.length; cosmetic = filters.cosmeticFilters.length
  }
  try { accept(fs.readFileSync(cached), JSON.parse(fs.readFileSync(metadata, 'utf8')).updatedAt) }
  catch {
    try { accept(fs.readFileSync(path.join(options.resources, 'adblock.bin.gz')), JSON.parse(fs.readFileSync(path.join(options.resources, 'adblock.json'), 'utf8')).updatedAt) }
    catch { error = 'Filter snapshot unavailable. Update filters to enable list blocking.' }
  }
  let refresh = () => {
    let next = options.settings().rules.join('\n')
    if (next !== rules) { custom = FiltersEngine.parse(next, { loadExtendedSelectors: false }); rules = next }
  }
  refresh()
  let match = (details: Pick<OnBeforeRequestListenerDetails, 'url' | 'resourceType' | 'referrer'>) => {
    let request = Request.fromRawDetails({ url: details.url, type: details.resourceType, sourceUrl: details.referrer })
    let own = custom.match(request)
    // Explicit custom exceptions take precedence over the bundled lists.
    return own.exception ? false : own.match || engine.match(request).match
  }
  let attach = (session: Session, profileId: string) => {
    if (sessions.has(session)) return
    sessions.add(session)
    session.webRequest.onBeforeRequest((details, reply) => {
      try {
        let context = details.webContentsId ? options.context(details.webContentsId) : undefined
        let page = details.resourceType === 'mainFrame' ? details.url : context?.url || details.referrer
        if (!pageOrigin(page) || !siteSettings(options.settings(), profileId, page).adblock || details.resourceType === 'mainFrame') { reply({}); return }
        let blocked = match(details)
        if (blocked && context) {
          let record = counters.get(context.tabId) ?? { blocked: 0, recent: [] }
          record.blocked++
          // Hosts and resource types are sufficient for inspection; never retain query strings.
          record.recent.unshift({ host: new URL(details.url).host, type: details.resourceType, time: Date.now() })
          record.recent = record.recent.slice(0, 50)
          counters.set(context.tabId, record); options.changed()
        }
        reply({ cancel: blocked })
      } catch { reply({}) }
    })
  }
  let update = async () => {
    if (updating || closed) return
    updating = true; error = undefined; controller = new AbortController(); options.changed()
    let timeout = setTimeout(() => { controller?.abort(); void worker?.terminate() }, 45000)
    try {
      let texts = await Promise.all(FILTER_SOURCES.map(async url => {
        let response = await fetch(url, { signal: controller!.signal })
        if (!response.ok) throw new Error('Filter download failed')
        let chunks: Uint8Array[] = [], size = 0
        for await (let chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length
          if (size > 12_000_000) throw new Error('Filter list too large')
          chunks.push(chunk)
        }
        let text = Buffer.concat(chunks).toString('utf8')
        if (!text.startsWith('[Adblock Plus') || text.length < 10000) throw new Error('Invalid filter list')
        return text
      }))
      if (closed) return
      let data = await new Promise<Uint8Array>((resolve, reject) => {
        worker = new Worker(new URL('./filter-worker.js', import.meta.url), { workerData: { texts } })
        worker.once('message', message => message.data ? resolve(message.data) : reject(new Error('Filter compilation failed')))
        worker.once('error', reject)
        worker.once('exit', () => reject(new Error('Filter worker stopped')))
      })
      if (closed) return
      accept(data, Date.now())
      fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 })
      fs.writeFileSync(`${cached}.tmp`, data, { mode: 0o600 }); fs.renameSync(`${cached}.tmp`, cached)
      fs.writeFileSync(`${metadata}.tmp`, JSON.stringify({ updatedAt }), { mode: 0o600 }); fs.renameSync(`${metadata}.tmp`, metadata)
      error = undefined
    } catch { if (!closed) error = 'Filter update failed. Keeping the last working lists.' }
    finally { clearTimeout(timeout); void worker?.terminate(); worker = undefined; controller = undefined; updating = false; options.changed() }
  }
  let timer = setInterval(() => { if (options.settings().autoUpdateFilters && Date.now() - updatedAt > 7 * 86400000) void update() }, 3600000)
  timer.unref()
  let initial = setTimeout(() => { if (options.settings().autoUpdateFilters && Date.now() - updatedAt > 7 * 86400000) void update() }, 5000)
  initial.unref()
  return {
    attach, refresh, match, update,
    status: (): BrowserToolsState['filters'] => ({ updatedAt, updating, error, network, cosmetic }),
    counts: (tabId: string) => counters.get(tabId) ?? { blocked: 0, recent: [] },
    reset: (tabId: string) => { counters.delete(tabId) },
    styles: (url: string, ids: string[] = [], classes: string[] = []) => {
      if (!pageOrigin(url)) return ''
      let request = Request.fromRawDetails({ url })
      let query = { url, hostname: request.hostname, domain: request.domain, ids, classes, getBaseRules: true, getInjectionRules: false, getExtendedRules: false, getRulesFromDOM: true, getRulesFromHostname: true }
      return engine.getCosmeticsFilters(query).styles + '\n' + custom.getCosmeticsFilters(query).styles
    },
    close: () => { closed = true; clearInterval(timer); clearTimeout(initial); controller?.abort(); void worker?.terminate(); for (let session of sessions) session.webRequest.onBeforeRequest(null); sessions.clear() },
  }
}
