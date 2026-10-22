import { DEFAULT_AGENTS, parseAgentSettings } from './agent-info'
import type { AgentInfo, AgentSettings } from './agent-info'
export type AutomationLimits = { runs?: number; navigations?: number; activeMinutes?: number }
export type AutomationGroup = {
  profiles: string[]
  hosts: string[]
  maxConcurrent: number
  hourly: AutomationLimits
  daily: AutomationLimits
  requiredPlugins: Record<string, string>
  likesPerDay: Record<string, number>
}
export type AutomationSiteExclusion = { enabled: boolean; durationMinutes: 15 | 60 | null; expiresAt: number | null }
export type AutomationSiteRule = boolean | AutomationSiteExclusion
export type AutomationSafety = { enabled: boolean; maxSessionMinutes: number; cooldownMinutes: number; socialDelayMs: number; mouseMoveMinMs?: number; mouseMoveMaxMs?: number; simulateMouseMovement?: boolean; profiles: Record<string, boolean>; profileLimits?: Record<string, Partial<AutomationProfileLimits>>; panes?: Record<string, boolean>; sites?: Record<string, Record<string, AutomationSiteRule>> }
export type AutomationActor = AgentInfo & { paneId: string; hosts?: string[] }
export type AutomationSafetyLimitKey = 'maxSessionMinutes' | 'cooldownMinutes' | 'socialDelayMs' | 'mouseMoveMinMs' | 'mouseMoveMaxMs'
export type AutomationProfileLimits = Pick<AutomationSafety, 'maxSessionMinutes' | 'cooldownMinutes' | 'socialDelayMs'> & { mouseMoveMinMs: number; mouseMoveMaxMs: number; simulateMouseMovement?: boolean }
export let automationProfileLimits = (settings: AutomationSafety, profileId: string): AutomationProfileLimits => ({ maxSessionMinutes: settings.maxSessionMinutes, cooldownMinutes: settings.cooldownMinutes, socialDelayMs: settings.socialDelayMs, mouseMoveMinMs: settings.mouseMoveMinMs ?? 800, mouseMoveMaxMs: settings.mouseMoveMaxMs ?? 1200, simulateMouseMovement: settings.simulateMouseMovement ?? true, ...settings.profileLimits?.[profileId] })
export type AutomationWarning = 'account-warning' | 'challenge' | 'rate-limit'
export type AutomationSafetyState = { enabled: boolean; limits: AutomationSafety; error?: string; profiles: { profileId: string; siteHost?: string; startedAt: number; lastUsed: number; actors?: AutomationActor[]; warning?: AutomationWarning; warningHost?: string; retryAfter: string | null }[] }
export type AutomationSettings = { agents: AgentSettings; safety: AutomationSafety; groups: Record<string, AutomationGroup> }
export let DEFAULT_AUTOMATION: AutomationSettings = { agents: DEFAULT_AGENTS, safety: { enabled: true, maxSessionMinutes: 10, cooldownMinutes: 20, socialDelayMs: 2000, profiles: {} }, groups: {} }
export let automationSafetyEnabled = (settings: AutomationSafety, profileId: string, paneId?: string) => (paneId ? settings.panes?.[paneId] : undefined) ?? settings.profiles[profileId] ?? settings.enabled
export let automationSiteExclusion = (rule: AutomationSiteRule | undefined): AutomationSiteExclusion | undefined => typeof rule === 'boolean' ? { enabled: !rule, durationMinutes: null, expiresAt: null } : rule
export let automationExclusionActive = (rule: AutomationSiteExclusion, now = Date.now()) => rule.enabled && (rule.expiresAt === null || rule.expiresAt > now)
// Only public website hostnames participate; files, IP literals and local names do not.
export let automationWebsiteHost = (value?: string): string | undefined => {
  try {
    let url = new URL(value ?? ''), host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!/^https?:$/.test(url.protocol) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host)) return
    if (/(^|\.)(localhost|local|lan|internal|intranet|home|test|invalid|example)$/.test(host) || host.endsWith('.home.arpa')) return
    return host
  } catch { return undefined }
}
export let automationWarningEnabled = (settings: AutomationSafety, profileId: string, host: string, now = Date.now(), paneId?: string) => {
  let website = automationWebsiteHost(`https://${host}`)
  if (!website) return false
  let exclusion = automationSiteExclusion(settings.sites?.[profileId]?.[website])
  return automationSafetyEnabled(settings, profileId, paneId) && (!exclusion || !automationExclusionActive(exclusion, now))
}
export let automationSiteEnabled = (settings: AutomationSafety, profileId: string, url?: string, now = Date.now(), paneId?: string) => {
  let host = automationWebsiteHost(url)
  return !!host && automationWarningEnabled(settings, profileId, host, now, paneId)
}
export let updateAutomationSiteExclusion = (previous: AutomationSiteRule | undefined, enabled: unknown, durationMinutes: unknown, now = Date.now()): AutomationSiteExclusion => {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false')
  let duration = durationMinutes ?? null
  if (duration !== null && duration !== 15 && duration !== 60) throw new Error('durationMinutes must be 15, 60, or null')
  return { enabled: !enabled, durationMinutes: duration, expiresAt: duration === null ? null : !enabled ? now + duration * 60_000 : automationSiteExclusion(previous)?.expiresAt ?? now }
}
export let SOCIAL_HOSTS = ['instagram.com', 'threads.com', 'threads.net', 'facebook.com', 'x.com', 'twitter.com', 'linkedin.com', 'reddit.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'bsky.app', 'pinterest.com']
export let isSocialUrl = (value: string) => {
  try { let url = new URL(value); return /^https?:$/.test(url.protocol) && SOCIAL_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) } catch { return false }
}
export let paceAutomationCommand = (method: string, args: Record<string, unknown>) => {
  if (method !== 'cdp') return true
  let params = args.params as Record<string, unknown> | undefined
  return !(args.method === 'Input.dispatchMouseEvent' && ['mouseReleased', 'mouseMoved'].includes(String(params?.type)) || args.method === 'Input.dispatchKeyEvent' && params?.type === 'keyUp')
}
export let automationTargetUrl = (method: string, args: Record<string, unknown>) => {
  let url = method === 'navigate' ? args.url : method === 'cdp' && args.method === 'Page.navigate' ? (args.params as Record<string, unknown> | undefined)?.url : undefined
  return typeof url === 'string' ? url : undefined
}

let mapping = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be a mapping`)
  return value as Record<string, unknown>
}
let hosts = (value: unknown, name: string) => {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(item))) throw new Error(`${name} must contain hostnames`)
  return value as string[]
}
let limits = (value: unknown, name: string): AutomationLimits => {
  if (value === undefined) return {}
  let raw = mapping(value, name), result: AutomationLimits = {}
  for (let [key, amount] of Object.entries(raw)) {
    if (!['runs', 'navigations', 'activeMinutes'].includes(key) || !Number.isInteger(amount) || Number(amount) < 0) throw new Error(`Invalid ${name}.${key}`)
    result[key as keyof AutomationLimits] = Number(amount)
  }
  return result
}
let safetyLimit = (key: unknown, value: unknown) => {
  if (!['maxSessionMinutes', 'cooldownMinutes', 'socialDelayMs', 'mouseMoveMinMs', 'mouseMoveMaxMs'].includes(String(key))) throw new Error('Choose a session, break, social site delay, or mouse movement limit')
  let maximum = key === 'socialDelayMs' || String(key).startsWith('mouseMove') ? 30_000 : 1440
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error(`Invalid automation.safety.${key}`)
  return Number(value)
}
export let updateAutomationSafetyLimit = (settings: AutomationSafety, key: unknown, value: unknown) => {
  let amount = safetyLimit(key, value)
  return parseAutomationSettings({ safety: { ...settings, [key as string]: amount } }).safety[key as AutomationSafetyLimitKey]!
}
export let parseAutomationSettings = (value: unknown): AutomationSettings => {
  if (value === undefined) return structuredClone(DEFAULT_AUTOMATION)
  let raw = mapping(value, 'automation')
  if (Object.keys(raw).some(key => !['groups', 'safety', 'agents'].includes(key))) throw new Error('Unknown automation setting')
  let safety = { ...DEFAULT_AUTOMATION.safety }, safetyRaw = mapping(raw.safety ?? {}, 'automation.safety')
  for (let [key, value] of Object.entries(safetyRaw)) {
    if (key === 'simulateMouseMovement') { if (typeof value !== 'boolean') throw new Error('simulateMouseMovement must be true or false'); safety.simulateMouseMovement = value; continue }
    if (key === 'enabled') { if (typeof value !== 'boolean') throw new Error('automation.safety.enabled must be true or false'); safety.enabled = value; continue }
    if (key === 'sites') {
      let sites = mapping(value, 'automation.safety.sites')
      for (let [profile, entries] of Object.entries(sites)) {
        let rules = mapping(entries, `automation.safety.sites.${profile}`)
        for (let [host, entry] of Object.entries(rules)) {
          if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) throw new Error('automation.safety.sites must map hostnames to exclusions')
          if (typeof entry === 'boolean') continue
          let rule = mapping(entry, 'automation.safety.sites exclusion')
          if (Object.keys(rule).some(key => !['enabled', 'durationMinutes', 'expiresAt'].includes(key)) || typeof rule.enabled !== 'boolean' || ![null, 15, 60].includes(rule.durationMinutes as number | null) || (rule.durationMinutes === null ? rule.expiresAt !== null : typeof rule.expiresAt !== 'number' || !Number.isSafeInteger(rule.expiresAt) || rule.expiresAt < 0)) throw new Error('Invalid automation site exclusion')
        }
      }
      safety.sites = sites as Record<string, Record<string, AutomationSiteRule>>; continue
    }
    if (key === 'profileLimits') {
      let entries = mapping(value, 'automation.safety.profileLimits'), overrides: NonNullable<AutomationSafety['profileLimits']> = {}
      for (let [profileId, entry] of Object.entries(entries)) {
        let rawLimits = mapping(entry, `automation.safety.profileLimits.${profileId}`), parsed: Partial<AutomationProfileLimits> = {}
        for (let [limitKey, amount] of Object.entries(rawLimits)) {
          if (limitKey === 'simulateMouseMovement') { if (typeof amount !== 'boolean') throw new Error('simulateMouseMovement must be true or false'); parsed.simulateMouseMovement = amount }
          else parsed[limitKey as AutomationSafetyLimitKey] = safetyLimit(limitKey, amount)
        }
        overrides[profileId] = parsed
      }
      safety.profileLimits = overrides; continue
    }
    if (key === 'profiles' || key === 'panes') {
      let entries = mapping(value, `automation.safety.${key}`)
      if (Object.values(entries).some(enabled => typeof enabled !== 'boolean')) throw new Error(`automation.safety.${key} must map ${key === 'profiles' ? 'profile' : 'pane'} IDs to true or false`)
      safety[key] = entries as Record<string, boolean>; continue
    }
    safety[key as AutomationSafetyLimitKey] = safetyLimit(key, value)
  }
  for (let profileId of ['', ...Object.keys(safety.profileLimits ?? {})]) {
    let limits = automationProfileLimits(safety, profileId)
    if (limits.mouseMoveMinMs > limits.mouseMoveMaxMs) throw new Error('Mouse movement minimum must not exceed the maximum')
  }
  let groups = mapping(raw.groups ?? {}, 'automation.groups'), result: AutomationSettings = { agents: parseAgentSettings(raw.agents), safety, groups: {} }
  let assigned = new Set<string>()
  for (let [id, entry] of Object.entries(groups)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error('Invalid automation group name')
    let group = mapping(entry, `automation.groups.${id}`)
    if (Object.keys(group).some(key => !['profiles', 'hosts', 'maxConcurrent', 'hourly', 'daily', 'requiredPlugins', 'likesPerDay'].includes(key))) throw new Error(`Unknown automation group setting: ${id}`)
    if (!Array.isArray(group.profiles) || !group.profiles.length || group.profiles.some(item => typeof item !== 'string' || !item)) throw new Error(`automation.groups.${id}.profiles must contain profile IDs`)
    let siteHosts = hosts(group.hosts, `automation.groups.${id}.hosts`)
    let maxConcurrent = group.maxConcurrent ?? 1
    if (!Number.isInteger(maxConcurrent) || Number(maxConcurrent) < 1 || Number(maxConcurrent) > 32) throw new Error(`Invalid automation.groups.${id}.maxConcurrent`)
    let requiredPlugins = mapping(group.requiredPlugins ?? {}, `automation.groups.${id}.requiredPlugins`)
    let likesPerDay = mapping(group.likesPerDay ?? {}, `automation.groups.${id}.likesPerDay`)
    for (let [host, plugin] of Object.entries(requiredPlugins)) if (!siteHosts.includes(host) || typeof plugin !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(plugin)) throw new Error(`Invalid required plugin for ${host}`)
    for (let [host, amount] of Object.entries(likesPerDay)) if (!siteHosts.includes(host) || !Number.isInteger(amount) || Number(amount) < 0) throw new Error(`Invalid like cap for ${host}`)
    for (let profile of group.profiles as string[]) for (let host of siteHosts) {
      let key = `${profile}:${host}`
      if ([...assigned].some(prior => prior.startsWith(`${profile}:`) && (host === prior.slice(profile.length + 1) || host.endsWith(`.${prior.slice(profile.length + 1)}`) || prior.slice(profile.length + 1).endsWith(`.${host}`)))) throw new Error(`Overlapping automation policy for ${key}`)
      assigned.add(key)
    }
    result.groups[id] = { profiles: group.profiles as string[], hosts: siteHosts, maxConcurrent: Number(maxConcurrent), hourly: limits(group.hourly, `${id}.hourly`), daily: limits(group.daily, `${id}.daily`), requiredPlugins: requiredPlugins as Record<string, string>, likesPerDay: likesPerDay as Record<string, number> }
  }
  return result
}
export let matchingAutomationGroup = (settings: AutomationSettings, profileId: string, url: string) => {
  let hostname: string
  try { hostname = new URL(url).hostname.toLowerCase() } catch { return undefined }
  for (let [id, group] of Object.entries(settings.groups)) {
    if (!group.profiles.includes(profileId)) continue
    let host = group.hosts.find(host => hostname === host || hostname.endsWith(`.${host}`))
    if (host) return { id, group, host }
  }
  return undefined
}
