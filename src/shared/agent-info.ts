export type AgentInfo = { agentId?: string; agentName?: string; agentPurpose?: string }
export let validateAgentInfo = (value: AgentInfo) => {
  for (let [key, maximum] of [['agentId', 128], ['agentName', 128], ['agentPurpose', 1000]] as const) {
    let text = value[key]
    if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > maximum || /[\x00-\x1f\x7f]/.test(text))) throw new Error(`${key} must be nonempty text of at most ${maximum} characters`)
  }
}
export let agentInfo = (value: AgentInfo): AgentInfo => ({ agentId: value.agentId, agentName: value.agentName, agentPurpose: value.agentPurpose })
export let updateAgentInfo = (pane: AgentInfo, value: AgentInfo) => {
  if (value.agentId !== undefined && value.agentId !== pane.agentId) { delete pane.agentName; delete pane.agentPurpose }
  for (let key of ['agentId', 'agentName', 'agentPurpose'] as const) if (value[key] !== undefined) pane[key] = value[key]
}
