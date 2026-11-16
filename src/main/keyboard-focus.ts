import { randomUUID } from 'node:crypto'
import type { WebContents, WebFrameMain } from 'electron'

// Runs in an isolated world. Reports only focus state, never field contents.
export let observeKeyboardFocus = (marker: string) => {
  let scope = globalThis as typeof globalThis & { bmuxKeyboardFocus?: boolean; bmuxVimEditing?: boolean; bmuxKeyboardFocusResolve?: (host: Element, root: ShadowRoot | null) => void }
  if (scope.bmuxKeyboardFocus) return
  scope.bmuxKeyboardFocus = true
  let identity = '', previous = ''
  let report = console.debug.bind(console)
  let shadows = new WeakMap<Element, ShadowRoot | null>(), pending = new WeakSet<Element>(), watched = new WeakSet<ShadowRoot>()
  let events = ['focusin', 'focusout', 'focus', 'blur', 'pointerdown', 'pointerup', 'keydown', 'keyup']
  let mutations = { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable', 'role', 'type', 'readonly', 'disabled'] }
  let changed = (event: Event) => {
    if (event.type === 'focusin' && event.target instanceof Element && shadows.get(event.target) === null) shadows.delete(event.target)
    queueMicrotask(() => update(true))
  }
  let watch = (root: ShadowRoot) => {
    if (watched.has(root)) return
    watched.add(root)
    for (let event of events) root.addEventListener(event, changed, true)
    observer.observe(root, mutations)
  }
  let update = (force = false) => {
    if (!identity) return
    let active = document.activeElement
    while (active) {
      let root = active.shadowRoot ?? shadows.get(active)
      if (!root) break
      watch(root)
      if (!root.activeElement) break
      active = root.activeElement
    }
    let input = active instanceof HTMLInputElement && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(active.type)
    let editing = scope.bmuxVimEditing === true || document.designMode.toLowerCase() === 'on' || input || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable
    // A closed shadow host conceals its focused child. Inspect only that host;
    // an old selection elsewhere in the document must not count as text focus.
    let inspect = !editing && active && !active.matches('input, textarea, select, button, a[href], area[href], summary') && !active.shadowRoot && !shadows.has(active)
    if (inspect) editing = true
    let value = editing ? 'editing' : 'pane'
    if (force || value !== previous) report(marker + JSON.stringify({ identity, editing }))
    if (inspect && !pending.has(active!)) {
      pending.add(active!)
      report(marker, active)
    }
    previous = value
  }
  scope.bmuxKeyboardFocusResolve = (host, root) => {
    shadows.set(host, root); pending.delete(host)
    if (root) watch(root)
    update(true)
  }
  // The main process supplies the native frame identity, without exposing any API.
  window.addEventListener(marker, event => {
    let detail = (event as CustomEvent).detail
    if (typeof detail !== 'string') return
    identity = detail; update(true)
  })
  for (let event of events) window.addEventListener(event, changed, true)
  let observer = new MutationObserver(() => update())
  observer.observe(document, mutations)
}

export let createKeyboardFocus = (contents: WebContents, send: (method: string, params: Record<string, unknown>, sessionId?: string) => Promise<any>) => {
  let marker = `bmux-focus:${randomUUID()}`
  let frames = new Map<WebFrameMain, { identity: string; editing?: boolean }>()
  let navigating = new WeakSet<WebFrameMain>()
  let identify = () => {
    if (contents.isDestroyed()) return
    let live = new Set(contents.mainFrame.framesInSubtree)
    for (let frame of frames.keys()) if (!live.has(frame)) frames.delete(frame)
    for (let frame of live) {
      if (frame.isDestroyed() || frame.detached || navigating.has(frame)) continue
      let state = frames.get(frame)
      if (!state) { state = { identity: randomUUID() }; frames.set(frame, state) }
      // Electron's console event misattributes same-process subframes. Send each
      // native frame an opaque identity; all DOM inspection stays isolated.
      void frame.executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(marker)}, { detail: ${JSON.stringify(state.identity)} }))`).catch(() => undefined)
    }
  }
  let watch = (frame: WebFrameMain) => frame.on('dom-ready', () => { navigating.delete(frame); identify() })
  for (let frame of contents.mainFrame.framesInSubtree) watch(frame)
  contents.on('frame-created', (_event, details) => { if (details.frame) watch(details.frame) })
  contents.on('console-message', details => {
    if (!details.message.startsWith(marker)) return
    try {
      let report = JSON.parse(details.message.slice(marker.length))
      if (typeof report.editing !== 'boolean') return
      for (let [frame, state] of frames) if (state.identity === report.identity && !frame.isDestroyed() && !navigating.has(frame)) state.editing = report.editing
    } catch { /* Unrecognized page messages are not focus reports. */ }
  })
  contents.debugger.on('message', (_event, method, params, sessionId) => {
    if (method !== 'Runtime.consoleAPICalled' || params.args?.[0]?.value !== marker || !params.args[1]?.objectId) return
    let session = sessionId || undefined, objectId = params.args[1].objectId
    void (async () => {
      let { node } = await send('DOM.describeNode', { objectId }, session)
      let root = node.shadowRoots?.find((root: { shadowRootType?: string }) => root.shadowRootType === 'closed')
      let shadow: string | undefined
      try {
        if (root) shadow = (await send('DOM.resolveNode', { backendNodeId: root.backendNodeId, executionContextId: params.executionContextId }, session)).object.objectId
        await send('Runtime.callFunctionOn', { executionContextId: params.executionContextId, functionDeclaration: 'function(host, root) { globalThis.bmuxKeyboardFocusResolve(host, root) }', arguments: [{ objectId }, shadow ? { objectId: shadow } : { value: null }] }, session)
      } finally {
        if (shadow) await send('Runtime.releaseObject', { objectId: shadow }, session).catch(() => undefined)
      }
    })().catch(() => undefined).finally(() => { void send('Runtime.releaseObject', { objectId }, session).catch(() => undefined) })
  })
  contents.on('did-start-navigation', details => {
    if (details.isSameDocument) return
    if (details.frame) { frames.delete(details.frame); navigating.add(details.frame) }
    if (details.isMainFrame) frames.clear()
  })
  contents.on('render-process-gone', () => { frames.clear() })
  contents.debugger.on('detach', () => { frames.clear() })
  return {
    source: `(${observeKeyboardFocus.toString()})(${JSON.stringify(marker)})`,
    identify,
    editing: () => {
      let frame = contents.focusedFrame
      if (!frame || frame.isDestroyed() || frame.detached || navigating.has(frame)) return undefined
      return frames.get(frame)?.editing
    },
  }
}
