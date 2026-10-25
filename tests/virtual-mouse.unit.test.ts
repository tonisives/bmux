import { expect, test, vi } from 'vitest'
import { createContext, runInContext } from 'node:vm'
import { DEFAULT_AGENT_FEEDBACK, resolveAgentFeedback } from '../src/shared/agent-feedback'
import { createVirtualMouse } from '../src/main/virtual-mouse'

let randomSequence = (seed = 42) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
let fixture = () => {
  let events: Record<string, any>[] = [], waits: number[] = [], expressions: string[] = []
  let mouse = createVirtualMouse(async ms => { waits.push(ms) }, randomSequence())
  let send = async (method: string, params: Record<string, unknown>) => {
    if (method === 'Input.dispatchMouseEvent') events.push(params)
    if (method === 'Runtime.evaluate') expressions.push(String(params.expression))
    return { result: { value: { width: 1000, height: 800 } } }
  }
  return { mouse, send, events, waits, expressions }
}

test('shows CLI activity without dispatching mouse input and keeps each pane position separate', async () => {
  let { mouse, send, events, expressions } = fixture()
  await mouse.show('one', send, () => {})
  expect(events).toHaveLength(0)
  expect(expressions.at(-1)).toContain('"x":500,"y":400')
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  await mouse.show('one', send, () => {})
  expect(expressions.at(-1)).toContain('"x":100,"y":200')
  await mouse.show('two', send, () => {})
  expect(expressions.at(-1)).toContain('"x":500,"y":400')
  mouse.forget('one')
  await mouse.show('one', send, () => {})
  expect(expressions.at(-1)).toContain('"x":500,"y":400')
})

test('shows wheel targets independently in four panes without dispatching hover input', async () => {
  let { mouse, send, events, expressions } = fixture()
  for (let index = 0; index < 4; index++) await mouse.show(`pane-${index}`, send, () => {}, { x: 100 + index * 50, y: 200 + index * 50 })
  for (let index = 0; index < 4; index++) {
    await mouse.show(`pane-${index}`, send, () => {})
    expect(expressions.at(-1)).toContain(`"x":${100 + index * 50},"y":${200 + index * 50}`)
  }
  await mouse.show('pane-0', send, () => {}, { x: -10, y: 900 })
  expect(expressions.at(-1)).toContain('"x":0,"y":799')
  expect(events).toEqual([])
})

test('shows click halos, fades bounded movement trails, rotates only while idle, and honors reduced motion', async () => {
  vi.useFakeTimers()
  try {
    let elements: any[] = [], pointer: any
    let element = (tag: string): any => {
      let node = Object.assign(new EventTarget(), {
        tag, id: '', style: { cssText: '', setProperty(key: string, value: string) { this[key] = value } } as Record<string, any>,
        attributes: {} as Record<string, string>, append: () => {}, setAttribute(key: string, value: string) { this.attributes[key] = value }, attachShadow: () => ({ append: () => {} }),
        animate: vi.fn(() => ({ cancel: vi.fn(), play: vi.fn() }))
      })
      elements.push(node)
      return node
    }
    let motion = Object.assign(new EventTarget(), { matches: false })
    class CursorEvent extends Event { detail: unknown; constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail } }
    let context = createContext({
      innerWidth: 1000, innerHeight: 800, CustomEvent: CursorEvent, Date, setTimeout, clearTimeout,
      matchMedia: () => motion,
      document: { getElementById: () => pointer, createElement: element, createElementNS: (_ns: string, tag: string) => element(tag), documentElement: { append: (node: any) => { pointer = node } } }
    })
    let settings = { ...DEFAULT_AGENT_FEEDBACK }
    let mouse = createVirtualMouse(async () => {}, undefined, () => resolveAgentFeedback(settings)), send = async (method: string, params: Record<string, unknown>) => ({ result: { value: method === 'Runtime.evaluate' ? runInContext(String(params.expression), context) : undefined } })
    await mouse.show('one', send, () => {})
    let pulse = elements.find(node => node.tag === 'span'), wedge = elements.find(node => node.tag === 'svg')
    expect(pointer.style.display).toBe('block')
    expect(wedge.animate).toHaveBeenCalledTimes(1)
    expect(pulse.animate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(19000)
    expect(pointer.style.display).toBe('block')
    await mouse.show('one', send, () => {})
    vi.advanceTimersByTime(19000)
    expect(pointer.style.display).toBe('block')
    vi.advanceTimersByTime(1000)
    expect(pointer.style.display).toBe('none')
    await mouse.show('one', send, () => {})
    expect(pointer.style.display).toBe('block')
    await mouse.click('one', send)
    expect(pulse.animate).toHaveBeenCalledTimes(1)
    let rotations = wedge.animate.mock.results[0].value.play.mock.calls.length
    await mouse.move('one', { x: 200, y: 300 }, send, () => {})
    let lines = elements.filter(node => node.tag === 'polyline'), trail = elements.filter(node => node.tag === 'svg')[1]
    expect(lines).toHaveLength(2)
    expect(lines[0].attributes.points.split(' ')).toHaveLength(16)
    expect(trail.style.opacity).toBe('1')
    expect(wedge.animate.mock.results[0].value.play).toHaveBeenCalledTimes(rotations + 1)
    // The halo stays at the clicked point as the arrow moves away.
    expect(pulse.style.left).toBe('300px'); expect(pulse.style.top).toBe('100px')
    vi.advanceTimersByTime(100)
    expect(wedge.animate.mock.results[0].value.play).toHaveBeenCalledTimes(rotations + 2)
    expect(trail.animate).toHaveBeenCalledTimes(1)
    settings = { ...settings, color: '#aabbcc', cursorSize: 40, haloSize: 90, cursorHideMs: 0 }
    await mouse.configure('one', send)
    expect(elements.find(node => node.tag === 'path').attributes.fill).toBe('#aabbcc')
    expect(wedge.attributes.width).toBe('40'); expect(pulse.style.width).toBe('90px')
    vi.advanceTimersByTime(30000); expect(pointer.style.display).toBe('block')
    // Applying a shorter hide time respects the original activity deadline.
    settings = { ...settings, cursorHideMs: 1000 }
    await mouse.configure('one', send)
    expect(pointer.style.display).toBe('none')
    await mouse.show('one', send, () => {})
    await mouse.click('one', send)
    motion.matches = true; motion.dispatchEvent(new Event('change'))
    expect(wedge.animate.mock.results[0].value.cancel).toHaveBeenCalled()
    expect(pulse.animate.mock.results[0].value.cancel).toHaveBeenCalled()
    expect(trail.animate.mock.results[0].value.cancel).toHaveBeenCalled()
    expect(trail.style.opacity).toBe('0')
    await mouse.click('one', send)
    expect(pulse.animate).toHaveBeenCalledTimes(2)
    await mouse.setHidden('one', true, send)
    await mouse.show('one', send, () => {})
    await mouse.click('one', send)
    expect(pointer.style.display).toBe('none')
    expect([...mouse.hiddenTabs]).toEqual(['one'])
    await mouse.setHidden('one', false, send)
    await mouse.show('one', send, () => {})
    expect(pointer.style.display).toBe('block')
    await mouse.setHidden('one', true, send)
    mouse.forget('one')
    expect([...mouse.hiddenTabs]).toEqual([])
  } finally { vi.useRealTimers() }
})

test('varies direction and speed, lands exactly on the target, and starts from its last position', async () => {
  let { mouse, send, events, waits } = fixture()
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  expect(events[0]).toMatchObject({ type: 'mouseMoved', x: 500, y: 400 })
  expect(events.at(-1)).toMatchObject({ x: 100, y: 200, button: 'none' })
  expect(events.every(event => event.x >= 0 && event.x < 1000 && event.y >= 0 && event.y < 800)).toBe(true)
  // The cross product measures deviation from the direct line between endpoints.
  expect(events.some(event => Math.abs((event.x - 500) * -200 - (event.y - 400) * -400) > 100)).toBe(true)
  let speeds = events.slice(1).map((event, index) => Math.hypot(event.x - events[index].x, event.y - events[index].y) / waits[index])
  expect(Math.max(...speeds)).toBeGreaterThan(speeds[0] * 3)
  expect(speeds.at(-1)).toBeLessThan(Math.max(...speeds) / 3)
  expect(new Set(waits).size).toBeGreaterThan(1)
  let previousCount = events.length
  await mouse.move('one', { x: 800, y: 600 }, send, () => {})
  expect(events[previousCount]).toMatchObject({ x: 100, y: 200 })
})

test('chooses a different route and timing for repeated trips to the same target', async () => {
  let { mouse, send, events, waits } = fixture()
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  let first = events.splice(0), firstWaits = waits.splice(0)
  mouse.forget('one')
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  expect(events[0]).toEqual(first[0])
  expect(events.at(-1)).toEqual(first.at(-1))
  expect(events.slice(1, -1)).not.toEqual(first.slice(1, -1))
  expect(waits).not.toEqual(firstWaits)
})

test('pressing a target already reached by a hover keeps the pointer still', async () => {
  let { mouse, send, events, waits } = fixture()
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  let previousCount = events.length, previousWaits = waits.length
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  expect(events).toHaveLength(previousCount)
  expect(waits).toHaveLength(previousWaits)
})

test('stops before clicking when the document or control changes during movement', async () => {
  let moves = 0, sleeps = 0
  let mouse = createVirtualMouse(async () => { sleeps++ }, randomSequence())
  let send = async (method: string) => {
    if (method === 'Input.dispatchMouseEvent') moves++
    return { result: { value: { width: 1000, height: 800 } } }
  }
  await expect(mouse.move('one', { x: 100, y: 200 }, send, () => { if (sleeps === 4) throw new Error('Document changed') })).rejects.toThrow('Document changed')
  expect(moves).toBe(4)
  await expect(mouse.move('one', { x: Infinity, y: 200 }, send, () => {})).rejects.toThrow('Invalid mouse coordinates')
})


test('resolves each pane profile color while preserving an explicit custom color', async () => {
  let settings = { ...DEFAULT_AGENT_FEEDBACK }, profiles: Record<string, string> = { one: 'profile_one', two: 'profile_two' }, expressions: string[] = []
  let mouse = createVirtualMouse(async () => {}, undefined, tab => resolveAgentFeedback(settings, profiles[tab]))
  let send = async (_method: string, params: Record<string, unknown>) => { expressions.push(String(params.expression)); return { result: { value: { width: 1000, height: 800 } } } }
  await mouse.show('one', send, () => {})
  expect(expressions.at(-2)).toContain('"color":"#b891c7"')
  await mouse.show('two', send, () => {})
  expect(expressions.at(-2)).toContain('"color":"#87ad91"')
  settings.color = '#123456'
  for (let tab of ['one', 'two']) { await mouse.configure(tab, send); expect(expressions.at(-1)).toContain('"color":"#123456"') }
  settings.color = 'profile'
  await mouse.configure('one', send)
  expect(expressions.at(-1)).toContain('"color":"#b891c7"')
})
