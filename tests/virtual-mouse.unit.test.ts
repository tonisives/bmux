import { expect, test } from 'vitest'
import { createVirtualMouse } from '../src/main/virtual-mouse'

test('moves along a curved path to the exact target and remembers each pane separately', async () => {
  let events: Record<string, unknown>[] = [], waits: number[] = []
  let mouse = createVirtualMouse(async ms => { waits.push(ms) })
  let send = async (method: string, params: Record<string, unknown>) => {
    if (method === 'Input.dispatchMouseEvent') events.push(params)
    return { result: { value: { width: 1000, height: 800 } } }
  }
  await mouse.move('one', { x: 100, y: 200 }, send, () => {})
  expect(events[0]).toMatchObject({ type: 'mouseMoved', x: 500, y: 400 })
  expect(events.at(-1)).toMatchObject({ x: 100, y: 200, button: 'none' })
  expect(events[10].y).toBeLessThan(300)
  expect(waits.reduce((a, b) => a + b, 0)).toBe(320)
  events = []
  await mouse.move('one', { x: 800, y: 600 }, send, () => {})
  expect(events[0]).toMatchObject({ x: 100, y: 200 })
  events = []
  await mouse.move('two', { x: 700, y: 500 }, send, () => {})
  expect(events[0]).toMatchObject({ x: 500, y: 400 })
})

test('stops before clicking when the document or control changes during movement', async () => {
  let moves = 0, sleeps = 0
  let mouse = createVirtualMouse(async () => { sleeps++ })
  let send = async (method: string) => {
    if (method === 'Input.dispatchMouseEvent') moves++
    return { result: { value: { width: 1000, height: 800 } } }
  }
  await expect(mouse.move('one', { x: 100, y: 200 }, send, () => { if (sleeps === 4) throw new Error('Document changed') })).rejects.toThrow('Document changed')
  expect(moves).toBe(4)
  await expect(mouse.move('one', { x: Infinity, y: 200 }, send, () => {})).rejects.toThrow('Invalid mouse coordinates')
})
