import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { initialModel, newWindow, walkPanes } from '../src/main/model'
import { writeModel } from '../src/main/store'
import { closeTestApplication } from './electron-fixture'

let fixture = async (lazyRestore = true) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-startup-restore-'))
  let requests = new Map<string, number>(), cookies = new Map<string, string>()
  let server = http.createServer((request, response) => {
    let pathname = new URL(request.url!, 'http://fixture').pathname
    requests.set(pathname, (requests.get(pathname) ?? 0) + 1)
    cookies.set(pathname, request.headers.cookie ?? '')
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    response.end('<!doctype html><title>Restore fixture</title><h1>Restored fixture</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  // A public-shaped hostname exercises safety checks; Chromium maps it only to this fixture.
  let url = `http://restore.bmux.org:${(server.address() as net.AddressInfo).port}`
  let model = initialModel(), session = model.sessions[0], bot = model.profiles[1]
  model.profiles.push({ id: 'profile_guard', name: 'guard', background: true })
  session.windows[0].panes[0].url = `${url}/ordinary`
  let add = (name: string, profile = bot.id, keepAlive = false) => {
    let window = newWindow(name, profile, false, model)
    session.windows.push(window)
    window.panes[0].url = `${url}/${name}`
    window.panes[0].keepAlive = keepAlive
    return { window, pane: window.panes[0] }
  }
  let first = add('first'), sibling = add('sibling'), kept = add('kept', bot.id, true), guard = add('guard', 'profile_guard')
  writeModel(directory, model)
  await fs.writeFile(path.join(directory, 'config.yaml'), `browser:\n  autoUpdateFilters: false\nmemory:\n  lazyRestore: ${lazyRestore}\n`)
  let application: ElectronApplication | undefined, child: ChildProcess | undefined
  let socket = path.join('/tmp', `bmux-${process.getuid?.() ?? 'user'}`, `${createHash('sha256').update(directory).digest('hex').slice(0, 16)}.sock`)
  // Address only the disposable application's socket; the CLI's auto-start fallback is unnecessary.
  let rpc = (method: string, args: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    let connection = net.createConnection(socket), response = ''
    connection.setEncoding('utf8'); connection.setTimeout(10000)
    connection.on('connect', () => connection.write(JSON.stringify({ method, args: { agentId: 'test-agent', ...args } }) + '\n'))
    connection.on('data', chunk => { response += chunk })
    connection.on('timeout', () => connection.destroy(new Error('Fixture control socket timed out')))
    connection.on('error', reject)
    connection.on('end', () => {
      try {
        let value = JSON.parse(response)
        if (!value.ok) throw new Error(value.error)
        resolve(value.result)
      } catch (error) { reject(error) }
    })
  })
  let launch = async (optIn?: string, background = true) => {
    application = await electron.launch({ args: [process.cwd(), ...(background ? ['--background'] : []), '--host-resolver-rules=MAP restore.bmux.org 127.0.0.1', '--no-proxy-server'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: background ? '1' : '0', BROWMUX_BACKGROUND: '0', BMUX_LAZY_RESTORE_BACKGROUND: optIn ?? '', BMUX_REMOTE_CONFIG: '', BMUX_REQUIRED_PROXY: '' } })
    child = application.process()
    await expect.poll(() => rpc('diagnostics').then(value => value.pid).catch(() => null), { timeout: 20000 }).toBe(child.pid)
    return application
  }
  let stop = async () => {
    await closeTestApplication(application, child)
    application = undefined; child = undefined
  }
  let cleanup = async () => {
    try { await stop() } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
  let contents = async (paneId: string) => (await rpc('memory')).current.panes.find((pane: { paneId: string }) => pane.paneId === paneId).webContentsId
  return { directory, url, model, bot, first, sibling, kept, guard, requests, cookies, launch, stop, cleanup, rpc, contents }
}

test('headless background restore opt-in preserves state and wakes only addressed panes through guards', async () => {
  let f = await fixture()
  try {
    // Establish real persistent Chromium cookies before the opt-in cold start.
    let application = await f.launch()
    await expect.poll(() => f.requests.get('/first') ?? 0).toBe(1)
    await expect.poll(() => f.requests.get('/sibling') ?? 0).toBe(1)
    await expect.poll(() => f.requests.get('/kept') ?? 0).toBe(1)
    await expect.poll(() => f.requests.get('/guard') ?? 0).toBe(1)
    expect(await f.contents(f.model.sessions[0].windows[0].panes[0].id)).toBeNull()
    await application.evaluate(async ({ session }, { profile, url }) => {
      let browser = session.fromPartition(`persist:${profile}`)
      await browser.cookies.set({ url, name: 'restore', value: 'persisted', expirationDate: Date.now() / 1000 + 3600 })
      await browser.cookies.flushStore()
    }, { profile: f.bot.id, url: f.url })
    await f.stop()
    f.requests.clear(); f.cookies.clear()
    let now = Date.now()
    let safety = { [JSON.stringify(['profile_guard', 'restore.bmux.org'])]: { profileId: 'profile_guard', siteHost: 'restore.bmux.org', startedAt: now - 10000, lastUsed: now - 10000, warning: 'challenge', warningHost: 'restore.bmux.org', warningAt: now - 5000, actors: [{ paneId: f.guard.pane.id, agentId: 'test-agent', hosts: ['restore.bmux.org'] }] } }
    let ledger = JSON.stringify({ [`fixture:${f.bot.id}`]: [{ kind: 'run', at: now - 60000 }] })
    let safetyFile = path.join(f.directory, 'automation-safety.json'), ledgerFile = path.join(f.directory, 'automation-ledger.json')
    await fs.writeFile(safetyFile, JSON.stringify(safety))
    await fs.writeFile(ledgerFile, ledger)
    let preview = { image: 'data:image/jpeg;base64,/9j/2Q==', capturedAt: now, windowId: f.first.window.id, profileId: f.bot.id }
    await fs.mkdir(path.join(f.directory, 'previews'), { recursive: true })
    let previewFile = path.join(f.directory, 'previews', `${encodeURIComponent(f.first.pane.id)}.json`)
    await fs.writeFile(previewFile, JSON.stringify(preview))

    await f.launch('1')
    let state = await f.rpc('state')
    expect(state.configError).toBeNull()
    expect(state.model.clients).toEqual([])
    expect(walkPanes(state.model).map(({ session, window, pane }) => [session.id, window.id, pane.id, pane.profileId])).toEqual(walkPanes(f.model).map(({ session, window, pane }) => [session.id, window.id, pane.id, pane.profileId]))
    expect(state.model.profiles.map((profile: { id: string }) => profile.id)).toEqual(f.model.profiles.map(profile => profile.id))
    expect(state.snapshots[f.first.pane.id]).toEqual({ image: preview.image, capturedAt: now })
    expect(JSON.parse(await fs.readFile(previewFile, 'utf8'))).toEqual(preview)
    expect(await fs.readFile(safetyFile, 'utf8')).toBe(JSON.stringify(safety))
    expect(await fs.readFile(ledgerFile, 'utf8')).toBe(ledger)
    await expect.poll(() => f.requests.get('/kept') ?? 0).toBe(1)
    expect(await f.contents(f.kept.pane.id)).not.toBeNull()
    for (let target of [f.first, f.sibling, f.guard]) {
      expect(await f.contents(target.pane.id)).toBeNull()
      expect(f.requests.get(new URL(target.pane.url).pathname) ?? 0).toBe(0)
    }

    expect(await f.rpc('dom', { tab: f.first.pane.id })).toContain('Restored fixture')
    expect(await f.rpc('eval', { tab: f.first.pane.id, expression: 'document.cookie' })).toBe('restore=persisted')
    expect(f.cookies.get('/first')).toBe('restore=persisted')
    expect(await f.contents(f.first.pane.id)).not.toBeNull()
    expect(await f.contents(f.sibling.pane.id)).toBeNull()
    expect(f.requests.get('/first')).toBe(1)
    expect(f.requests.get('/sibling') ?? 0).toBe(0)
    // Existing safety inspection can restore the guarded page, but its requested code must not run.
    await expect(f.rpc('eval', { tab: f.guard.pane.id, expression: 'fetch("/forbidden")' })).rejects.toThrow('Automation paused: challenge on restore.bmux.org')
    expect(f.requests.get('/forbidden') ?? 0).toBe(0)
    expect(f.cookies.get('/guard')).toBe('')
    expect(JSON.parse(await fs.readFile(safetyFile, 'utf8'))[JSON.stringify(['profile_guard', 'restore.bmux.org'])]).toEqual(Object.values(safety)[0])
    expect(await fs.readFile(ledgerFile, 'utf8')).toBe(ledger)
    expect((await f.rpc('state')).model.clients).toEqual([])
  } finally { await f.cleanup() }
})

for (let scenario of [
  { name: 'legacy headless default', optIn: undefined, lazyRestore: true, background: true, ordinaryLive: false },
  { name: 'non-opt-in value', optIn: 'true', lazyRestore: true, background: true, ordinaryLive: false },
  { name: 'lazyRestore=false', optIn: '1', lazyRestore: false, background: true, ordinaryLive: true },
  { name: 'foreground launch', optIn: '1', lazyRestore: true, background: false, ordinaryLive: true },
]) test(`background startup restore retains ${scenario.name}`, async () => {
  let f = await fixture(scenario.lazyRestore)
  try {
    await f.launch(scenario.optIn, scenario.background)
    for (let target of [f.first, f.sibling, f.kept, f.guard]) {
      await expect.poll(() => f.requests.get(new URL(target.pane.url).pathname) ?? 0).toBe(1)
      expect(await f.contents(target.pane.id)).not.toBeNull()
    }
    let ordinary = f.model.sessions[0].windows[0].panes[0]
    if (scenario.ordinaryLive) await expect.poll(() => f.requests.get('/ordinary') ?? 0).toBe(1)
    expect((await f.contents(ordinary.id)) !== null).toBe(scenario.ordinaryLive)
  } finally { await f.cleanup() }
})
