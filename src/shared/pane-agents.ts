import { agentInfo } from './agent-info'
import type { Pane, PublicState } from './types'

export let paneAgents = (panes: Pane[], activeAgents: PublicState['activeAgents'] = []) => panes.flatMap(pane => {
  if (pane.lastUsedBy === 'human') return []
  let active = activeAgents.find(actor => actor.paneId === pane.id)
  return active ? [{ ...active, active: true }] : pane.agentId ? [{ ...agentInfo(pane), paneId: pane.id, active: false }] : []
})
