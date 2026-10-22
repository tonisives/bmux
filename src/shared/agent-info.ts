export type AgentInfo = { agentId?: string; agentName?: string; agentPurpose?: string; agentType?: string; agentData?: Record<string, string> }
export type AgentField = { label: string; type?: 'text' | 'session' | 'window' | 'pane' }
export type AgentDefinition = { fields: Record<string, AgentField>; focusCommand?: string }
export type AgentSettings = { requireId: boolean; definitions: Record<string, AgentDefinition> }
export let DEFAULT_AGENTS: AgentSettings = { requireId: true, definitions: {} }
export let AGENT_KEYS = ['agentId', 'agentName', 'agentPurpose', 'agentType', 'agentData'] as const
export let validateAgentInfo = (value: AgentInfo) => {
  for (let [key, maximum] of [['agentId', 128], ['agentName', 128], ['agentPurpose', 1000], ['agentType', 128]] as const) {
    let text = value[key]
    if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > maximum || /[\x00-\x1f\x7f]/.test(text))) throw new Error(`${key} must be nonempty text of at most ${maximum} characters`)
  }
  if (value.agentData !== undefined && (!value.agentData || typeof value.agentData !== 'object' || Array.isArray(value.agentData) || Object.keys(value.agentData).length > 32 || Object.entries(value.agentData).some(([key, text]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || typeof text !== 'string' || !text.trim() || text.length > 1000 || /[\x00-\x1f\x7f]/.test(text)))) throw new Error('agentData must map up to 32 field names to nonempty text')
}
export let agentInfo = (value: AgentInfo): AgentInfo => Object.fromEntries(AGENT_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
export let updateAgentInfo = (pane: AgentInfo, value: AgentInfo) => {
  if (value.agentId !== undefined && value.agentId !== pane.agentId) { delete pane.agentName; delete pane.agentPurpose; delete pane.agentType; delete pane.agentData }
  if (value.agentType !== undefined && value.agentType !== pane.agentType) delete pane.agentData
  Object.assign(pane, agentInfo(value))
}
export let parseAgentSettings = (value: unknown): AgentSettings => {
  if (value === undefined) return structuredClone(DEFAULT_AGENTS)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('automation.agents must be a mapping')
  let raw = value as Record<string, unknown>
  if (Object.keys(raw).some(key => !['requireId', 'definitions'].includes(key)) || raw.requireId !== undefined && typeof raw.requireId !== 'boolean') throw new Error('Invalid automation.agents setting')
  let definitions = raw.definitions ?? {}
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) throw new Error('Agent definitions must be a mapping')
  for (let [name, definition] of Object.entries(definitions)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) || !definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('Invalid agent definition')
    let { fields, focusCommand, ...rest } = definition
    if (Object.keys(rest).length || !fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 32 || focusCommand !== undefined && (typeof focusCommand !== 'string' || !focusCommand.trim() || focusCommand.length > 16000)) throw new Error('Invalid agent fields or focus command')
    for (let [key, field] of Object.entries(fields)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || !field || typeof field !== 'object' || Array.isArray(field)) throw new Error('Invalid agent field')
      let { label, type, ...rest } = field as Record<string, unknown>
      if (Object.keys(rest).length || typeof label !== 'string' || !label.trim() || label.length > 128 || type !== undefined && (typeof type !== 'string' || !['text', 'session', 'window', 'pane'].includes(type))) throw new Error('Invalid agent field label or type')
    }
  }
  return { requireId: raw.requireId as boolean ?? true, definitions: definitions as AgentSettings['definitions'] }
}
