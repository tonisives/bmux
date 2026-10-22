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
  expect(() => validateAgentInfo({ agentOrigin: { type: 'tmux', paneId: '%70', panePid: '64428' } })).not.toThrow()
  for (let agentOrigin of [null, { type: 'tmux', paneId: '%70' }, { type: 'tmux', paneId: '%70', panePid: '64428', socketPath: 'bad\npath' }]) expect(() => validateAgentInfo({ agentOrigin } as AgentInfo)).toThrow('origin')
})

test('changing agent identity or type clears the previous terminal context', () => {
  let pane: AgentInfo = { agentId: 'old', agentName: 'Old', agentType: 'tmux', agentData: { paneId: '%1' } }
  updateAgentInfo(pane, { agentId: 'new' })
  expect(pane).toEqual({ agentId: 'new' })
  updateAgentInfo(pane, { agentType: 'tmux', agentData: { paneId: '%2' } })
  updateAgentInfo(pane, { agentType: 'other' })
  expect(pane).toEqual({ agentId: 'new', agentType: 'other' })
})

test('identity errors describe configured required fields and follow settings changes', () => {
  let registry = createAgentRegistry([])
  expect(() => registry.resolve({}, parseAgentSettings(undefined), true)).toThrow('Agent ID required. Expected JSON: {"agentId":"<id>"}')
  let settings = parseAgentSettings({ requireType: true, definitions: {
    editor: { fields: { pane_id: { label: 'Editor pane', type: 'pane', required: true }, project: { label: 'Project', required: true }, optional: { label: 'Optional' } }, focusCommand: 'editor-focus-command' },
    terminal: { fields: { session: { label: 'Session', type: 'session', required: true } } },
  } })
  let editor = '{"agentId":"<id>","agentType":"editor","agentData":{"pane_id":"<pane>","project":"<text>"}}'
  expect(() => registry.resolve({}, settings, true)).toThrow(`Agent ID required. Expected JSON: ${editor}; types: editor, terminal`)
  expect(() => registry.resolve({ agentId: 'new' }, settings, true)).toThrow(`Agent type required. Expected JSON: ${editor}; types: editor, terminal`)
  expect(() => registry.resolve({ agentId: 'new', agentType: 'unknown' }, settings, true)).toThrow(`Unknown agent type: unknown. Expected JSON: ${editor}; types: editor, terminal`)
  expect(() => registry.resolve({ agentId: 'new', agentType: 'editor', agentData: { pane_id: '%1' } }, settings, true)).toThrow(`Agent editor requires agentData.project. Expected JSON: ${editor}`)
  expect(() => registry.resolve({ agentId: 'new', agentType: 'terminal' }, settings, true)).toThrow('Expected JSON: {"agentId":"<id>","agentType":"terminal","agentData":{"session":"<session>"}}')
  settings.definitions.editor.fields = { workspace_id: { label: 'Workspace', type: 'window', required: true } }
  expect(() => registry.resolve({}, settings, true)).toThrow('Expected JSON: {"agentId":"<id>","agentType":"editor","agentData":{"workspace_id":"<window>"}}')
  expect(() => registry.resolve({}, { ...settings, requireId: false }, true)).toThrow('Expected JSON: {"agentType":"editor","agentData":{"workspace_id":"<window>"}}')
  expect(() => registry.resolve({ agentId: 'new' }, parseAgentSettings({ requireType: true }), true)).toThrow('Expected JSON: {"agentId":"<id>","agentType":"<type>","agentData":{}}; configure automation.agents.definitions')
})

test('focus commands receive literal agent fields and EOF on unused standard input', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-agent-focus-'))
  try {
    let output = path.join(directory, 'focus.json'), marker = path.join(directory, 'injected')
    let actor = { agentId: 'test-agent', agentType: 'terminal', agentData: { sessionId: '$1', windowId: '@2', paneId: `%42; touch ${marker}` }, agentOrigin: { type: 'tmux' as const, paneId: '%42', panePid: '12345', threadId: 'research-thread' } }
    let command = `"${process.execPath}" -e 'process.stdin.resume(); process.stdin.on("end", () => require("node:fs").writeFileSync(process.argv[1], JSON.stringify([process.env.BMUX_AGENT_ID, process.env.BMUX_AGENT_SESSION_ID, process.env.BMUX_AGENT_WINDOW_ID, process.env.BMUX_AGENT_PANE_ID, JSON.parse(process.env.BMUX_AGENT_ORIGIN)])))' "${output}"`
    await focusAgent(actor, { requireId: true, requireType: false, definitions: { terminal: { fields: { sessionId: { label: 'Session', type: 'session' }, windowId: { label: 'Window', type: 'window' }, paneId: { label: 'Pane', type: 'pane' } }, focusCommand: command } } })
    expect(JSON.parse(await fs.readFile(output, 'utf8'))).toEqual(['test-agent', '$1', '@2', actor.agentData.paneId, actor.agentOrigin])
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
