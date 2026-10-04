import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'

type Wheel = { x: number; y: number; blocked: boolean }
type Direction = 'back' | 'forward'

// Keep the whole scroll burst together, including momentum. Committing after
// release also lets a user reverse a partial swipe without leaving the page.
export let createSwipeGesture = (navigate: (direction: Direction) => void, preview: (offset: number) => void = () => {}, available: (direction: Direction) => boolean = () => true) => {
  let x = 0, y = 0, blocked = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => { clearTimeout(timer); timer = undefined; x = 0; y = 0; blocked = false; preview(0) }
  return {
    cancel,
    push: (wheel: Wheel) => {
      clearTimeout(timer)
      x += wheel.x; y += Math.abs(wheel.y)
      blocked ||= wheel.blocked || y > 24 && y > Math.abs(x)
      let horizontal = !blocked && Math.abs(x) > y * 2 && available(x < 0 ? 'back' : 'forward')
      preview(horizontal && Math.abs(x) >= 8 ? -x : 0)
      timer = setTimeout(() => {
        let direction: Direction | undefined = horizontal && Math.abs(x) >= 180 ? x < 0 ? 'back' : 'forward' : undefined
        cancel()
        if (direction && available(direction)) navigate(direction)
      }, 220)
    },
  }
}

// An additive compositor animation moves the entire document (including fixed
// content) without replacing a website's transforms or mutating its styles.
export let renderSwipePreview = (offset: number) => {
  let scope = globalThis as typeof globalThis & { bmuxSwipePreview?: { animation: Animation; width: number } }
  let state = scope.bmuxSwipePreview
  if (!offset) {
    if (state) {
      scope.bmuxSwipePreview = undefined
      let animation = state.animation
      let current = Number(animation.currentTime) - state.width
      animation.cancel()
      let reset = document.documentElement.animate([{ translate: `${current}px` }, { translate: '0px' }], { duration: 160, easing: 'ease-out', composite: 'add' })
      // A new swipe must not add its displacement to an unfinished return.
      reset.id = 'bmux-swipe-return'
      reset.onfinish = () => reset.cancel()
    }
    return
  }
  if (!state) {
    for (let animation of document.documentElement.getAnimations()) if (animation.id === 'bmux-swipe-return') animation.cancel()
    let width = innerWidth
    let animation = document.documentElement.animate([{ translate: `${-width}px` }, { translate: `${width}px` }], { duration: width * 2, fill: 'both', composite: 'add' })
    animation.pause()
    state = scope.bmuxSwipePreview = { animation, width }
  }
  // Keep some of the page visible even during a long momentum tail.
  state.animation.currentTime = state.width + Math.max(-state.width * 0.65, Math.min(state.width * 0.65, offset))
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
  let offset = 0
  let available = (direction: Direction) => !contents.isDestroyed() && enabled() && (direction === 'back' ? contents.navigationHistory.canGoBack() : contents.navigationHistory.canGoForward())
  let preview = (next: number) => {
    if (next === offset || contents.isDestroyed()) return
    offset = next
    // A separate isolated world has no preload or privileged browser API.
    void contents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${renderSwipePreview.toString()})(${next})` }]).catch(() => { /* A navigation can replace the document mid-gesture. */ })
  }
  let gesture = createSwipeGesture(direction => {
    if (!available(direction)) return
    let history = contents.navigationHistory
    if (direction === 'back' && history.canGoBack()) history.goBack()
    if (direction === 'forward' && history.canGoForward()) history.goForward()
  }, preview, available)
  contents.on('console-message', details => {
    if (!details.message.startsWith(marker)) return
    if (!enabled()) { gesture.cancel(); return }
    try {
      let wheel = JSON.parse(details.message.slice(marker.length)) as Wheel
      if (Number.isFinite(wheel.x) && Number.isFinite(wheel.y) && typeof wheel.blocked === 'boolean') gesture.push(wheel)
    } catch { /* Ignore unrelated console output. */ }
  })
  contents.on('did-start-navigation', details => { if (details.isMainFrame) gesture.cancel() })
  contents.on('blur', gesture.cancel)
  contents.on('render-process-gone', gesture.cancel)
  contents.once('destroyed', gesture.cancel)
  return async () => {
    let source = `(${observeSwipe.toString()})(${JSON.stringify(marker)})`
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source, worldName: 'bmux:swipe', runImmediately: true })
  }
}
