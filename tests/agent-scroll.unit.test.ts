import { expect, test } from 'vitest'
import { agentScrollParams, smoothAgentScroll } from '../src/main/agent-scroll'

test('uses a bounded smooth gesture and returns only after scrolling completes', async () => {
  let calls: { method: string; params: Record<string, unknown> }[] = [], finish!: () => void, completed = false
  let scrolling = smoothAgentScroll(async (method, params) => {
    calls.push({ method, params })
    if (method === 'Input.synthesizeScrollGesture') await new Promise<void>(resolve => { finish = resolve })
    return { result: { value: false } }
  }, { x: 400, y: 300, deltaY: 600 }).then(() => { completed = true })
  await Promise.resolve()
  expect(calls.at(-1)).toMatchObject({ method: 'Input.synthesizeScrollGesture', params: { x: 400, y: 300, yDistance: -600, preventFling: true } })
  expect(Number.isInteger(calls.at(-1)!.params.speed)).toBe(true)
  expect(Number(calls.at(-1)!.params.speed)).toBeGreaterThan(1000)
  expect(Number(calls.at(-1)!.params.speed)).toBeLessThan(1500)
  expect(completed).toBe(false)
  finish(); await scrolling
  expect(completed).toBe(true)
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
