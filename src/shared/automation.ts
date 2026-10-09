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
export type AutomationSafety = { enabled: boolean; maxSessionMinutes: number; cooldownMinutes: number; socialDelayMs: number; profiles: Record<string, boolean>; sites?: Record<string, Record<string, AutomationSiteRule>> }
export type AutomationSafetyLimitKey = 'maxSessionMinutes' | 'cooldownMinutes' | 'socialDelayMs'
export type AutomationWarning = 'account-warning' | 'challenge' | 'rate-limit'
export type AutomationSafetyState = { enabled: boolean; limits: AutomationSafety; error?: string; profiles: { profileId: string; startedAt: number; lastUsed: number; warning?: AutomationWarning; warningHost?: string; retryAfter: string | null }[] }
export type AutomationSettings = { safety: AutomationSafety; groups: Record<string, AutomationGroup> }
export let DEFAULT_AUTOMATION: AutomationSettings = { safety: { enabled: true, maxSessionMinutes: 10, cooldownMinutes: 20, socialDelayMs: 2000, profiles: {} }, groups: {} }
export let automationSafetyEnabled = (settings: AutomationSafety, profileId: string) => settings.profiles[profileId] ?? settings.enabled
export let automationSiteExclusion = (rule: AutomationSiteRule | undefined): AutomationSiteExclusion | undefined => typeof rule === 'boolean' ? { enabled: !rule, durationMinutes: null, expiresAt: null } : rule
export let automationExclusionActive = (rule: AutomationSiteExclusion, now = Date.now()) => rule.enabled && (rule.expiresAt === null || rule.expiresAt > now)
export let automationWarningEnabled = (settings: AutomationSafety, profileId: string, host: string, now = Date.now()) => {
  let exclusion = automationSiteExclusion(settings.sites?.[profileId]?.[host.toLowerCase()])
  return automationSafetyEnabled(settings, profileId) && (!exclusion || !automationExclusionActive(exclusion, now))
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
  return !(args.method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased' || args.method === 'Input.dispatchKeyEvent' && params?.type === 'keyUp')
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
export let updateAutomationSafetyLimit = (settings: AutomationSafety, key: unknown, value: unknown) => {
  if (key !== 'maxSessionMinutes' && key !== 'cooldownMinutes' && key !== 'socialDelayMs') throw new Error('Choose a session, break, or social site delay limit')
  return parseAutomationSettings({ safety: { ...settings, [key]: value } }).safety[key]
}
export let parseAutomationSettings = (value: unknown): AutomationSettings => {
  if (value === undefined) return structuredClone(DEFAULT_AUTOMATION)
  let raw = mapping(value, 'automation')
  if (Object.keys(raw).some(key => !['groups', 'safety'].includes(key))) throw new Error('Unknown automation setting')
  let safety = { ...DEFAULT_AUTOMATION.safety }, safetyRaw = mapping(raw.safety ?? {}, 'automation.safety')
  for (let [key, value] of Object.entries(safetyRaw)) {
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
    if (key === 'profiles') {
      let profiles = mapping(value, 'automation.safety.profiles')
      if (Object.values(profiles).some(enabled => typeof enabled !== 'boolean')) throw new Error('automation.safety.profiles must map profile IDs to true or false')
      safety.profiles = profiles as Record<string, boolean>; continue
    }
    let maximum = key === 'socialDelayMs' ? 30_000 : 1440
    if (!['maxSessionMinutes', 'cooldownMinutes', 'socialDelayMs'].includes(key) || !Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error(`Invalid automation.safety.${key}`)
    safety[key as 'maxSessionMinutes' | 'cooldownMinutes' | 'socialDelayMs'] = Number(value)
  }
  let groups = mapping(raw.groups ?? {}, 'automation.groups'), result: AutomationSettings = { safety, groups: {} }
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
