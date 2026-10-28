import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { viewportPanDelta } from '../shared/viewport-pan'

// Runs in an isolated world, including child frames, without a page preload.
export let observeViewportPan = (marker: string, enabled: boolean, mac: boolean, delta: typeof viewportPanDelta) => {
  let scope = globalThis as typeof globalThis & { bmuxViewportPan?: { enabled: boolean } }
  if (scope.bmuxViewportPan) { scope.bmuxViewportPan.enabled = enabled; return }
  let state = scope.bmuxViewportPan = { enabled }
  let report = console.debug.bind(console)
  window.addEventListener('wheel', event => {
    if (!state.enabled || !event.isTrusted || !(mac ? event.metaKey : event.ctrlKey)) return
    event.preventDefault(); event.stopImmediatePropagation()
    report(marker + JSON.stringify(delta(event, innerWidth, innerHeight)))
  }, { capture: true, passive: false })
}

export let createViewportPan = (contents: WebContents, enabled: () => boolean, evaluate: (expression: string) => Promise<unknown>, pan: (x: number, y: number) => void) => {
  let marker = `bmux-viewport-pan:${randomUUID()}`, previous = false, revision = 0, closed = false
  let work = Promise.resolve()
  let refresh = (force = false) => {
    let active = enabled()
    if (active === previous && (!force || !active)) return work
    previous = active
    let version = ++revision
    work = work.catch(() => undefined).then(async () => {
      if (closed || contents.isDestroyed() || version !== revision) return
      await evaluate(`(${observeViewportPan.toString()})(${JSON.stringify(marker)}, ${active}, ${process.platform === 'darwin'}, ${viewportPanDelta.toString()})`)
    }).catch(() => { if (version === revision) previous = !active })
    return work
  }
  let documentReady = () => { void refresh(true) }
  let message = (details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => {
    if (closed || !enabled() || !details.message.startsWith(marker)) return
    try {
      let { x, y } = JSON.parse(details.message.slice(marker.length))
      if (Number.isFinite(x) && Number.isFinite(y)) pan(x, y)
    } catch { /* Ignore messages outside the viewport gesture. */ }
  }
  contents.on('console-message', message)
  contents.on('did-frame-navigate', documentReady)
  contents.on('dom-ready', documentReady)
  contents.on('did-frame-finish-load', documentReady)
  contents.once('destroyed', () => { closed = true; ++revision })
  return { refresh }
}
