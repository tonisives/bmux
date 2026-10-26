import { expect, test } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { findAgentPane, resolveTmuxAgent, identifyTmuxAgent, focusTmuxPane } from '../bin/tmux-agent.mjs'
import type { AgentPane } from '../bin/tmux-agent.mjs'

let thread = { id: 'publishing-thread', name: 'Publishing videos', cwd: '/fixtures/movies' }
let publishing: AgentPane = { sessionId: '$5', sessionName: 'publishing', windowId: '@52', windowIndex: '7', paneId: '%70', panePid: '64428', command: 'codex', title: '[ ! ] Action Required | Publishing videos | movies', cwd: '/fixtures/movies', clientTty: '/dev/ttys000' }
let hacking: AgentPane = { ...publishing, windowId: '@59', windowIndex: '11', paneId: '%76', panePid: '54617', title: 'Verify WordPress instance | deployments', cwd: '/fixtures/k3s' }
let panes = [publishing, hacking]
let list = () => panes.map(pane => [pane.sessionId, pane.windowId, pane.paneId, pane.panePid, pane.command, pane.title, pane.cwd, pane.clientTty, pane.sessionName, pane.windowIndex].join('\t')).join('\n')
let context = { agentId: thread.id, agentType: 'tmux', agentData: { sessionId: '$5', windowId: '@52', paneId: '%70', clientTty: '/dev/ttys000', sessionName: 'publishing', windowIndex: '7' }, agentOrigin: { type: 'tmux' as const, paneId: '%70', panePid: '64428', socketPath: '/tmp/agent-tmux', threadId: thread.id } }

test('shared-daemon agents resolve their thread terminal instead of the selected or inherited tmux pane', async () => {
  let calls: [string, string[]][] = []
  let env = { TMUX: '/tmp/agent-tmux,123,5', TMUX_PANE: '%76', CODEX_THREAD_ID: thread.id }
  let actual = await resolveTmuxAgent({ env, pid: 999, execute: async (command, args) => { calls.push([command, args]); return list() }, threadForId: async id => { expect(id).toBe(thread.id); return thread } })
  expect(actual).toEqual(context)
  expect(calls).toHaveLength(1)
  expect(calls[0][1].slice(0, 4)).toEqual(['-S', '/tmp/agent-tmux', 'list-panes', '-a'])
  expect(calls[0][1].at(-1)).toContain('#{session_name}')
  expect(calls[0][1].at(-1)).toContain('#{window_index}')
  let renamed = await resolveTmuxAgent({ env, execute: async () => list().replaceAll('\tpublishing\t7', '\trenamed\t0'), threadForId: async () => thread })
  expect(renamed.agentData).toEqual({ ...context.agentData, sessionName: 'renamed', windowIndex: '0' })
  expect(findAgentPane(panes, [{ pid: 999, parent: 54617 }], 999)).toEqual(hacking)
  expect(() => findAgentPane(panes, [], 999)).toThrow('ancestry')
  expect(() => findAgentPane([publishing, { ...publishing, paneId: '%71' }], [], 999, thread)).toThrow('unique')
  expect(() => findAgentPane([hacking], [], 999, thread)).toThrow('unique')
})

test('Codex lookup and focus use the saved session directory when the shell directory differs', async () => {
  let shellElsewhere = { ...publishing, cwd: '/fixtures/home' }
  let otherSession = { ...publishing, paneId: '%77', title: 'Publishing videos | deployments', cwd: thread.cwd }
  let currentPanes = [otherSession, shellElsewhere]
  expect(findAgentPane(currentPanes, [], 999, thread)).toEqual(shellElsewhere)
  expect(() => findAgentPane([otherSession], [], 999, thread)).toThrow('unique')
  let execute = async () => currentPanes.map(pane => [pane.sessionId, pane.windowId, pane.paneId, pane.panePid, pane.command, pane.title, pane.cwd, pane.clientTty, pane.sessionName, pane.windowIndex].join('\t')).join('\n')
  let threadForId = async () => thread
  let env = { TMUX: '/tmp/agent-tmux,123,5', TMUX_PANE: '%77', CODEX_THREAD_ID: thread.id }
  expect(await resolveTmuxAgent({ env, execute, threadForId })).toEqual(context)
  expect(await focusTmuxPane(context.agentData, context.agentOrigin, { execute, threadForId })).toBe('%70')
})

test('every tmux CLI browser call carries fresh origin and rejects a different supplied terminal pane', async () => {
  let env = { TMUX: '/tmp/agent-tmux,123,5', TMUX_PANE: '%76', CODEX_THREAD_ID: thread.id }
  let resolve = async () => structuredClone(context)
  expect(await identifyTmuxAgent({ method: 'dom', args: { pane: '%31' } }, env, resolve)).toEqual({ method: 'dom', args: { pane: '%31', ...context } })
  expect(await identifyTmuxAgent({ method: 'navigate', args: { pane: '%11', agentId: 'custom-id', url: 'https://studio.youtube.com/' } }, env, resolve)).toMatchObject({ args: { pane: '%11', agentId: 'custom-id', agentData: context.agentData, agentOrigin: context.agentOrigin } })
  await expect(identifyTmuxAgent({ method: 'dom', args: { pane: '%31', agentType: 'tmux', agentData: { paneId: '%76' } } }, env, resolve)).rejects.toThrow('paneId is %70, but supplied %76')
  let generic = { method: 'dom', args: { pane: '%31', agentType: 'other-app', agentId: 'generic' } }
  expect(await identifyTmuxAgent(generic, env, resolve)).toEqual(generic)
  expect(await identifyTmuxAgent({ method: 'list-panes', args: { window: '@1' } }, env, resolve)).toEqual({ method: 'list-panes', args: { window: '@1' } })
})

test('focus verifies the agent thread again and never falls back to an unrelated or recycled pane', async () => {
  let execute = async () => list(), threadForId = async () => thread
  expect(await focusTmuxPane(context.agentData, context.agentOrigin, { execute, threadForId })).toBe('%70')
  let moved = { ...publishing, paneId: '%80', panePid: '88888' }
  expect(await focusTmuxPane(context.agentData, context.agentOrigin, { execute: async () => [moved, hacking].map(p => [p.sessionId, p.windowId, p.paneId, p.panePid, p.command, p.title, p.cwd].join('\t')).join('\n'), threadForId })).toBe('%80')
  await expect(focusTmuxPane({ paneId: '%76' }, context.agentOrigin, { execute, threadForId })).rejects.toThrow('unverified')
  await expect(focusTmuxPane({ paneId: '%76' }, undefined, { execute, threadForId })).rejects.toThrow('unverified')
  await expect(focusTmuxPane(context.agentData, { ...context.agentOrigin, threadId: undefined, panePid: '99999' }, { execute })).rejects.toThrow('changed')
  await expect(focusTmuxPane(context.agentData, context.agentOrigin, { execute: async () => '', threadForId })).rejects.toThrow('unique')
})

test('thread lookup uses only exact saved identity and refuses ambiguous names', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-thread-origin-'))
  let database = new DatabaseSync(path.join(directory, 'state_5.sqlite'))
  try {
    database.exec('CREATE TABLE threads (id TEXT, name TEXT, cwd TEXT, archived INTEGER)')
    database.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run(thread.id, thread.name, thread.cwd)
    let env = { TMUX: '/tmp/agent-tmux,123,5', TMUX_PANE: '%76', CODEX_THREAD_ID: thread.id, CODEX_HOME: directory }
    expect(await resolveTmuxAgent({ env, execute: async () => list() })).toEqual(context)
    database.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run('other-project', thread.name, '/fixtures/other')
    expect(await resolveTmuxAgent({ env, execute: async () => list() })).toEqual(context)
    database.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run('same-directory-label', thread.name, '/other/movies')
    await expect(resolveTmuxAgent({ env, execute: async () => list() })).rejects.toThrow('ambiguous')
    database.prepare('DELETE FROM threads WHERE id = ?').run('same-directory-label')
    database.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run('another-thread', thread.name, thread.cwd)
    await expect(resolveTmuxAgent({ env, execute: async () => list() })).rejects.toThrow('ambiguous')
  } finally { database.close(); await fs.rm(directory, { recursive: true, force: true }) }
})
