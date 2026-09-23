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
export type AutomationSettings = { groups: Record<string, AutomationGroup> }
export let DEFAULT_AUTOMATION: AutomationSettings = { groups: {} }

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
export let parseAutomationSettings = (value: unknown): AutomationSettings => {
  if (value === undefined) return structuredClone(DEFAULT_AUTOMATION)
  let raw = mapping(value, 'automation')
  if (Object.keys(raw).some(key => key !== 'groups')) throw new Error('Unknown automation setting')
  let groups = mapping(raw.groups ?? {}, 'automation.groups'), result: AutomationSettings = { groups: {} }
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
