import type { ScrollingSettings } from '../shared/scrolling'

// Runs in an isolated world. Keyboard scrolling must not depend on page wheel handlers.
export let keyboardScroll = (action: string, settings: ScrollingSettings) => {
  type Motion = { target: number; frame: number; finish: () => void }
  let scope = globalThis as typeof globalThis & { bmuxKeyboardScroll?: WeakMap<Element, Motion> }
  let motions = scope.bmuxKeyboardScroll ??= new WeakMap<Element, Motion>()
  let down = action.endsWith('down') || action === 'scroll-bottom'
  let node = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
  while (node && node !== document.scrollingElement) {
    let max = node.scrollHeight - node.clientHeight
    if (/^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY) && max > 1 && (down ? node.scrollTop < max - 1 : node.scrollTop > 0)) break
    node = node.parentElement
  }
  node ??= document.scrollingElement
  if (!node) return
  let element = node, previous = motions.get(element), start = element.scrollTop
  let max = Math.max(0, element.scrollHeight - element.clientHeight)
  let step = (action.includes('half') ? Math.round(innerHeight / 2) : 100) * (down ? 1 : -1)
  let base = previous && Math.sign(previous.target - start) === Math.sign(step) ? previous.target : start
  let target = Math.max(0, Math.min(max, action === 'scroll-top' ? 0 : action === 'scroll-bottom' ? max : base + step))
  if (previous) { cancelAnimationFrame(previous.frame); previous.finish() }
  let duration = Math.min(650, 40 + Math.sqrt(Math.abs(target - start)) * 10) * (settings.randomize ? .85 + Math.random() * .3 : 1)
  if (!settings.enabled || matchMedia('(prefers-reduced-motion: reduce)').matches || target === start) {
    element.scrollTo({ top: target, behavior: 'instant' }); motions.delete(element); return
  }
  return new Promise<void>(resolve => {
    let motion: Motion = { target, frame: 0, finish: resolve }, started = performance.now()
    let tick = (now: number) => {
      let progress = Math.min(1, (now - started) / duration)
      // Start promptly, including when autorepeat extends the current target.
      element.scrollTo({ top: start + (target - start) * (1 - (1 - progress) ** 3), behavior: 'instant' })
      if (progress < 1) motion.frame = requestAnimationFrame(tick)
      else { motions.delete(element); resolve() }
    }
    motions.set(element, motion)
    motion.frame = requestAnimationFrame(tick)
  })
}
