import { expect, test, vi } from 'vitest'
import { agentScrollParams, smoothAgentScroll } from '../src/main/agent-scroll'

test('uses varied mouse scroll bursts, preserves distance, and waits for the final burst', async () => {
  let calls: { method: string; params: Record<string, unknown> }[] = [], finish!: () => void, completed = false
  let random = vi.spyOn(Math, 'random')
  let sample = 0
  random.mockImplementation(() => (sample++ % 5) / 5)
  try {
    let scrolling = smoothAgentScroll(async (method, params) => {
      calls.push({ method, params })
      if (method === 'Input.synthesizeScrollGesture' && calls.filter(call => call.method === method).reduce((sum, call) => sum + Number(call.params.yDistance), 0) === -600) await new Promise<void>(resolve => { finish = resolve })
      return { result: { value: false } }
    }, { x: 400, y: 300, deltaX: -80, deltaY: 600 }).then(() => { completed = true })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    let bursts = calls.filter(call => call.method === 'Input.synthesizeScrollGesture')
    expect(bursts.length).toBeGreaterThan(1)
    expect(bursts.reduce((sum, call) => sum + Number(call.params.yDistance), 0)).toBe(-600)
    expect(bursts.reduce((sum, call) => sum + Number(call.params.xDistance), 0)).toBe(80)
    expect(new Set(bursts.map(call => call.params.speed)).size).toBeGreaterThan(1)
    for (let burst of bursts) {
      expect(burst.params).toMatchObject({ x: 400, y: 300, gestureSourceType: 'mouse', preventFling: true })
      expect(Number(burst.params.speed)).toBeGreaterThanOrEqual(850)
      expect(Number(burst.params.speed)).toBeLessThan(1500)
    }
    expect(completed).toBe(false)
    finish(); await scrolling
    expect(completed).toBe(true)
  } finally { random.mockRestore() }
})

test('honors reduced motion, preserves modified wheels, and skips zero-distance scrolling', async () => {
  let calls: { method: string; params: Record<string, unknown> }[] = []
  let send = async (method: string, params: Record<string, unknown>) => { calls.push({ method, params }); return { result: { value: true } } }
  await smoothAgentScroll(send, { x: 0, y: 0, deltaX: -50 })
  expect(calls.at(-1)).toMatchObject({ params: { xDistance: 50, speed: 10_000_000 } })
  await smoothAgentScroll(send, { type: 'mouseWheel', x: 0, y: 0, deltaY: 100, modifiers: 2 })
  expect(calls.at(-1)).toMatchObject({ method: 'Input.dispatchMouseEvent', params: { modifiers: 2 } })
  let count = calls.length
  await smoothAgentScroll(send, { x: 0, y: 0, deltaY: 0 })
  expect(calls).toHaveLength(count)
})

test('keeps full, half, top and bottom scroll targets within the document', () => {
  expect(agentScrollParams('scroll-down', 800, 600, 100, 4000).deltaY).toBe(100)
  expect(agentScrollParams('scroll-half-up', 800, 600, 100, 4000).deltaY).toBe(-300)
  expect(agentScrollParams('scroll-top', 800, 600, 100, 4000).deltaY).toBe(-100)
  expect(agentScrollParams('scroll-bottom', 800, 600, 100, 4000).deltaY).toBe(3300)
  expect(agentScrollParams('scroll-bottom', 800, 600, 0, 400).deltaY).toBe(0)
  expect(() => agentScrollParams('unknown', 800, 600, 100, 4000)).toThrow('Unknown scroll action')
})
