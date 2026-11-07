import { agentInfo } from './agent-info'
import type { InternalWindow, Pane, PublicState } from './types'

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

export let isBackgroundAgentWindow = (window: InternalWindow, state: Pick<PublicState, 'model' | 'activeAgents'>) =>
  !state.model.clients.some(client => client.windowId === window.id) && paneAgents(window.panes, state.activeAgents).length > 0
