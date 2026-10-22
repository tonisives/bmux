import { agentInfo, updateAgentInfo, validateAgentInfo, validateAgentRequirements } from '../shared/agent-info'
import type { AgentInfo, AgentSettings } from '../shared/agent-info'

export let createAgentRegistry = (initial: AgentInfo[]) => {
  let agents = new Map<string, AgentInfo>()
  for (let value of initial) {
    if (!value.agentId) continue
    let actor = agents.get(value.agentId) ?? {}
    updateAgentInfo(actor, structuredClone(value)); agents.set(value.agentId, actor)
  }
  return {
    resolve: (value: AgentInfo, settings: AgentSettings, required: boolean) => {
      validateAgentInfo(value)
      let actor = structuredClone(value.agentId ? agents.get(value.agentId) ?? {} : {})
      updateAgentInfo(actor, value)
      if (required) validateAgentRequirements(actor, settings)
      if (actor.agentId) agents.set(actor.agentId, structuredClone(actor))
      return agentInfo(actor)
    },
  }
}
