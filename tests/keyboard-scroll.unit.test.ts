import { expect, test, vi } from 'vitest'
import { keyboardScroll } from '../src/main/keyboard-scroll'

// Chromium may coalesce scroll events on a busy native desktop. Drive animation
// frames here to check intermediate positions independently of event delivery.
test('keyboard scrolling animates intermediate positions and accumulates pending keys', async () => {
  let frames = new Map<number, FrameRequestCallback>(), next = 0, positions: number[] = []
  let element = { scrollTop: 0, scrollHeight: 6000, clientHeight: 800, scrollTo: ({ top }: { top: number }) => { element.scrollTop = top; positions.push(top) } }
  let frame = (now: number) => { let pending = [...frames.values()]; frames.clear(); for (let callback of pending) callback(now) }
  vi.stubGlobal('document', { scrollingElement: element, elementFromPoint: () => element })
  vi.stubGlobal('innerWidth', 1200); vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  let settings = { enabled: true, randomize: false, overshoot: false }
  try {
    let finished = false
    let scrolling = keyboardScroll('scroll-down', settings)!.then(() => { finished = true })
    frame(0); frame(35); frame(70)
    expect(positions[1]).toBeGreaterThan(0)
    expect(positions[2]).toBeGreaterThan(positions[1])
    expect(positions[2]).toBeLessThan(100)
    expect(finished).toBe(false)
    let repeated = keyboardScroll('scroll-down', settings)!
    await scrolling
    expect(finished).toBe(true)
    frame(80); frame(1000); await repeated
    expect(element.scrollTop).toBe(200)
    expect(frames.size).toBe(0)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(keyboardScroll('scroll-up', settings)).toBeUndefined()
    expect(element.scrollTop).toBe(100)
    expect(frames.size).toBe(0)
  } finally { vi.unstubAllGlobals() }
})
