import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { createSwipeSurface, type SwipeSurface } from './swipe-surface'
import { swipeSnapshots } from './swipe-snapshots'

type Wheel = { x: number; y: number; blocked: boolean }
type Direction = 'back' | 'forward'
type Availability = Record<Direction, boolean>

// Physical trackpads have explicit begin/end phases. Only phase-less wheels
// use an idle fallback; a held trackpad must never time out halfway through.
export let createSwipeGesture = (navigate: (direction: Direction) => void, preview: (offset: number) => void = () => {}, available: (direction: Direction) => boolean = () => true) => {
  let x = 0, y = 0, blocked = false, horizontal = false, native = false, released = false, ownsTail = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let earlyWheel: Wheel | undefined, momentum = false
  let cancel = () => { clearTimeout(timer); timer = undefined; x = 0; y = 0; blocked = false; horizontal = false; native = false; released = false; ownsTail = false; earlyWheel = undefined; momentum = false; preview(0) }
  let finish = () => {
    let direction: Direction | undefined = horizontal && !blocked && Math.abs(x) >= 180 ? x < 0 ? 'back' : 'forward' : undefined
    if (direction && available(direction)) navigate(direction)
    cancel()
  }
  let gesture = {
    cancel,
    phase: (phase: 'begin' | 'end' | 'cancel' | 'momentum' | 'fallback') => {
      if (phase === 'fallback') { if (native) cancel(); return }
      if (phase === 'begin') {
        // Native notification and Chromium wheel delivery use separate queues.
        // Adopt an already-delivered first wheel instead of erasing its distance.
        let first = released && !momentum ? earlyWheel : undefined
        earlyWheel = undefined; momentum = false
        if (native || !timer) cancel()
        else clearTimeout(timer)
        native = true; released = false
        if (first) gesture.push(first)
      }
      else if (phase === 'cancel') { cancel(); native = true; released = true }
      else if (phase === 'momentum') {
        momentum = true; earlyWheel = undefined
        // Momentum reaching a newly navigated document must not start a swipe.
        if (!native) { native = true; released = true }
      } else if (phase === 'end' && !released) {
        // Ignore the inertial tail after fingers lift; it must not turn a short
        // preview into a navigation or move the page underneath the snapshot.
        released = true; ownsTail = horizontal && !blocked
        clearTimeout(timer)
        timer = setTimeout(() => { let claimed = horizontal && !blocked, tail = momentum; finish(); native = true; released = true; ownsTail = claimed; momentum = tail }, 32)
      }
    },
    get active() { return horizontal && !blocked },
    push: (wheel: Wheel) => {
      if (native && released) { if (!momentum) earlyWheel = wheel; return ownsTail }
      if (!native) clearTimeout(timer)
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
      if (!native) timer = setTimeout(finish, 220)
      // Suppress tiny vertical drift while a clearly horizontal start is still
      // below the preview threshold. Ambiguous or vertical input scrolls normally.
      return claimed || !blocked && Math.abs(x) > y * 1.5 && available(x < 0 ? 'back' : 'forward')
    },
  }
  return gesture
}

// Runs in an isolated world with no preload or privileged page API. A scroll
// that belongs to a page widget must never turn into browser navigation.
export let observeSwipe = (marker: string, createGesture: typeof createSwipeGesture, preview: (offset: number) => void, availability: Availability) => {
  if (window !== window.top) return
  let scope = globalThis as typeof globalThis & { bmuxSwipe?: { update: (next: Availability) => void; cancel: () => void; phase: (phase: 'begin' | 'end' | 'cancel' | 'momentum' | 'fallback') => void } }
  if (scope.bmuxSwipe) { scope.bmuxSwipe.update(availability); return }
  let report = console.debug.bind(console)
  let sequence = 0
  let gesture = createGesture(direction => report(marker + JSON.stringify({ kind: 'commit', direction, id: `${performance.timeOrigin}:${++sequence}` })), preview, direction => availability[direction])
  scope.bmuxSwipe = { cancel: gesture.cancel, phase: gesture.phase, update: next => {
    let changed = availability.back !== next.back || availability.forward !== next.forward
    availability = next
    if (changed) gesture.cancel()
  } }
  window.addEventListener('wheel', event => {
    if (!event.isTrusted || !event.deltaX && !event.deltaY) return
    let blocked = event.defaultPrevented || !event.cancelable || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    // Once claimed, the same gesture must not transfer back to page scrolling.
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

export let createSwipeNavigation = (contents: WebContents, enabled: () => boolean, surface?: () => SwipeSurface | undefined) => {
  let marker = `bmux-swipe:${randomUUID()}`
  let available = (direction: Direction) => !contents.isDestroyed() && enabled() && (direction === 'back' ? contents.navigationHistory.canGoBack() : contents.navigationHistory.canGoForward())
  let previous: string | undefined
  let pending = Promise.resolve()
  let world: Promise<number> | undefined
  let committed = new Set<string>()
  let commit: string | undefined
  let offset = 0, epoch = 0, showing = false, navigating = false, displayedDirection = 0
  let captured: Buffer | undefined
  let capturePending = false
  let captureTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let history: { currentIndex: number; entries: { id: number }[] } | undefined
  let native = surface ? createSwipeSurface(contents.id, () => enabled() ? surface() : undefined, phase => {
    if (!enabled()) return
    void run(`globalThis.bmuxSwipe?.phase(${JSON.stringify(phase)})`)
  }) : undefined
  let hide = () => { clearTimeout(hideTimer); native?.hide(); captured = undefined; offset = 0; showing = false; navigating = false }
  let dimensions = () => surface?.()?.bounds
  let readHistory = async () => {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    return await contents.debugger.sendCommand('Page.getNavigationHistory') as NonNullable<typeof history>
  }
  let capture = async (forSwipe = false) => {
    if (!surface || contents.isDestroyed() || capturePending || showing && !forSwipe) return
    let bounds = dimensions()
    if (!bounds || bounds.width < 1 || bounds.height < 1) return
    let version = epoch
    capturePending = true
    try {
      let before = await readHistory()
      let entry = before.entries[before.currentIndex]?.id
      if (entry === undefined) return
      let image = await contents.capturePage()
      if (contents.isDestroyed() || version !== epoch || image.isEmpty()) return
      let after = await readHistory()
      if (version !== epoch || after.entries[after.currentIndex]?.id !== entry) return
      history = after
      let size = image.getSize(), scale = Math.min(1, 1280 / Math.max(size.width, size.height))
      let jpeg = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toJPEG(70)
      swipeSnapshots.prune(contents.id, after.entries.map(entry => entry.id))
      swipeSnapshots.set(contents.id, entry, { image: jpeg, width: bounds.width, height: bounds.height })
      if (forSwipe && offset) {
        captured = jpeg
        display()
      }
    } catch { /* Capture must never block input, navigation or view attachment. */ }
    finally { capturePending = false; if (offset && !captured && version === epoch && !forSwipe) void capture(true) }
  }
  let display = () => {
    if (!captured || !offset || !enabled()) return
    let bounds = dimensions()
    if (!bounds) return
    let distance = Math.max(-bounds.width, Math.min(bounds.width, offset))
    if (showing && displayedDirection === Math.sign(offset)) { native?.move(distance); return }
    let entry = history?.entries[(history?.currentIndex ?? 0) + (offset > 0 ? -1 : 1)]?.id
    let previous = entry === undefined ? undefined : swipeSnapshots.get(contents.id, entry, bounds.width, bounds.height)
    native?.show(captured, previous, distance)
    showing = true; displayedDirection = Math.sign(offset)
  }
  let preview = (next: number) => {
    if (navigating || commit) return
    if (!next) {
      offset = 0
      clearTimeout(hideTimer)
      if (showing) { native?.move(0, 0.16); hideTimer = setTimeout(hide, 170) }
      return
    }
    clearTimeout(hideTimer)
    offset = next
    if (!captured) void capture(true)
    else display()
  }
  let scheduleCapture = () => { clearTimeout(captureTimer); captureTimer = setTimeout(() => { if (enabled() && !offset) void capture() }, 300) }

  let run = async (code: string) => {
    if (contents.isDestroyed()) return
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
      // CDP can update the isolated world while a document is still loading.
      // executeJavaScriptInIsolatedWorld waits for did-stop-loading, which could
      // otherwise hold automated input behind a stalled network request.
      world ??= contents.debugger.sendCommand('Page.getFrameTree').then(async ({ frameTree }) => {
        let context = await contents.debugger.sendCommand('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'bmux:swipe' })
        return context.executionContextId as number
      })
      let result = await contents.debugger.sendCommand('Runtime.evaluate', { expression: code, contextId: await world })
      if (result.exceptionDetails) previous = undefined
    } catch {
      // A navigation can replace the document mid-gesture. Retry on next input.
      world = undefined; previous = undefined
    }
  }
  let refresh = async () => {
    if (!enabled() && (showing || offset)) { epoch++; hide() }
    let next = JSON.stringify({ back: available('back'), forward: available('forward') })
    if (next === previous) return pending
    previous = next
    pending = run(`(${observeSwipe.toString()})(${JSON.stringify(marker)}, ${createSwipeGesture.toString()}, (offset => console.debug(${JSON.stringify(marker)} + JSON.stringify({ kind: "preview", offset }))), ${next})`)
    await pending
  }
  let cancel = () => { commit = undefined; previous = undefined; epoch++; hide(); void run('globalThis.bmuxSwipe?.cancel()') }
  contents.on('console-message', details => {
    if (!details.message.startsWith(marker)) return
    try {
      let { kind, offset: next, direction, id } = JSON.parse(details.message.slice(marker.length))
      if (kind === 'preview') { if (Number.isFinite(next) && Math.abs(next) < 100000 && enabled()) preview(next); return }
      if ((direction !== 'back' && direction !== 'forward') || typeof id !== 'string' || id.length > 96 || committed.has(id)) return
      // A commit may only be consumed once, including after its navigation has
      // replaced the document. Keep a bounded record across history changes.
      committed.add(id)
      if (committed.size > 64) committed.delete(committed.values().next().value!)
      commit = id
      // The renderer's following reset belongs to this commit, not a cancelled
      // swipe. Preserve the snapshot until the destination has painted.
      clearTimeout(hideTimer)
      // Leave Chromium's console notification stack before changing its page.
      // Navigation, blur or closure can revoke this queued commit in the meantime.
      setImmediate(() => {
        if (commit !== id) return
        commit = undefined
        if (!available(direction)) { cancel(); return }
        navigating = true
        native?.move((dimensions()?.width ?? 0) * (direction === 'back' ? 1 : -1), 0.18)
        hideTimer = setTimeout(hide, 1500)
        if (direction === 'back') contents.navigationHistory.goBack()
        else contents.navigationHistory.goForward()
      })
    } catch { /* Ignore unrelated console output. */ }
  })
  contents.on('did-start-navigation', details => {
    if (details.isMainFrame) { if (!navigating) cancel(); else { epoch++; previous = undefined }; if (!details.isSameDocument) world = undefined }
  })
  contents.on('dom-ready', () => { world = undefined; previous = undefined; void refresh(); scheduleCapture(); if (navigating) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 200) } })
  contents.on('did-finish-load', () => { if (enabled()) void capture() })
  contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) { void refresh(); scheduleCapture(); if (navigating) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 200) } } })
  // Eligibility can change with focus, overlays or automation. Send only state
  // changes; scroll cancellation stays synchronous in the page's isolated world.
  contents.on('before-mouse-event', () => { void refresh(); scheduleCapture() })
  contents.on('focus', () => { void refresh() })
  contents.on('blur', cancel)
  contents.on('render-process-gone', () => { cancel(); world = undefined; swipeSnapshots.clear(contents.id) })
  contents.once('destroyed', () => { epoch++; clearTimeout(captureTimer); clearTimeout(hideTimer); native?.dispose(); swipeSnapshots.clear(contents.id) })
  contents.debugger.on('detach', () => { world = undefined; previous = undefined })
  return Object.assign(refresh, { cancel })
}
