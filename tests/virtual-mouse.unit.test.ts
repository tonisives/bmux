import { expect, test } from 'vitest'
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

test('chooses a fresh post-click pause within the 0.8–1.2 second range', async () => {
  let { mouse, waits, events } = fixture()
  for (let click = 0; click < 40; click++) await mouse.pauseAfterClick()
  expect(waits).toHaveLength(40)
  expect(waits.every(wait => wait >= 800 && wait <= 1200)).toBe(true)
  expect(new Set(waits).size).toBeGreaterThan(1)
  expect(events).toHaveLength(0)
})

test('shows CLI activity without dispatching mouse input and keeps each pane position separate', async () => {
  let { mouse, send, events, expressions } = fixture()
  await mouse.show('one', send, () => {})
  expect(events).toHaveLength(0)
  expect(expressions.at(-1)).toContain('translate(500px,400px)')
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  await mouse.show('one', send, () => {})
  expect(expressions.at(-1)).toContain('translate(100px,200px)')
  await mouse.show('two', send, () => {})
  expect(expressions.at(-1)).toContain('translate(500px,400px)')
  mouse.forget('one')
  await mouse.show('one', send, () => {})
  expect(expressions.at(-1)).toContain('translate(500px,400px)')
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
