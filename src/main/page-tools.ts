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
type Target = { focus: ReturnType<typeof createKeyboardFocus>; contents: WebContents; profileId: string; registrations: string[]; ready: Promise<void>; closed: boolean; version: number; styles: Partial<Record<'ads' | 'users', { css: string; key?: string }>>; styleWork: Promise<void>; frames?: ReturnType<typeof createFrameCosmetics>; busy?: boolean; error?: string; timer?: ReturnType<typeof setInterval> }
type Options = { directory: string; settings: () => BrowserSettings; changed: () => void; visible: (contentsId: number) => boolean; styles: (url: string, ids: string[], classes: string[]) => string }
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
    let enabled = siteSettings(options.settings(), target.profileId, url).adblock
    let details = enabled ? await isolated(target, cosmeticTokens) : undefined
    if (target.closed || target.version !== version || target.contents.getURL() !== url) return
    let value = details?.result.value ?? { ids: [], classes: [] }
    let css = enabled ? options.styles(url, value.ids, value.classes) : ''
    await nativeStyle(target, 'ads', css, version)
  }
  let register = async (target: Target, apply = true) => {
    let appearance = appearanceSource(target.profileId), users = scriptSource(target.profileId)
    await send(target, 'Page.enable')
    await target.frames?.start()
    for (let identifier of target.registrations.splice(0)) await send(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier })
    target.registrations.push((await send(target, 'Page.addScriptToEvaluateOnNewDocument', { source: target.focus.source, worldName: 'bmux:keyboard-focus' })).identifier)
    target.registrations.push((await send(target, 'Page.addScriptToEvaluateOnNewDocument', { source: appearance, worldName: world })).identifier)
    target.registrations.push((await send(target, 'Page.addScriptToEvaluateOnNewDocument', { source: users })).identifier)
    target.error = undefined
    if (apply && pageOrigin(target.contents.getURL())) {
      await isolated(target, appearance)
      await userStyles(target)
      await cosmetics(target)
    }
  }
  let reconfigure = (target: Target) => {
    target.ready = target.ready.catch(() => undefined).then(() => register(target)).catch(() => { if (!target.closed) target.error = 'Page tools could not refresh. Reload the page to retry.' }).finally(options.changed)
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
    readyForScripts: () => Promise.all([...targets.values()].map(target => target.ready)),
    list: (): BrowserToolsState['scripts'] => scripts.map(({ id, name, enabled, error }) => ({ id, name, enabled, error })),
    editing: (tabId: string) => targets.get(tabId)?.focus.editing(),
    frameContexts: (tabId: string, expression: string) => targets.get(tabId)?.frames?.contexts(expression) ?? Promise.resolve([]),
    error: (tabId: string) => targets.get(tabId)?.error,
    attach: (tabId: string, profileId: string, contents: WebContents, bootstrap = true) => {
      let target: Target = { focus: createKeyboardFocus(contents), contents, profileId, registrations: [], ready: Promise.resolve(), closed: false, version: 0, styles: {}, styleWork: Promise.resolve() }
      target.frames = createFrameCosmetics({ contents, focusSource: target.focus.source, send: (method, params, sessionId) => send(target, method, params, sessionId), enabled: () => !!pageOrigin(contents.getURL()) && siteSettings(options.settings(), profileId, contents.getURL()).adblock, styles: options.styles })
      targets.set(tabId, target)
      // A newly-created WebContents has no renderer to answer Page.enable yet.
      // Bootstrap only about:blank, then register before any website navigation.
      target.ready = (bootstrap ? contents.loadURL('about:blank').catch(() => undefined) : Promise.resolve()).then(() => register(target, false)).catch(() => { if (!target.closed) target.error = 'Page tools could not initialize. Reload scripts to retry.' }).finally(options.changed)
      contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { target.version++; target.styles = {} } })
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
