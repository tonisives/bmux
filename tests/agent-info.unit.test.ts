import { test, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseAgentSettings, updateAgentInfo, validateAgentInfo } from '../src/shared/agent-info'
import type { AgentInfo } from '../src/shared/agent-info'
import { focusAgent } from '../src/main/agent-focus'
import { createAgentRegistry } from '../src/main/agent-registry'

test('agent definitions default to requiring identity and validate configured field types', () => {
  expect(parseAgentSettings(undefined)).toEqual({ requireId: true, requireType: false, definitions: {} })
  expect(parseAgentSettings({ requireId: false }).requireId).toBe(false)
  expect(parseAgentSettings({ definitions: { terminal: { fields: { pane: { label: 'Terminal pane', type: 'pane' } }, focusCommand: 'tmux select-pane -t "$BMUX_AGENT_PANE_ID"' } } }).definitions.terminal.fields.pane.type).toBe('pane')
  for (let value of [{ requireId: 'false' }, { requireType: 'true' }, { definitions: { terminal: { fields: { pane: { label: 'Pane', required: 'yes' } } } } }, { definitions: [] }, { definitions: { terminal: { fields: { pane: { label: 'Pane', type: 'command' } } } } }]) expect(() => parseAgentSettings(value)).toThrow()
  expect(() => validateAgentInfo({ agentData: { paneId: '%42' } })).not.toThrow()
  for (let agentData of [[], { paneId: 42 }, { paneId: 'bad\nvalue' }, { paneId: '' }]) expect(() => validateAgentInfo({ agentData } as AgentInfo)).toThrow()
})

test('changing agent identity or type clears the previous terminal context', () => {
  let pane: AgentInfo = { agentId: 'old', agentName: 'Old', agentType: 'tmux', agentData: { paneId: '%1' } }
  updateAgentInfo(pane, { agentId: 'new' })
  expect(pane).toEqual({ agentId: 'new' })
  updateAgentInfo(pane, { agentType: 'tmux', agentData: { paneId: '%2' } })
  updateAgentInfo(pane, { agentType: 'other' })
  expect(pane).toEqual({ agentId: 'new', agentType: 'other' })
})

test('focus commands receive agent fields as literal environment values', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-agent-focus-'))
  try {
    let output = path.join(directory, 'focus.json'), marker = path.join(directory, 'injected')
    let actor = { agentId: 'test-agent', agentType: 'terminal', agentData: { sessionId: '$1', windowId: '@2', paneId: `%42; touch ${marker}` } }
    let command = `"${process.execPath}" -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify([process.env.BMUX_AGENT_ID, process.env.BMUX_AGENT_SESSION_ID, process.env.BMUX_AGENT_WINDOW_ID, process.env.BMUX_AGENT_PANE_ID]))' "${output}"`
    await focusAgent(actor, { requireId: true, requireType: false, definitions: { terminal: { fields: { sessionId: { label: 'Session', type: 'session' }, windowId: { label: 'Window', type: 'window' }, paneId: { label: 'Pane', type: 'pane' } }, focusCommand: command } } })
    expect(JSON.parse(await fs.readFile(output, 'utf8'))).toEqual(['test-agent', '$1', '@2', actor.agentData.paneId])
    await expect(fs.stat(marker)).rejects.toThrow()
    await expect(focusAgent({ agentId: 'test-agent', agentType: 'unknown' }, { requireId: true, requireType: false, definitions: {} })).rejects.toThrow('Configure a focus command')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('registered agent context follows its ID across panes and survives sparse restored records', () => {
  let complete = { agentId: '%76', agentName: 'Publishing agent', agentPurpose: 'Publish a video', agentType: 'tmux', agentData: { sessionId: '$5', windowId: '@59', paneId: '%76' } }
  let settings = parseAgentSettings({ requireType: true, definitions: { tmux: { fields: { sessionId: { label: 'Session', required: true }, windowId: { label: 'Window', required: true }, paneId: { label: 'Pane', required: true } } } } })
  let registry = createAgentRegistry([complete, { agentId: '%76' }])
  expect(registry.resolve({ agentId: 'generic' }, parseAgentSettings(undefined), true)).toEqual({ agentId: 'generic' })
  expect(() => registry.resolve({ agentId: 'typed', agentType: 'tmux' }, { ...settings, requireType: false }, true)).toThrow('agentData.paneId')
  expect(registry.resolve({ agentId: '%76' }, settings, true)).toEqual(complete)
  expect(() => registry.resolve({ agentId: 'new' }, settings, true)).toThrow('Agent type required')
  expect(() => registry.resolve({}, settings, true)).toThrow('Agent ID required')
  expect(() => registry.resolve({ agentId: 'new', agentType: 'unknown' }, settings, true)).toThrow('Unknown agent type')
  expect(() => registry.resolve({ agentId: 'new', agentType: 'tmux', agentData: { paneId: '%99' } }, settings, true)).toThrow('agentData.sessionId, agentData.windowId')
  expect(() => registry.resolve({ agentId: 'new' }, settings, true)).toThrow('Agent type required')
  expect(() => registry.resolve({ agentId: '%76', agentData: { paneId: '%99' } }, settings, true)).toThrow('agentData.sessionId')
  expect(registry.resolve({ agentId: '%76' }, settings, true)).toEqual(complete)
  let moved = registry.resolve({ ...complete, agentData: { sessionId: '$5', windowId: '@60', paneId: '%76' } }, settings, true)
  expect(registry.resolve({ agentId: '%76' }, settings, true)).toEqual(moved)
  moved.agentData!.windowId = 'unrelated'
  expect(registry.resolve({ agentId: '%76' }, settings, true).agentData?.windowId).toBe('@60')
})
