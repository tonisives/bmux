import { expect, test, vi } from 'vitest'
import { agentScrollParams, smoothAgentScroll } from '../src/main/agent-scroll'

test('mouse wheel follows a sine velocity curve and awaits the final input', async () => {
  vi.useFakeTimers()
  let calls: { method: string; params: Record<string, unknown>; at: number }[] = [], finish!: () => void, completed = false
  let random = vi.spyOn(Math, 'random').mockReturnValue(.5)
  try {
    let scrolling = smoothAgentScroll(async (method, params) => {
      calls.push({ method, params, at: Date.now() })
      if (method === 'Input.dispatchMouseEvent' && calls.filter(call => call.method === method).reduce((sum, call) => sum + Number(call.params.deltaY), 0) === 600) await new Promise<void>(resolve => { finish = resolve })
      return { result: { value: false } }
    }, { x: 400, y: 300, deltaX: -80, deltaY: 600 }).then(() => { completed = true })
    await vi.advanceTimersByTimeAsync(2000)
    let wheels = calls.filter(call => call.method === 'Input.dispatchMouseEvent')
    expect(finish).toBeTypeOf('function')
    expect(wheels.reduce((sum, call) => sum + Number(call.params.deltaY), 0)).toBe(600)
    expect(wheels.reduce((sum, call) => sum + Number(call.params.deltaX), 0)).toBe(-80)
    let middle = Number(wheels[Math.floor(wheels.length / 2)].params.deltaY)
    expect(middle).toBeGreaterThan(Number(wheels[0].params.deltaY) * 4)
    expect(middle).toBeGreaterThan(Number(wheels.at(-1)!.params.deltaY) * 4)
    expect(wheels.at(-1)!.at - wheels[0].at).toBeGreaterThan(500)
    expect(wheels.every(call => call.params.type === 'mouseWheel' && call.params.x === 400 && call.params.y === 300)).toBe(true)
    expect(completed).toBe(false)
    finish(); await vi.runAllTimersAsync(); await scrolling
    expect(completed).toBe(true)
  } finally { random.mockRestore(); vi.useRealTimers() }
})

test('successive scrolls vary the sine envelope and timing without drifting the endpoint', async () => {
  vi.useFakeTimers()
  let sample = 0, random = vi.spyOn(Math, 'random').mockImplementation(() => (sample++ % 17) / 17)
  try {
    let runs: { delta: number; at: number }[][] = []
    for (let index = 0; index < 2; index++) {
      let inputs: { delta: number; at: number }[] = []
      let scroll = smoothAgentScroll(async (method, params) => {
        if (method === 'Input.dispatchMouseEvent') inputs.push({ delta: Number(params.deltaY), at: Date.now() })
        return { result: { value: false } }
      }, { x: 40, y: 30, deltaY: -400 })
      await vi.runAllTimersAsync(); await scroll
      expect(inputs.reduce((sum, input) => sum + input.delta, 0)).toBe(-400)
      runs.push(inputs.map(input => ({ ...input, at: input.at - inputs[0].at })))
    }
    expect(runs[0]).not.toEqual(runs[1])
  } finally { random.mockRestore(); vi.useRealTimers() }
})

test('honors reduced motion, preserves modified wheels, and skips zero-distance scrolling', async () => {
  let calls: { method: string; params: Record<string, unknown> }[] = []
  let send = async (method: string, params: Record<string, unknown>) => { calls.push({ method, params }); return { result: { value: true } } }
  await smoothAgentScroll(send, { x: 0, y: 0, deltaX: -50 })
  expect(calls.at(-1)).toMatchObject({ params: { type: 'mouseWheel', deltaX: -50, deltaY: 0 } })
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

test('occasionally overshoots and corrects both axes to the exact requested distance', async () => {
  vi.useFakeTimers()
  let random = vi.spyOn(Math, 'random').mockReturnValue(.1)
  try {
    let positions: { x: number; y: number }[] = [], x = 0, y = 0
    let scroll = smoothAgentScroll(async (method, params) => {
      if (method === 'Input.dispatchMouseEvent') {
        x += Number(params.deltaX); y += Number(params.deltaY); positions.push({ x, y })
      }
      return { result: { value: { reducedMotion: false, roomX: 2000, roomY: 2000 } } }
    }, { x: 40, y: 30, deltaX: -120, deltaY: 600 })
    await vi.runAllTimersAsync(); await scroll
    expect(Math.max(...positions.map(point => point.y))).toBeGreaterThan(600)
    expect(Math.min(...positions.map(point => point.x))).toBeLessThan(-120)
    expect(positions.at(-1)).toEqual({ x: -120, y: 600 })
  } finally { random.mockRestore(); vi.useRealTimers() }
})

test('keeps corrections inside scroll boundaries and supports predictable or immediate overrides', async () => {
  vi.useFakeTimers()
  let random = vi.spyOn(Math, 'random').mockReturnValue(.1)
  try {
    for (let room of [600, 0]) {
      let positions: number[] = [], y = 0
      let scroll = smoothAgentScroll(async (method, params) => {
        if (method === 'Input.dispatchMouseEvent') { y += Number(params.deltaY); positions.push(y) }
        return { result: { value: { reducedMotion: false, roomY: room } } }
      }, { x: 40, y: 30, deltaY: 600 })
      await vi.runAllTimersAsync(); await scroll
      expect(Math.max(...positions)).toBe(600)
    }
    let send = vi.fn(async () => ({}))
    await smoothAgentScroll(send, { x: 0, y: 0, deltaY: 600 }, { enabled: false, randomize: true, overshoot: true })
    expect(send).toHaveBeenCalledExactlyOnceWith('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 0, y: 0, deltaX: 0, deltaY: 600 })
    random.mockClear()
    let scroll = smoothAgentScroll(send, { x: 0, y: 0, deltaY: 600 }, { enabled: true, randomize: false, overshoot: true })
    await vi.runAllTimersAsync(); await scroll
    expect(random).not.toHaveBeenCalled()
  } finally { random.mockRestore(); vi.useRealTimers() }
})


test('scaled viewports keep DOM hit testing in CSS pixels and transform only native wheel coordinates', async () => {
  vi.useFakeTimers()
  try {
    let calls: {method:string;params:Record<string,unknown>}[] = []
    let scrolling = smoothAgentScroll(async (method, params) => {
      calls.push({ method, params })
      return { result: { value: { reducedMotion: false, roomY: 1000 } } }
    }, { x: 832, y: 604, deltaY: 300 }, { enabled: true, randomize: false, overshoot: false }, .375)
    await vi.runAllTimersAsync(); await scrolling
    expect(calls[0].params.expression).toContain('document.elementFromPoint(832, 604)')
    let wheels = calls.filter(call => call.method === 'Input.dispatchMouseEvent')
    expect(wheels.length).toBeGreaterThan(10)
    expect(wheels.every(call => call.params.x === 312 && call.params.y === 226.5)).toBe(true)
    expect(wheels.reduce((sum, call) => sum + Number(call.params.deltaY), 0)).toBe(300)
  } finally { vi.useRealTimers() }
})


test('slow wheel replies merge frames without extending the animation or drifting', async () => {
  vi.useFakeTimers()
  try {
    let wheels: number[] = [], pending = 0, maximum = 0
    let scroll = smoothAgentScroll(async (method, params) => {
      if (method === 'Input.dispatchMouseEvent') {
        maximum = Math.max(maximum, ++pending)
        wheels.push(Number(params.deltaY))
        await new Promise(resolve => setTimeout(resolve, 120))
        pending--
      }
      return { result: { value: false } }
    }, { x: 20, y: 30, deltaY: 600 }, { enabled: true, randomize: false, overshoot: false })
    await vi.runAllTimersAsync()
    let result = await scroll
    expect(wheels.reduce((sum, delta) => sum + delta, 0)).toBe(600)
    expect(wheels.length).toBeLessThan(10)
    expect(maximum).toBe(1)
    expect(result.scroll.durationMs).toBeLessThan(1100)
    expect(result.scroll.maxEventMs).toBe(120)
    expect(result.scroll.events).toBe(wheels.length)
  } finally { vi.useRealTimers() }
})

test('stalled observation and wheel acknowledgements release the caller within the deadline', async () => {
  vi.useFakeTimers()
  try {
    for (let stalled of ['Runtime.evaluate', 'Input.dispatchMouseEvent']) {
      let calls: string[] = []
      let scroll = smoothAgentScroll(async method => {
        calls.push(method)
        if (method === stalled) return new Promise(() => undefined)
        return { result: { value: false } }
      }, { x: 20, y: 30, deltaY: 600 })
      let rejected = expect(scroll).rejects.toThrow(`Scroll ${stalled} timed out after 2000ms`)
      await vi.advanceTimersByTimeAsync(2100); await rejected
      let count = calls.length
      await vi.runAllTimersAsync()
      expect(calls).toHaveLength(count)
    }
  } finally { vi.useRealTimers() }
})

test('cancellation interrupts a pending wheel and ignores its late reply', async () => {
  vi.useFakeTimers()
  try {
    let controller = new AbortController(), calls = 0, finish!: () => void
    let scroll = smoothAgentScroll(async method => {
      if (method === 'Input.dispatchMouseEvent') { calls++; await new Promise<void>(resolve => { finish = resolve }) }
      return { result: { value: false } }
    }, { x: 20, y: 30, deltaY: 600 }, undefined, 1, { signal: controller.signal })
    let rejected = expect(scroll).rejects.toThrow('Stopped by user')
    await vi.advanceTimersByTimeAsync(10)
    controller.abort(new Error('Stopped by user')); await rejected
    finish(); await vi.runAllTimersAsync()
    expect(calls).toBe(1)
  } finally { vi.useRealTimers() }
})
