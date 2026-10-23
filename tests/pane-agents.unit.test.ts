import { expect, it } from 'vitest'
import { paneAgents } from '../src/shared/pane-agents'
import type { Pane } from '../src/shared/types'

let pane: Pane = { id: '%1', profileId: 'default', url: 'about:blank', title: '', zoom: 1, agentId: 'research', agentName: 'Research agent', agentOrigin: { type: 'tmux', paneId: '%70', panePid: '1234' } }

it('keeps the last agent and terminal identity after activity expires', () => {
  expect(paneAgents([pane])).toEqual([{ paneId: pane.id, agentId: pane.agentId, agentName: pane.agentName, agentOrigin: pane.agentOrigin, active: false }])
})

it('uses the active actor and includes agents from every pane', () => {
  let active = { paneId: '%2', agentId: 'review', lastUsed: 123 }
  expect(paneAgents([pane, { ...pane, id: '%2' }], [active])).toEqual([
    expect.objectContaining({ paneId: '%1', active: false }), { ...active, active: true },
  ])
})

it('hides previous agents after human input, including recently active agents', () => {
  expect(paneAgents([{ ...pane, lastUsedBy: 'human' }], [{ paneId: pane.id, agentId: pane.agentId, lastUsed: 123 }])).toEqual([])
  expect(paneAgents([{ ...pane, agentId: undefined }])).toEqual([])
})
