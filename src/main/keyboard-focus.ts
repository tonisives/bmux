import { randomUUID } from 'node:crypto'
import type { WebContents, WebFrameMain } from 'electron'

// Runs in an isolated world. Reports only focus state, never field contents.
export let observeKeyboardFocus = (marker: string) => {
  let scope = globalThis as typeof globalThis & { bmuxKeyboardFocus?: boolean }
  if (scope.bmuxKeyboardFocus) return
  scope.bmuxKeyboardFocus = true
  let identity = '', previous = ''
  let report = console.debug.bind(console)
  let update = (force = false) => {
    if (!identity) return
    let active = document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    // Pages such as Gatsby focus a tabindex=-1 wrapper when their content is clicked.
    // A wrapper with child elements is page content, while an unknown host without
    // light-DOM children may contain a closed shadow editor.
    let wrapper = active instanceof HTMLElement && active.getAttribute('tabindex') === '-1' && active.children.length > 0
    let editing = document.designMode.toLowerCase() === 'on' || !active || active.matches('input, textarea, select, iframe, frame, object, embed, [role="textbox"], [role="combobox"]') || (active instanceof HTMLElement && active.isContentEditable) || (!wrapper && !active.shadowRoot && !active.matches('html, body, button, a[href], area[href], summary'))
    let value = editing ? 'editing' : 'pane'
    if (force || value !== previous) report(marker + JSON.stringify({ identity, editing }))
    previous = value
  }
  // The main process supplies the native frame identity, without exposing any API.
  window.addEventListener(marker, event => {
    let detail = (event as CustomEvent).detail
    if (typeof detail !== 'string') return
    identity = detail; update(true)
  })
  for (let event of ['focusin', 'focusout', 'focus', 'blur', 'pointerdown', 'pointerup', 'keydown', 'keyup']) window.addEventListener(event, () => queueMicrotask(() => update(true)), true)
  let observer = new MutationObserver(() => update())
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['contenteditable', 'role', 'type', 'readonly', 'disabled'] })
}

export let createKeyboardFocus = (contents: WebContents) => {
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
