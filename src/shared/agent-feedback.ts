import { profileColor } from './profile-color'

export type AgentFeedbackSettings = {
  color: string
  cursorSize: number
  idleRotationDegrees: number
  idleRotationMs: number
  haloSize: number
  haloDurationMs: number
  trailWidth: number
  trailFadeMs: number
  cursorHideMs: number
  commandDisplayMs: number
  inputUnlockMs: number
  actionDelayMinMs: number
  actionDelayMaxMs: number
}

export let DEFAULT_AGENT_FEEDBACK: AgentFeedbackSettings = {
  color: 'profile', cursorSize: 24, idleRotationDegrees: 12, idleRotationMs: 3600,
  haloSize: 64, haloDurationMs: 1100, trailWidth: 10, trailFadeMs: 350,
  cursorHideMs: 20000, commandDisplayMs: 5000, inputUnlockMs: 20000,
  actionDelayMinMs: 800, actionDelayMaxMs: 1200
}

export let AGENT_FEEDBACK_RANGES = {
  cursorSize: [12, 64], idleRotationDegrees: [0, 45], idleRotationMs: [250, 30000],
  haloSize: [0, 160], haloDurationMs: [0, 10000], trailWidth: [0, 32], trailFadeMs: [0, 10000],
  cursorHideMs: [0, 600000], commandDisplayMs: [0, 60000], inputUnlockMs: [0, 600000],
  actionDelayMinMs: [0, 30000], actionDelayMaxMs: [0, 30000]
} satisfies Record<Exclude<keyof AgentFeedbackSettings, 'color'>, [number, number]>

export let parseAgentFeedback = (value: unknown): AgentFeedbackSettings => {
  let result = { ...DEFAULT_AGENT_FEEDBACK }
  if (value === undefined) return result
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('agentFeedback must be a mapping')
  for (let [key, amount] of Object.entries(value)) {
    if (key === 'color') {
      if (amount !== 'profile' && (typeof amount !== 'string' || !/^#[\da-f]{6}$/i.test(amount))) throw new Error('agentFeedback.color must be profile or a six-digit hex color')
      result.color = String(amount).toLowerCase()
    } else {
      let range = AGENT_FEEDBACK_RANGES[key as keyof typeof AGENT_FEEDBACK_RANGES]
      if (!Object.hasOwn(AGENT_FEEDBACK_RANGES, key)) throw new Error(`Unknown agentFeedback setting: ${key}`)
      if (!Number.isInteger(amount) || Number(amount) < range[0] || Number(amount) > range[1]) throw new Error(`agentFeedback.${key} must be an integer from ${range[0]} to ${range[1]}`)
      result[key as keyof typeof AGENT_FEEDBACK_RANGES] = Number(amount)
    }
  }
  if (result.actionDelayMaxMs < result.actionDelayMinMs) throw new Error('Maximum action pause must be at least the minimum')
  return result
}

export let resolveAgentFeedback = (settings: AgentFeedbackSettings, profileId = 'profile_default'): AgentFeedbackSettings => ({ ...settings, color: settings.color === 'profile' ? profileColor(profileId) : settings.color })
