import { test, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseAgentSettings, updateAgentInfo, validateAgentInfo } from '../src/shared/agent-info'
import type { AgentInfo } from '../src/shared/agent-info'
import { focusAgent } from '../src/main/agent-focus'

test('agent definitions default to requiring identity and validate configured field types', () => {
  expect(parseAgentSettings(undefined)).toEqual({ requireId: true, definitions: {} })
  expect(parseAgentSettings({ requireId: false }).requireId).toBe(false)
  expect(parseAgentSettings({ definitions: { terminal: { fields: { pane: { label: 'Terminal pane', type: 'pane' } }, focusCommand: 'tmux select-pane -t "$BMUX_AGENT_PANE_ID"' } } }).definitions.terminal.fields.pane.type).toBe('pane')
  for (let value of [{ requireId: 'false' }, { definitions: [] }, { definitions: { terminal: { fields: { pane: { label: 'Pane', type: 'command' } } } } }]) expect(() => parseAgentSettings(value)).toThrow()
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
    await focusAgent(actor, { requireId: true, definitions: { terminal: { fields: { sessionId: { label: 'Session', type: 'session' }, windowId: { label: 'Window', type: 'window' }, paneId: { label: 'Pane', type: 'pane' } }, focusCommand: command } } })
    expect(JSON.parse(await fs.readFile(output, 'utf8'))).toEqual(['test-agent', '$1', '@2', actor.agentData.paneId])
    await expect(fs.stat(marker)).rejects.toThrow()
    await expect(focusAgent({ agentType: 'unknown' }, { requireId: true, definitions: {} })).rejects.toThrow('Configure a focus command')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
