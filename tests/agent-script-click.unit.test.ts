import { expect, test } from 'vitest'
import { withAgentScriptClicks } from '../src/main/agent-script-click'

let fixture = (fail = false) => {
  let calls: { method: string; params: Record<string, unknown> }[] = [], paused: ((event: any) => void) | undefined, name = '', resumed!: () => void
  let continued = new Promise<void>(resolve => { resumed = resolve }), moved = false, unsubscribed = false
  let send = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    let source = String(params.expression ?? params.functionDeclaration ?? '')
    if (source.includes('function bmuxAgentClick_')) { name = source.match(/function (bmuxAgentClick_\w+)/)![1]; return { result: { objectId: 'cleanup' } } }
    if (method === 'Debugger.evaluateOnCallFrame') return { result: { value: { x: 120, y: 80 } } }
    if (method === 'Debugger.resume') resumed()
    return {}
  }
  let run = (method = 'Runtime.evaluate', params: Record<string, unknown> = {}) => withAgentScriptClicks(method, params, send, callback => { paused = callback; return () => { unsubscribed = true } }, async (point, visual) => {
    expect(point).toEqual({ x: 120, y: 80 })
    await visual('Runtime.evaluate', { expression: 'draw pointer' })
    await visual('Input.dispatchMouseEvent', { type: 'mouseMoved' })
    if (fail) throw new Error('Document changed')
    moved = true
  }, async () => {
    paused!({ callFrames: [{ callFrameId: 'click-frame', functionName: name }] })
    await continued
    if (!fail) expect(moved).toBe(true)
    return 'script result'
  })
  return { run, calls, unsubscribed: () => unsubscribed }
}

test('moves before resuming synchronous clicks and restores the DOM method afterward', async () => {
  let { run, calls, unsubscribed } = fixture()
  expect(await run('Runtime.evaluate', { contextId: 9 })).toBe('script result')
  expect(calls.find(call => call.method === 'Runtime.evaluate')!.params.contextId).toBe(9)
  expect(calls.find(call => call.params.expression === 'draw pointer')!.params.callFrameId).toBe('click-frame')
  expect(calls.some(call => call.method === 'Input.dispatchMouseEvent')).toBe(false)
  expect(calls.slice(-3).map(call => call.method)).toEqual(['Runtime.callFunctionOn', 'Runtime.releaseObject', 'Debugger.disable'])
  expect(unsubscribed()).toBe(true)
})

test('prevents the original click after a movement failure, resumes and cleans up', async () => {
  let { run, calls, unsubscribed } = fixture(true)
  await expect(run('Runtime.callFunctionOn', { objectId: 'original-context' })).rejects.toThrow('Document changed')
  expect(calls.find(call => call.method === 'Runtime.callFunctionOn')!.params.objectId).toBe('original-context')
  let cancel = calls.findIndex(call => call.params.expression === 'proceed = false')
  expect(cancel).toBeGreaterThan(0)
  expect(calls[cancel + 1].method).toBe('Debugger.resume')
  expect(calls.at(-1)!.method).toBe('Debugger.disable')
  expect(unsubscribed()).toBe(true)
})
