import { expect, test, vi } from 'vitest'
import { createContext, runInContext } from 'node:vm'
import { readsPage, withAgentReading } from '../src/main/agent-reading'

let fixture = () => {
  let overlay: any, nodes: any[] = [], regions = [{ left: 30, top: 80, right: 700, bottom: 500 }]
  let motion = Object.assign(new EventTarget(), { matches: false })
  let element = (): any => Object.assign(new EventTarget(), {
    style: { setProperty(key: string, value: string) { this[key] = value } } as Record<string, any>,
    attributes: {} as Record<string, string>,
    setAttribute(key: string, value: string) { this.attributes[key] = value }, append: (...children: any[]) => { nodes.push(...children) }, attachShadow: () => ({ append: () => {} }),
    animate: vi.fn(() => ({ cancel: vi.fn() }))
  })
  class ReadingEvent extends Event { detail: unknown; constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail } }
  let events = new EventTarget()
  let context = createContext({ setTimeout, clearTimeout, requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16), addEventListener: events.addEventListener.bind(events), innerWidth: 1000, innerHeight: 800, CustomEvent: ReadingEvent, matchMedia: () => motion,
    document: { getElementById: () => overlay, createElement: element, createElementNS: element, querySelectorAll: () => regions.map(rect => ({ getBoundingClientRect: () => rect })), documentElement: { append: (node: any) => { overlay = node } } } })
  let send = async (_method: string, params: Record<string, unknown>) => runInContext(String(params.expression), context)
  return { send, motion, overlay: () => overlay, shade: () => nodes[0], wisp: () => nodes[1], events, regions, navigate: () => { overlay = undefined; nodes = [] } }
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

test('outlines the viewport and large visible sections with moving wisps and tracks scrolling', async () => {
  vi.useFakeTimers()
  try {
    let { send, overlay, shade, wisp, regions, events } = fixture()
    await withAgentReading(send, async () => 'content')
    await vi.advanceTimersByTimeAsync(0)
    expect(overlay().attributes['data-regions']).toBe('2')
    expect(shade().attributes).toMatchObject({ x: '5', y: '5', width: '990', height: '790', 'stroke-width': '2' })
    expect(wisp().attributes).toMatchObject({ 'stroke-width': '4', 'stroke-dasharray': '12 88' })
    expect(wisp().animate).toHaveBeenCalledWith([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], expect.objectContaining({ iterations: Infinity }))
    regions[0].bottom = -20
    events.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(16)
    expect(overlay().attributes['data-regions']).toBe('1')
  } finally { vi.useRealTimers() }
})

test('a pending or rejected visual update does not delay or fail the read', async () => {
  expect(await withAgentReading(() => new Promise(() => {}), async () => 'content')).toBe('content')
  expect(await withAgentReading(async () => { throw new Error('Document changed') }, async () => 'content')).toBe('content')
})

test('a read can finish across same-page navigation without ending a replacement document read', async () => {
  vi.useFakeTimers()
  try {
    let { send, overlay, navigate } = fixture(), finish!: () => void, current = true
    let first = withAgentReading(send, () => new Promise<void>(resolve => { finish = resolve }), () => current)
    await vi.advanceTimersByTimeAsync(0)
    current = false
    finish(); await first
    await vi.advanceTimersByTimeAsync(2400)
    expect(overlay().style.display).toBe('none')
    let oldRead = withAgentReading(send, () => new Promise<void>(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(0)
    navigate()
    let finishNew!: () => void
    let newRead = withAgentReading(send, () => new Promise<void>(resolve => { finishNew = resolve }))
    await vi.advanceTimersByTimeAsync(0)
    finish(); await oldRead
    await vi.advanceTimersByTimeAsync(3000)
    expect(overlay().style.display).toBe('block')
    finishNew(); await newRead
    await vi.advanceTimersByTimeAsync(2400)
    expect(overlay().style.display).toBe('none')
  } finally { vi.useRealTimers() }
})
