import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'

type Wheel = { x: number; y: number; blocked: boolean }
type Direction = 'back' | 'forward'

// Keep the whole scroll burst together, including momentum. Committing after
// release also lets a user reverse a partial swipe without leaving the page.
export let createSwipeGesture = (navigate: (direction: Direction) => void) => {
  let x = 0, y = 0, blocked = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => { clearTimeout(timer); timer = undefined; x = 0; y = 0; blocked = false }
  return {
    cancel,
    push: (wheel: Wheel) => {
      clearTimeout(timer)
      x += wheel.x; y += Math.abs(wheel.y)
      blocked ||= wheel.blocked || y > 24 && y > Math.abs(x)
      timer = setTimeout(() => {
        let direction: Direction | undefined = !blocked && Math.abs(x) >= 180 && Math.abs(x) > y * 2 ? x < 0 ? 'back' : 'forward' : undefined
        cancel()
        if (direction) navigate(direction)
      }, 220)
    },
  }
}

// Runs in an isolated world with no preload or privileged page API. A scroll
// that belongs to a page widget must never turn into browser navigation.
export let observeSwipe = (marker: string) => {
  if (window !== window.top) return
  let scope = globalThis as typeof globalThis & { bmuxSwipe?: boolean }
  if (scope.bmuxSwipe) return
  scope.bmuxSwipe = true
  let report = console.debug.bind(console)
  window.addEventListener('wheel', event => {
    if (!event.isTrusted || !event.deltaX && !event.deltaY) return
    let blocked = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    let elements = event.composedPath().filter((node): node is Element => node instanceof Element)
    for (let element of elements) {
      let style = getComputedStyle(element)
      let root = element === document.scrollingElement
      if ((root || /auto|scroll|overlay/.test(style.overflowX)) && element.scrollWidth > element.clientWidth + 1) {
        let left = style.direction === 'rtl' ? -(element.scrollWidth - element.clientWidth) : 0
        let right = style.direction === 'rtl' ? 0 : element.scrollWidth - element.clientWidth
        if (event.deltaX < 0 && element.scrollLeft > left + 1 || event.deltaX > 0 && element.scrollLeft < right - 1) blocked = true
      }
      if (style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none') blocked = true
      if (element.matches('iframe, frame, object, embed')) blocked = true
    }
    // Run after the page's wheel handlers, including listeners installed later.
    setTimeout(() => report(marker + JSON.stringify({ x: event.deltaX, y: event.deltaY, blocked: blocked || event.defaultPrevented })), 0)
  }, { capture: true, passive: true })
}

export let createSwipeNavigation = (contents: WebContents, enabled: () => boolean) => {
  let marker = `bmux-swipe:${randomUUID()}`
  let gesture = createSwipeGesture(direction => {
    if (contents.isDestroyed() || !enabled()) return
    let history = contents.navigationHistory
    if (direction === 'back' && history.canGoBack()) history.goBack()
    if (direction === 'forward' && history.canGoForward()) history.goForward()
  })
  contents.on('console-message', details => {
    if (!details.message.startsWith(marker)) return
    if (!enabled()) { gesture.cancel(); return }
    try {
      let wheel = JSON.parse(details.message.slice(marker.length)) as Wheel
      if (Number.isFinite(wheel.x) && Number.isFinite(wheel.y) && typeof wheel.blocked === 'boolean') gesture.push(wheel)
    } catch { /* Ignore unrelated console output. */ }
  })
  contents.on('did-start-navigation', details => { if (details.isMainFrame) gesture.cancel() })
  contents.on('render-process-gone', gesture.cancel)
  contents.once('destroyed', gesture.cancel)
  return async () => {
    let source = `(${observeSwipe.toString()})(${JSON.stringify(marker)})`
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source, worldName: 'bmux:swipe', runImmediately: true })
  }
}
