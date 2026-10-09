import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import type { WebContents } from 'electron'
import { matchesUrl, pageOrigin, siteSettings } from '../shared/browser-tools'
import type { BrowserSettings, BrowserToolsState, UserScript } from '../shared/browser-tools'
import { createKeyboardFocus } from './keyboard-focus'
import { cosmeticTokens, createFrameCosmetics } from './frame-cosmetics'

type Script = UserScript & { source: string; error?: string }
type Target = { focus: ReturnType<typeof createKeyboardFocus>; contents: WebContents; profileId: string; registrations: string[]; registeredSources?: string; ready: Promise<void>; closed: boolean; version: number; styles: Partial<Record<'ads' | 'users', { css: string; key?: string }>>; styleWork: Promise<void>; frames?: ReturnType<typeof createFrameCosmetics>; busy?: boolean; error?: string; timer?: ReturnType<typeof setInterval> }
type Options = { directory: string; settings: () => BrowserSettings; changed: () => void; visible: (contentsId: number) => boolean; adblock?: (contentsId: number) => boolean | undefined; styles: (url: string, ids: string[], classes: string[]) => string }
let require = createRequire(import.meta.url)
let reader = fs.readFileSync(require.resolve('darkreader'), 'utf8')
let world = 'bmux:appearance'

export let createPageTools = (options: Options) => {
  let targets = new Map<string, Target>(), scripts: Script[] = [], watched = new Set<string>(), closed = false
  let send = async (target: Target, method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    if (target.closed || target.contents.isDestroyed()) throw new Error('Tab closed')
    if (!target.contents.debugger.isAttached()) target.contents.debugger.attach('1.3')
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([target.contents.debugger.sendCommand(method, params, sessionId), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Page tools timed out')), 3000) })]) }
    catch (error) {
      // Retain command/cause diagnostics without exposing URLs or script source.
      let message = error instanceof Error ? error.message : ''
      let cause = /script.*not found|no script.*identifier/i.test(message) ? 'missing script' : /timed out/i.test(message) ? 'timeout' : /context|frame/i.test(message) ? 'document changed' : 'command rejected'
      throw new Error(`${method}: ${cause}`)
    }
    finally { clearTimeout(timer) }
  }
  let appearanceSource = (profileId: string) => {
    let config = options.settings(), profile = config.profiles[profileId]
    let needed = config.darkMode !== 'off' || (profile?.darkMode && profile.darkMode !== 'off') || Object.values(profile?.sites ?? {}).some(site => site.darkMode && site.darkMode !== 'off')
    return `(() => {
      if (!/^https?:$/.test(location.protocol)) return;
      let apply = () => {
      let profile = ${JSON.stringify(profile ?? { sites: {} })};
      let mode = profile.sites[location.origin]?.darkMode ?? profile.darkMode ?? ${JSON.stringify(config.darkMode)};
      if (mode === 'off' && !globalThis.DarkReader) return;
      // Patch only this isolated world's style factory, preserving the page's CSP.
      if (!globalThis.__bmuxStyleFactory) {
        let create = document.createElement.bind(document);
        document.createElement = (tag, options) => {
          let element = create(tag, options);
          if (tag.toLowerCase() === 'style') {
            let nonce = document.querySelector('style[nonce],script[nonce]')?.nonce;
            if (nonce) element.nonce = nonce;
          }
          return element;
        };
        globalThis.__bmuxStyleFactory = true;
      }
      if (!globalThis.DarkReader) { ${needed ? reader : ''}\n }
      if (globalThis.__bmuxDarkMode === mode) return;
      globalThis.__bmuxDarkMode = mode;
      DarkReader.auto(false);
      if (mode === 'system') DarkReader.auto({ brightness: 100, contrast: 100 });
      else if (mode === 'dark') DarkReader.enable({ brightness: 100, contrast: 100 });
      else DarkReader.disable();
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true }); else apply();
    })()`
  }
  let scriptSource = (profileId: string) => {
    let selected = scripts.filter(script => script.enabled && script.kind === 'js' && (!script.profiles.length || script.profiles.includes(profileId)))
    return `(() => {
      if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
      let matches = ${matchesUrl.toString()};
      ${selected.map(script => `if (${JSON.stringify(script.matches)}.some(pattern => matches(pattern, location.href)) && !${JSON.stringify(script.exclude)}.some(pattern => matches(pattern, location.href))) {
        let run = () => { try { ${script.source}\n } catch {} };
        ${script.runAt === 'document-end' ? "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();" : 'run();'}
      }`).join('\n')}
    })()`
  }
  let nativeStyle = (target: Target, kind: 'ads' | 'users', css: string, version = target.version) => {
    target.styleWork = target.styleWork.catch(() => undefined).then(async () => {
      if (target.closed || target.version !== version || target.contents.isDestroyed() || target.styles[kind]?.css === css) return
      let previous = target.styles[kind]?.key
      if (kind === 'ads') {
        // Clear the active inspector sheet when blocking is disabled.
        let key = previous
        if (!key && css) {
          let { frameTree } = await send(target, 'Page.getFrameTree')
          key = (await send(target, 'CSS.createStyleSheet', { frameId: frameTree.frame.id, force: true })).styleSheetId
        }
        if (key) await send(target, 'CSS.setStyleSheetText', { styleSheetId: key, text: target.closed || target.version !== version ? '' : css })
        if (!target.closed && target.version === version) target.styles[kind] = { css, key }
        return
      }
      let key = css ? await target.contents.insertCSS(css, { cssOrigin: 'user' }) : undefined
      if (target.closed || target.version !== version) { if (key && !target.contents.isDestroyed()) await target.contents.removeInsertedCSS(key); return }
      target.styles[kind] = { css, key }
      if (previous) await target.contents.removeInsertedCSS(previous)
    })
    return target.styleWork
  }
  let userStyles = (target: Target) => {
    let url = target.contents.getURL()
    let selected = pageOrigin(url) ? scripts.filter(script => script.enabled && script.kind === 'css' && (!script.profiles.length || script.profiles.includes(target.profileId)) && script.matches.some(pattern => matchesUrl(pattern, url)) && !script.exclude.some(pattern => matchesUrl(pattern, url))) : []
    return nativeStyle(target, 'users', selected.map(script => script.source).join('\n'))
  }
  let isolated = async (target: Target, expression: string) => {
    let { frameTree } = await send(target, 'Page.getFrameTree')
    let { executionContextId } = await send(target, 'Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: world })
    return send(target, 'Runtime.evaluate', { contextId: executionContextId, expression, returnByValue: true, timeout: 1000 })
  }
  let cosmetics = async (target: Target) => {
    void target.frames?.refresh().then(target.focus.identify)
    let url = target.contents.getURL(), version = target.version
    if (!pageOrigin(url)) return
    let enabled = options.adblock?.(target.contents.id) ?? siteSettings(options.settings(), target.profileId, url).adblock
    let details = enabled ? await isolated(target, cosmeticTokens) : undefined
    if (target.closed || target.version !== version || target.contents.getURL() !== url) return
    let value = details?.result.value ?? { ids: [], classes: [] }
    let css = enabled ? options.styles(url, value.ids, value.classes) : ''
    await nativeStyle(target, 'ads', css, version)
  }
  let register = async (target: Target) => {
    let appearance = appearanceSource(target.profileId), users = scriptSource(target.profileId)
    let sources = JSON.stringify([target.focus.source, appearance, users])
    // Config/file watchers can repeat an explicit refresh after it returns.
    // Preserve unchanged registrations so navigation never sees a needless gap.
    if (target.registeredSources === sources) return
    target.registeredSources = undefined
    await send(target, 'Page.enable', { enableFileChooserOpenedEvent: true })
    await target.frames?.start()
    // Keep ownership until Chromium acknowledges removal. A failed refresh must
    // not leave an old userscript installed but absent from our next cleanup.
    while (target.registrations.length) {
      try { await send(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: target.registrations[0] }) }
      catch (error) {
        // Chromium can remove its browser-side entry before a replaced renderer
        // reports it missing. Absence is complete cleanup; other failures retain it.
        if (!(error instanceof Error) || error.message !== 'Page.removeScriptToEvaluateOnNewDocument: missing script') throw error
      }
      target.registrations.shift()
    }
    target.registrations.push((await send(target, 'Page.addScriptToEvaluateOnNewDocument', { source: target.focus.source, worldName: 'bmux:keyboard-focus' })).identifier)
    target.registrations.push((await send(target, 'Page.addScriptToEvaluateOnNewDocument', { source: appearance, worldName: world })).identifier)
    target.registrations.push((await send(target, 'Page.addScriptToEvaluateOnNewDocument', { source: users })).identifier)
    target.registeredSources = sources
    target.error = undefined
  }
  let reconfigure = (target: Target) => {
    target.ready = target.ready.catch(() => undefined).then(async () => {
      if (target.closed || target.contents.isDestroyed()) return
      // Current-document CSS does not depend on future-document registration or
      // appearance IPC. One failed subsystem must not prevent the others updating.
      let stages = ['script registration'], work = [register(target)]
      if (pageOrigin(target.contents.getURL())) {
        stages.push('appearance', 'user styles', 'cosmetics')
        work.push(isolated(target, appearanceSource(target.profileId)).then(() => undefined), userStyles(target), cosmetics(target))
      }
      let results = await Promise.allSettled(work)
      let failed = stages.flatMap((stage, index) => {
        let result = results[index]
        let diagnostic = result.status === 'rejected' && result.reason instanceof Error && /^[A-Za-z.]+: (missing script|timeout|document changed|command rejected)$/.test(result.reason.message) ? result.reason.message : 'failed'
        return result.status === 'rejected' ? [`${stage}: ${diagnostic}`] : []
      })
      if (!target.closed) target.error = failed.length ? `Page tools could not refresh (${failed.join(', ')}). Reload the page to retry.` : undefined
    }).catch(() => { if (!target.closed) target.error = 'Page tools could not refresh. Reload the page to retry.' }).finally(options.changed)
  }
  let reload = () => {
    if (closed) return
    let next: Script[] = []
    for (let script of options.settings().userscripts) {
      let file = path.resolve(options.directory, script.file)
      if (!watched.has(file)) { fs.watchFile(file, { interval: 750, persistent: false }, reload); watched.add(file) }
      try {
        if (fs.statSync(file).size > 1_000_000) throw new Error('File too large')
        let source = fs.readFileSync(file, 'utf8')
        if (script.kind === 'js') new vm.Script(`(() => {${source}\n})()`)
        next.push({ ...script, source })
      } catch {
        let previous = scripts.find(item => item.id === script.id && item.file === script.file)
        next.push({ ...script, source: previous?.source ?? '', error: previous ? 'Invalid file update; using the previous script' : 'Could not read a valid script (maximum 1 MB)' })
      }
    }
    for (let file of watched) if (!options.settings().userscripts.some(script => path.resolve(options.directory, script.file) === file)) { fs.unwatchFile(file, reload); watched.delete(file) }
    scripts = next
    for (let target of targets.values()) reconfigure(target)
    options.changed()
    return Promise.all([...targets.values()].map(target => target.ready))
  }
  reload()
  return {
    reload,
    refresh: (tabId: string) => { let target = targets.get(tabId); if (target) { target.version++; return cosmetics(target) } },
    readyForScripts: () => Promise.all([...targets.values()].map(target => target.ready)),
    list: (): BrowserToolsState['scripts'] => scripts.map(({ id, name, enabled, error }) => ({ id, name, enabled, error })),
    editing: (tabId: string) => targets.get(tabId)?.focus.editing(),
    frameContexts: (tabId: string, expression: string) => targets.get(tabId)?.frames?.contexts(expression) ?? Promise.resolve([]),
    error: (tabId: string) => targets.get(tabId)?.error,
    attach: (tabId: string, profileId: string, contents: WebContents, bootstrap = true) => {
      let target: Target = { focus: createKeyboardFocus(contents), contents, profileId, registrations: [], ready: Promise.resolve(), closed: false, version: 0, styles: {}, styleWork: Promise.resolve() }
      target.frames = createFrameCosmetics({ contents, focusSource: target.focus.source, send: (method, params, sessionId) => send(target, method, params, sessionId), enabled: () => !!pageOrigin(contents.getURL()) && (options.adblock?.(contents.id) ?? siteSettings(options.settings(), profileId, contents.getURL()).adblock), styles: options.styles })
      targets.set(tabId, target)
      contents.debugger.on('detach', () => { target.registeredSources = undefined })
      // A newly-created WebContents has no renderer to answer Page.enable yet.
      // Bootstrap only about:blank, then register before any website navigation.
      target.ready = (bootstrap ? contents.loadURL('about:blank').catch(() => undefined) : Promise.resolve()).then(() => register(target)).catch(() => { if (!target.closed) target.error = 'Page tools could not initialize. Reload scripts to retry.' }).finally(options.changed)
      let resetStyles = () => { target.version++; target.styles = {} }
      contents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) resetStyles() })
      // Settings can reapply styles to the outgoing document while navigation waits.
      // Those sheets and pending insertions must not count toward the new document.
      contents.on('did-navigate', resetStyles)
      let apply = () => { void isolated(target, appearanceSource(profileId)).catch(() => undefined); void cosmetics(target).catch(() => undefined); void userStyles(target).catch(() => undefined) }
      contents.on('dom-ready', apply)
      contents.on('did-navigate-in-page', apply)
      // Poll only painted pages; this also catches generic selectors in dynamic content.
      target.timer = setInterval(() => {
        if (target.closed || target.busy || contents.isDestroyed() || !options.visible(contents.id) || contents.isLoadingMainFrame()) return
        target.busy = true
        void cosmetics(target).catch(() => undefined).finally(() => { target.busy = false })
      }, 2500)
      target.timer.unref()
      return target.ready
    },
    ready: (tabId: string) => targets.get(tabId)?.ready ?? Promise.resolve(),
    dispose: (tabId: string) => { let target = targets.get(tabId); if (target) { target.closed = true; target.frames?.close(); clearInterval(target.timer); targets.delete(tabId) } },
    close: () => { closed = true; for (let file of watched) fs.unwatchFile(file, reload); for (let target of targets.values()) { target.closed = true; target.frames?.close(); clearInterval(target.timer) }; targets.clear() },
  }
}
