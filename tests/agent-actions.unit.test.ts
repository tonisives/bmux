import { DEFAULT_AGENT_FEEDBACK } from '../src/shared/agent-feedback'
import { expect, test, vi } from 'vitest'
import { agentAction, agentActionInput, createAgentActions } from '../src/main/agent-actions'

let deferred = () => { let resolve!: () => void; let promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

test('chooses a fresh 0.8–1.2 second pause after every action, including scrolls', async () => {
  let waits: number[] = [], actions = createAgentActions(async ms => { waits.push(ms) })
  for (let action = 0; action < 40; action++) await actions.run('one', 'profile', () => ['file:///fixture.html'], async () => {})
  expect(waits.every(wait => wait >= 800 && wait <= 1200)).toBe(true)
  expect(new Set(waits).size).toBeGreaterThan(1)
})

test('locks a domain within a profile through completion and the full cooldown', async () => {
  vi.useFakeTimers()
  try {
    let actions = createAgentActions(undefined, () => .5), events: string[] = [], finish = deferred()
    let first = actions.run('one', 'profile', () => ['https://www.example.com/'], async () => { events.push('first'); await finish.promise })
    let second = actions.run('two', 'profile', () => ['http://example.com:8080/'], async () => { events.push('second') })
    let other = actions.run('three', 'profile', () => ['https://unrelated.com/'], async () => { events.push('other') })
    let anotherProfile = actions.run('four', 'another-profile', () => ['https://example.com/'], async () => { events.push('another-profile') })
    await vi.advanceTimersByTimeAsync(5000)
    expect(events).toEqual(['first', 'other', 'another-profile'])
    finish.resolve()
    await vi.advanceTimersByTimeAsync(999)
    expect(events).not.toContain('second')
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toContain('second')
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([first, second, other, anotherProfile])
  } finally { vi.useRealTimers() }
})

test('serializes one pane across domains, follows a queued navigation, and releases failures', async () => {
  let waits: number[] = [], actions = createAgentActions(async ms => { waits.push(ms) }, () => 0), events: string[] = [], finish = deferred(), url = 'https://before.com/'
  let first = actions.run('one', 'profile', () => [url], async () => { events.push('first'); await finish.promise; url = 'https://after.com/' })
  let second = actions.run('one', 'profile', () => [url], async () => { events.push('second'); throw new Error('Failed') })
  let failed = expect(second).rejects.toThrow('Failed')
  await Promise.resolve(); finish.resolve(); await first; await failed
  await actions.run('two', 'profile', () => [url], async () => { events.push('third') })
  expect(events).toEqual(['first', 'second', 'third'])
  expect(waits).toEqual([800, 800, 800])
})

test('nested plugin commands share the action lock and pause once', async () => {
  let waits: number[] = [], actions = createAgentActions(async ms => { waits.push(ms) }, () => 1)
  let result = await actions.run('one', 'profile', () => ['https://example.com/'], () => actions.run('one', 'profile', () => ['https://example.com/'], async () => 'content'))
  expect(result).toBe('content')
  expect(waits).toEqual([1200])
})

test('navigation holds both the source and destination domain until its pause finishes', async () => {
  vi.useFakeTimers()
  try {
    let actions = createAgentActions(undefined, () => 0), events: string[] = []
    let navigating = actions.run('one', 'profile', () => ['https://source.com/', 'https://destination.com/'], async () => { events.push('navigation') })
    let target = actions.run('two', 'profile', () => ['https://destination.com/'], async () => { events.push('destination') })
    let source = actions.run('three', 'profile', () => ['https://source.com/'], async () => { events.push('source') })
    await vi.advanceTimersByTimeAsync(799)
    expect(events).toEqual(['navigation'])
    await vi.advanceTimersByTimeAsync(801)
    await Promise.all([navigating, target, source])
    expect(events).toEqual(['navigation', 'destination', 'source'])
  } finally { vi.useRealTimers() }
})

test('raw input holds its domain lock until release without delaying the press or release', async () => {
  vi.useFakeTimers()
  try {
    let actions = createAgentActions(undefined, () => .5), events: string[] = [], url = () => ['https://example.com/']
    await actions.run('one', 'profile', url, async () => { events.push('down') }, { owner: 'agent', type: 'down', key: 'mouse:left' })
    let second = actions.run('two', 'profile', url, async () => { events.push('second') })
    await vi.advanceTimersByTimeAsync(5000)
    expect(events).toEqual(['down'])
    let released = actions.run('one', 'profile', url, async () => { events.push('up') }, { owner: 'agent', type: 'up', key: 'mouse:left' })
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['down', 'up'])
    await vi.advanceTimersByTimeAsync(999)
    expect(events).not.toContain('second')
    await vi.advanceTimersByTimeAsync(1001)
    await Promise.all([second, released])
    expect(events).toEqual(['down', 'up', 'second'])
  } finally { vi.useRealTimers() }
})

test('abandoned raw input expires and does not strand other panes', async () => {
  vi.useFakeTimers()
  try {
    let actions = createAgentActions(undefined, () => 0), invoked = false, url = () => ['https://example.com/']
    await actions.run('one', 'profile', url, async () => {}, { owner: 'agent', type: 'down', key: 'key:Shift' })
    let second = actions.run('two', 'profile', url, async () => { invoked = true })
    await vi.advanceTimersByTimeAsync(20799)
    expect(invoked).toBe(false)
    await vi.advanceTimersByTimeAsync(801)
    await second
    expect(invoked).toBe(true)
  } finally { vi.useRealTimers() }
})

test('paces scroll commands, raw wheel gestures, clicks, keys, typing and navigation', () => {
  for (let method of ['scroll', 'click', 'type', 'key', 'navigate', 'forms.fill', 'eval']) expect(agentAction(method)).toBe(true)
  for (let method of ['dom', 'wait', 'screenshot', 'forms.inspect']) expect(agentAction(method)).toBe(false)
  expect(agentAction('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel' } })).toBe(true)
  expect(agentAction('cdp', { method: 'Input.synthesizeScrollGesture' })).toBe(true)
  expect(agentActionInput('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', button: 'left' } }, 'agent')).toEqual({ owner: 'agent', type: 'up', key: 'mouse:left' })
})


test('uses live action pause limits and permits zero without changing action serialization', async () => {
  let settings = { ...DEFAULT_AGENT_FEEDBACK, actionDelayMinMs: 100, actionDelayMaxMs: 300 }, waits: number[] = []
  let actions = createAgentActions(async ms => { waits.push(ms) }, () => .5, () => settings)
  await actions.run('one', 'profile', () => ['https://example.com/'], async () => {})
  expect(waits).toEqual([200])
  settings = { ...settings, actionDelayMinMs: 0, actionDelayMaxMs: 0 }
  let finish = deferred(), events: string[] = []
  let first = actions.run('one', 'profile', () => ['https://example.com/'], async () => { events.push('first'); await finish.promise })
  let second = actions.run('two', 'profile', () => ['https://example.com/'], async () => { events.push('second') })
  await vi.waitFor(() => expect(events).toEqual(['first']))
  finish.resolve(); await Promise.all([first, second])
  expect(events).toEqual(['first', 'second']); expect(waits).toEqual([200])
})
