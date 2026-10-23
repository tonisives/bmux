import { expect, test, vi } from 'vitest'
import { createContext, runInContext } from 'node:vm'
import { AGENT_COMMAND_FEEDBACK_MS, agentCommandFeedbackScript, agentCommandLabel } from '../src/main/agent-command-feedback'

test('summarizes commands without including typed text, scripts, or URL credentials', () => {
  expect(agentCommandLabel('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', deltaY: 555 } })).toBe('scroll down 555 px')
  expect(agentCommandLabel('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', deltaX: -200 } })).toBe('scroll left 200 px')
  expect(agentCommandLabel('click', { x: 120.2, y: 79.7 })).toBe('click (120, 80)')
  expect(agentCommandLabel('scroll', { action: 'scroll-half-down' })).toBe('scroll half down')
  expect(agentCommandLabel('navigate', { url: 'https://user:password@example.com/path?token=value' })).toBe('navigate example.com')
  expect(agentCommandLabel('type', { text: 'private text' })).toBe('type text')
  expect(agentCommandLabel('cdp', { method: 'Input.insertText', params: { text: 'private text' } })).toBe('type text')
  expect(agentCommandLabel('cdp', { method: 'Runtime.evaluate', params: { expression: 'private script' } })).toBe('eval')
})

test('keeps at most three recent commands and expires each after five seconds', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(0)
    let lines: { textContent: string }[] = []
    let context = createContext({ Date, setTimeout, clearTimeout, document: {
      getElementById: () => ({ replaceChildren: (...children: typeof lines) => { lines = children } }),
      createElement: () => ({ textContent: '' })
    } })
    runInContext(agentCommandFeedbackScript, context)
    let commands = Array.from({ length: 4 }, (_, index) => ({ text: `command ${index}`, expiresAt: index * 1000 + AGENT_COMMAND_FEEDBACK_MS }))
    context.showAgentCommands(commands)
    expect(lines.map(line => line.textContent)).toEqual(['command 1', 'command 2', 'command 3'])
    vi.advanceTimersByTime(5999)
    expect(lines).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(lines.map(line => line.textContent)).toEqual(['command 2', 'command 3'])
    vi.advanceTimersByTime(2000)
    expect(lines).toEqual([])
    context.showAgentCommands([{ text: '<b>literal text</b>', expiresAt: Date.now() + AGENT_COMMAND_FEEDBACK_MS }])
    expect(lines[0].textContent).toBe('<b>literal text</b>')
    vi.advanceTimersByTime(AGENT_COMMAND_FEEDBACK_MS)
    expect(lines).toEqual([])
  } finally { vi.useRealTimers() }
})
