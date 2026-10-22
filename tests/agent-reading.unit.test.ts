import { expect, test, vi } from 'vitest'
import { createContext, runInContext } from 'node:vm'
import { readsPage, withAgentReading } from '../src/main/agent-reading'

let fixture = () => {
  let overlay: any, shade: any
  let motion = Object.assign(new EventTarget(), { matches: false })
  let element = (): any => Object.assign(new EventTarget(), {
    style: { setProperty(key: string, value: string) { this[key] = value } } as Record<string, any>,
    setAttribute: () => {}, attachShadow: () => ({ append: (node: any) => { shade = node } }),
    animate: vi.fn(() => ({ cancel: vi.fn() }))
  })
  class ReadingEvent extends Event { detail: unknown; constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail } }
  let context = createContext({ setTimeout, clearTimeout, CustomEvent: ReadingEvent, matchMedia: () => motion,
    document: { getElementById: () => overlay, createElement: element, documentElement: { append: (node: any) => { overlay = node } } } })
  let send = async (_method: string, params: Record<string, unknown>) => runInContext(String(params.expression), context)
  return { send, motion, overlay: () => overlay, shade: () => shade }
}

test('recognizes content reads without treating clicks, screenshots, waits, or navigation as reads', () => {
  for (let method of ['dom', 'eval', 'forms.inspect']) expect(readsPage(method)).toBe(true)
  for (let method of ['Runtime.evaluate', 'Runtime.callFunctionOn', 'DOM.getDocument', 'DOM.querySelector', 'DOMSnapshot.captureSnapshot', 'Accessibility.getFullAXTree']) expect(readsPage('cdp', { method })).toBe(true)
  for (let method of ['click', 'navigate', 'screenshot', 'wait', 'type']) expect(readsPage(method)).toBe(false)
  for (let method of ['Input.dispatchMouseEvent', 'Page.navigate', 'DOM.setAttributeValue']) expect(readsPage('cdp', { method })).toBe(false)
})

test('pulses during overlapping reads and for 2.4 seconds after the last read completes', async () => {
  vi.useFakeTimers()
  try {
    let { send, overlay, shade } = fixture(), finish!: () => void
    let first = withAgentReading(send, () => new Promise<void>(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(10000)
    expect(overlay().style.display).toBe('block')
    expect(shade().animate).toHaveBeenCalledTimes(1)
    await withAgentReading(send, async () => 'second')
    await vi.advanceTimersByTimeAsync(3000)
    expect(overlay().style.display).toBe('block')
    finish(); await first
    await vi.advanceTimersByTimeAsync(2399)
    expect(overlay().style.display).toBe('block')
    await vi.advanceTimersByTimeAsync(1)
    expect(overlay().style.display).toBe('none')
    expect(shade().animate.mock.results[0].value.cancel).toHaveBeenCalled()
    await withAgentReading(send, async () => 'fresh')
    await vi.advanceTimersByTimeAsync(0)
    expect(overlay().style.display).toBe('block')
    expect(shade().animate).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers() }
})

test('respects reduced motion and clears feedback after a failed read', async () => {
  vi.useFakeTimers()
  try {
    let { send, motion, overlay, shade } = fixture()
    motion.matches = true
    await expect(withAgentReading(send, async () => { throw new Error('Read failed') })).rejects.toThrow('Read failed')
    await vi.advanceTimersByTimeAsync(0)
    expect(overlay().style.display).toBe('block')
    expect(shade().animate).not.toHaveBeenCalled()
    motion.matches = false; motion.dispatchEvent(new Event('change'))
    expect(shade().animate).toHaveBeenCalledTimes(1)
    motion.matches = true; motion.dispatchEvent(new Event('change'))
    expect(shade().animate.mock.results[0].value.cancel).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2400)
    expect(overlay().style.display).toBe('none')
  } finally { vi.useRealTimers() }
})

test('a pending or rejected visual update does not delay or fail the read', async () => {
  expect(await withAgentReading(() => new Promise(() => {}), async () => 'content')).toBe('content')
  expect(await withAgentReading(async () => { throw new Error('Document changed') }, async () => 'content')).toBe('content')
})
