import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { viewportPanDelta } from '../shared/viewport-pan'

export type ViewportPanArea = { x: number; y: number; width: number; height: number; zoom?: number; toggled?: boolean; control?: boolean; standalone?: boolean }

// Runs in an isolated world on the page and on the agent input shield.
export let observeViewportPan = (marker: string, area: ViewportPanArea | undefined, delta: typeof viewportPanDelta) => {
  let scope = globalThis as typeof globalThis & { bmuxViewportPan?: { update: (area: ViewportPanArea | undefined) => void } }
  if (scope.bmuxViewportPan) { scope.bmuxViewportPan.update(area); return }
  let host = document.createElement('div')
  host.id = 'bmux-viewport-pan'
  host.popover = 'manual'
  host.style.cssText = 'all:initial;position:fixed;inset:auto;z-index:2147483647;pointer-events:none'
  let root = host.attachShadow({ mode: 'open' })
  // Constructed stylesheets keep the browser control styled under page CSP.
  let sheet = new CSSStyleSheet()
  sheet.replaceSync(`
    button { position:absolute;display:flex;align-items:center;justify-content:center;right:12px;top:12px;box-sizing:border-box;width:32px;height:32px;padding:0;transform-origin:top right;border:1px solid #666;border-radius:4px;background:#272727;color:white;cursor:pointer;pointer-events:auto }
    button:hover:not([aria-pressed="true"]) { background:#444 }
    button[aria-pressed="true"] { background:#c2ceb9;color:#111318;border-color:#c2ceb9;box-shadow:inset 0 0 0 1px #111318 }
    button:active { filter:brightness(.9) }
    button:focus-visible { outline:2px solid white;outline-offset:2px }
    svg { display:block;width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round }
    div { position:absolute;inset:0;pointer-events:none;cursor:grab;touch-action:none }
  `)
  root.adoptedStyleSheets = [sheet]
  root.innerHTML = `<div></div><button type="button" aria-label="Pan viewport" aria-pressed="false" title="Pan viewport (Alt or Meta + drag; Escape to exit)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V6a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 4-3 7-7 7h-1c-2 0-3-1-4-2l-4-5a1.5 1.5 0 0 1 2-2l2 2"/></svg></button>`
  let surface = root.querySelector('div')!, button = root.querySelector('button')!
  let toggled = area?.toggled ?? false, modifier = false, dragging: { id: number; x: number; y: number } | undefined
  let report = console.debug.bind(console)
  let render = () => {
    let active = !!area && (toggled || modifier || !!dragging)
    surface.style.pointerEvents = active ? 'auto' : 'none'
    surface.style.cursor = dragging ? 'grabbing' : 'grab'
    button.setAttribute('aria-pressed', String(toggled))
    host.style.display = area ? 'block' : 'none'
    button.style.display = area?.control === false ? 'none' : 'flex'
  }
  let end = () => {
    if (dragging && surface.hasPointerCapture(dragging.id)) surface.releasePointerCapture(dragging.id)
    dragging = undefined; render()
  }
  let update = (next: ViewportPanArea | undefined) => {
    area = next
    if (!area) { modifier = false; end() }
    else toggled = area.toggled ?? toggled
    if (area) Object.assign(host.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.width}px`, height: `${area.height}px` })
    if (area) {
      let scale = 1 / (area.zoom ?? 1)
      Object.assign(button.style, { transform: `scale(${scale})`, right: `${area.standalone ? 0 : 12 * scale}px`, top: `${area.standalone ? 0 : 12 * scale}px` })
    }
    if (!host.isConnected) document.documentElement.append(host)
    render()
    if (area && !host.matches?.(':popover-open')) host.showPopover?.()
  }
  scope.bmuxViewportPan = { update }
  let setMode = (enabled: boolean) => { toggled = enabled; report(marker + JSON.stringify({ mode: enabled })); render() }
  button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); setMode(!toggled) })
  button.addEventListener('mouseenter', () => report(marker + JSON.stringify({ tooltip: true })))
  button.addEventListener('mouseleave', () => report(marker + JSON.stringify({ tooltip: false })))
  let keys = (event: KeyboardEvent) => {
    modifier = event.altKey || event.metaKey
    if (event.key === 'Escape' && (toggled || dragging)) { event.preventDefault(); event.stopImmediatePropagation(); setMode(false); modifier = false; end() }
    render()
  }
  window.addEventListener('keydown', keys, true)
  window.addEventListener('keyup', keys, true)
  window.addEventListener('resize', () => report(marker + JSON.stringify({ refresh: true })))
  window.addEventListener('pointermove', event => { modifier = event.altKey || event.metaKey; render() }, true)
  window.addEventListener('blur', () => { modifier = false; end() })
  surface.addEventListener('pointerdown', event => {
    if (!area || !event.isTrusted || event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    dragging = { id: event.pointerId, x: event.screenX, y: event.screenY }
    surface.setPointerCapture(event.pointerId); render()
  })
  surface.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.id || !event.isTrusted) return
    event.preventDefault(); event.stopPropagation()
    report(marker + JSON.stringify({ x: dragging.x - event.screenX, y: dragging.y - event.screenY }))
    dragging.x = event.screenX; dragging.y = event.screenY
  })
  surface.addEventListener('pointerup', end)
  surface.addEventListener('pointercancel', end)
  surface.addEventListener('lostpointercapture', () => { dragging = undefined; render() })
  surface.addEventListener('click', event => { event.preventDefault(); event.stopPropagation() })
  surface.addEventListener('wheel', event => {
    if (!area || !event.isTrusted) return
    event.preventDefault(); event.stopPropagation()
    if (event.altKey) report(marker + JSON.stringify({ zoom: delta(event, area.width, area.height, area.zoom ?? 1).y }))
    else report(marker + JSON.stringify(delta(event, area.width * (area.zoom ?? 1), area.height * (area.zoom ?? 1), area.zoom ?? 1)))
  }, { passive: false })
  update(area)
}

export let createViewportPan = (contents: WebContents, geometry: () => ViewportPanArea | undefined, evaluate: (expression: string) => Promise<unknown>, pan: (x: number, y: number) => void, mode?: (enabled: boolean) => void, zoom?: (delta: number) => void, tooltip?: (visible: boolean) => void) => {
  let marker = `bmux-viewport-pan:${randomUUID()}`, previous = '', revision = 0, closed = false
  let work = Promise.resolve()
  let refresh = (force = false) => {
    let area = geometry(), next = JSON.stringify(area) ?? ''
    if (next === previous && !force) return work
    previous = next
    let version = ++revision
    work = work.catch(() => undefined).then(async () => {
      if (closed || contents.isDestroyed() || version !== revision) return
      await evaluate(`(${observeViewportPan.toString()})(${JSON.stringify(marker)}, ${JSON.stringify(area)}, ${viewportPanDelta.toString()})`)
    }).catch(() => { if (version === revision) previous = 'retry' })
    return work
  }
  let documentReady = () => { void refresh(true) }
  let message = (details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => {
    if (closed || !geometry() || !details.message.startsWith(marker)) return
    try {
      let { x, y, mode: enabled, refresh: requested, zoom: zoomDelta, tooltip: hover } = JSON.parse(details.message.slice(marker.length))
      if (requested === true) { void refresh(true); return }
      if (typeof enabled === 'boolean') { mode?.(enabled); return }
      if (typeof hover === 'boolean') { tooltip?.(hover); return }
      if (Number.isFinite(zoomDelta)) { zoom?.(zoomDelta); return }
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

// CDP can install the control before a page's pending requests finish.
export let viewportPanEvaluator = (contents: WebContents) => {
  let world: Promise<number> | undefined
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) world = undefined })
  return async (expression: string) => {
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
      world ??= contents.debugger.sendCommand('Page.getFrameTree').then(async ({ frameTree }) => {
        let context = await contents.debugger.sendCommand('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'bmux:viewport-pan' })
        return context.executionContextId as number
      })
      let result = await contents.debugger.sendCommand('Runtime.evaluate', { expression, contextId: await world })
      if (result.exceptionDetails) throw new Error('Viewport control document changed')
    } catch (error) { world = undefined; throw error }
  }
}
