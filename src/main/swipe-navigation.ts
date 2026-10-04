import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'

type Wheel = { x: number; y: number; blocked: boolean }
type Direction = 'back' | 'forward'
type Availability = Record<Direction, boolean>

// Keep the whole scroll burst together, including momentum. Committing after
// release also lets a user reverse a partial swipe without leaving the page.
export let createSwipeGesture = (navigate: (direction: Direction) => void, preview: (offset: number) => void = () => {}, available: (direction: Direction) => boolean = () => true) => {
  let x = 0, y = 0, blocked = false, horizontal = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => { clearTimeout(timer); timer = undefined; x = 0; y = 0; blocked = false; horizontal = false; preview(0) }
  return {
    cancel,
    get active() { return horizontal && !blocked },
    push: (wheel: Wheel) => {
      clearTimeout(timer)
      x += wheel.x; y += Math.abs(wheel.y)
      blocked ||= wheel.blocked
      // Decide once near the beginning, then retain that axis through drift,
      // reversal and momentum. A vertical scroll must never become a back swipe.
      if (!blocked && !horizontal) {
        if (Math.abs(x) >= 8 && Math.abs(x) > y * 1.5) {
          horizontal = available(x < 0 ? 'back' : 'forward')
          blocked = !horizontal
        } else if (y >= 8 && y >= Math.abs(x)) blocked = true
      }
      let claimed = horizontal && !blocked
      preview(claimed && available(x < 0 ? 'back' : 'forward') ? -x : 0)
      timer = setTimeout(() => {
        let direction: Direction | undefined = claimed && Math.abs(x) >= 180 ? x < 0 ? 'back' : 'forward' : undefined
        cancel()
        if (direction && available(direction)) navigate(direction)
      }, 220)
      // Suppress tiny vertical drift while a clearly horizontal start is still
      // below the preview threshold. Ambiguous or vertical input scrolls normally.
      return claimed || !blocked && Math.abs(x) > y * 1.5 && available(x < 0 ? 'back' : 'forward')
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
export let observeSwipe = (marker: string, createGesture: typeof createSwipeGesture, preview: typeof renderSwipePreview, availability: Availability) => {
  if (window !== window.top) return
  let scope = globalThis as typeof globalThis & { bmuxSwipe?: { update: (next: Availability) => void; cancel: () => void } }
  if (scope.bmuxSwipe) { scope.bmuxSwipe.update(availability); return }
  let report = console.debug.bind(console)
  let gesture = createGesture(direction => report(marker + direction), preview, direction => availability[direction])
  scope.bmuxSwipe = { cancel: gesture.cancel, update: next => { availability = next; gesture.cancel() } }
  window.addEventListener('wheel', event => {
    if (!event.isTrusted || !event.deltaX && !event.deltaY) return
    let blocked = event.defaultPrevented || !event.cancelable || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    // Once claimed, moving the document can put another widget under the cursor.
    // That must not transfer this same gesture back to page scrolling.
    let elements = gesture.active ? [] : event.composedPath().filter((node): node is Element => node instanceof Element)
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
    // Append a bubble handler for this event, after the page's current handlers.
    // This still animates and cancels native scrolling synchronously, while
    // respecting preventDefault even in window listeners registered after us.
    let finish = (wheel: WheelEvent) => {
      if (wheel !== event) return
      clearTimeout(timer)
      window.removeEventListener('wheel', finish)
      if (gesture.push({ x: event.deltaX, y: event.deltaY, blocked: blocked || event.defaultPrevented })) event.preventDefault()
    }
    window.addEventListener('wheel', finish, { passive: false })
    // A widget can also stop propagation, in which case it owns this burst.
    let timer = setTimeout(() => {
      window.removeEventListener('wheel', finish)
      gesture.push({ x: event.deltaX, y: event.deltaY, blocked: true })
    }, 0)
  // Inspect widget boundaries before page handlers or native scrolling move them.
  }, { capture: true, passive: false })
  window.addEventListener('pagehide', gesture.cancel)
}

export let createSwipeNavigation = (contents: WebContents, enabled: () => boolean) => {
  let marker = `bmux-swipe:${randomUUID()}`
  let available = (direction: Direction) => !contents.isDestroyed() && enabled() && (direction === 'back' ? contents.navigationHistory.canGoBack() : contents.navigationHistory.canGoForward())
  let previous: string | undefined
  let run = async (code: string) => {
    if (contents.isDestroyed()) return
    // A separate isolated world has no preload or privileged browser API.
    // Retry eligibility/installation on the next input if navigation replaced
    // the document before this script could run.
    await contents.executeJavaScriptInIsolatedWorld(1001, [{ code }]).catch(() => { previous = undefined })
  }
  let refresh = async () => {
    let next = JSON.stringify({ back: available('back'), forward: available('forward') })
    if (next === previous) return
    previous = next
    await run(`(${observeSwipe.toString()})(${JSON.stringify(marker)}, ${createSwipeGesture.toString()}, ${renderSwipePreview.toString()}, ${next})`)
  }
  let cancel = () => { previous = undefined; void run('globalThis.bmuxSwipe?.cancel()') }
  contents.on('console-message', details => {
    if (!details.message.startsWith(marker)) return
    let direction = details.message.slice(marker.length)
    if ((direction !== 'back' && direction !== 'forward') || !available(direction)) { cancel(); return }
    if (direction === 'back') contents.navigationHistory.goBack()
    else contents.navigationHistory.goForward()
  })
  contents.on('did-start-navigation', details => { if (details.isMainFrame) cancel() })
  contents.on('dom-ready', () => { previous = undefined; void refresh() })
  contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) void refresh() })
  // Eligibility can change with focus, overlays or automation. Send only state
  // changes; wheel-by-wheel animation never waits for a main-process round trip.
  contents.on('before-mouse-event', () => { void refresh() })
  contents.on('focus', () => { void refresh() })
  contents.on('blur', cancel)
  contents.on('render-process-gone', () => { previous = undefined })
  return refresh
}
