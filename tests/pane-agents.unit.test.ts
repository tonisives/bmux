import { expect, it } from 'vitest'
import { lastPaneAgent, paneAgents } from '../src/shared/pane-agents'
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

it('keeps the page button tied to the last interaction after human activity and newer identity metadata', () => {
  let previous = { agentId: 'previous', agentName: 'Previous agent', lastUsed: 123 }
  let page = { ...pane, lastUsedBy: 'human' as const, lastActivityAt: 456, lastAgentInteraction: previous }
  expect(lastPaneAgent(page)).toEqual({ ...previous, paneId: pane.id, active: false })
  let active = { paneId: pane.id, agentId: 'current', lastUsed: 789 }
  expect(lastPaneAgent(page, [active])).toEqual({ ...active, active: true })
  expect(lastPaneAgent({ ...pane, agentId: undefined })).toBeUndefined()
})

it('keeps older page identities without treating human activity as the agent timestamp', () => {
  expect(lastPaneAgent({ ...pane, lastUsedBy: 'human', lastActivityAt: 456 })).toMatchObject({ agentId: pane.agentId, active: false, lastUsed: undefined })
  expect(lastPaneAgent({ ...pane, lastUsedBy: 'agent', lastActivityAt: 123 })).toMatchObject({ lastUsed: 123 })
})
