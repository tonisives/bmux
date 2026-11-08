import { agentInfo } from './agent-info'
import type { Pane, PublicState } from './types'

export let lastPaneAgent = (pane: Pane, activeAgents: PublicState['activeAgents'] = []) => {
  let active = activeAgents.find(actor => actor.paneId === pane.id)
  if (active) return { ...active, active: true }
  if (pane.lastAgentInteraction) return { ...pane.lastAgentInteraction, paneId: pane.id, active: false }
  if (pane.agentId) return { ...agentInfo(pane), paneId: pane.id, lastUsed: pane.lastUsedBy === 'agent' ? pane.lastActivityAt : undefined, active: false }
}

export let paneAgents = (panes: Pane[], activeAgents: PublicState['activeAgents'] = []) => panes.flatMap(pane => {
  if (pane.lastUsedBy === 'human') return []
  let active = activeAgents.find(actor => actor.paneId === pane.id)
  return active ? [{ ...active, active: true }] : pane.agentId ? [{ ...agentInfo(pane), paneId: pane.id, active: false }] : []
})
