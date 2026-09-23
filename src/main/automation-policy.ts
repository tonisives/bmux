import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AutomationSettings } from '../shared/automation'
import { matchingAutomationGroup } from '../shared/automation'

type Event = { at: number; kind: 'run' | 'navigation' | 'activity' | 'like'; host?: string }
type Lease = { token: string; groupId: string; profileId: string; tabId: string; pluginId?: string; acquiredAt: number; lastUsed: number }
type Ledger = Record<string, Event[]>
let windowMs = { hourly: 60 * 60_000, daily: 24 * 60 * 60_000 }
let activeTailMs = 30_000
let idleLeaseMs = 5 * 60_000

export let createAutomationPolicy = (options: { file: string; settings: () => AutomationSettings; now?: () => number }) => {
  let now = options.now ?? Date.now
  let ledger: Ledger = {}
  let ledgerError: Error | undefined
  try {
    let loaded: unknown = JSON.parse(fs.readFileSync(options.file, 'utf8'))
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded) || Object.values(loaded).some(events => !Array.isArray(events) || events.some(event => !event || typeof event.at !== 'number' || !['run', 'navigation', 'activity', 'like'].includes(event.kind)))) throw new Error('Invalid automation ledger')
    ledger = loaded as Ledger
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ledgerError = new Error('Automation ledger is unreadable; automation is disabled until repaired') }
  let ensureLedger = () => { if (ledgerError) throw ledgerError }
  let leases = new Map<string, Lease>()
  let persist = () => {
    ensureLedger()
    let cutoff = now() - windowMs.daily - activeTailMs
    for (let [key, events] of Object.entries(ledger)) {
      ledger[key] = events.filter(event => event.at >= cutoff)
      if (!ledger[key].length) delete ledger[key]
    }
    fs.mkdirSync(path.dirname(options.file), { recursive: true, mode: 0o700 })
    let temporary = `${options.file}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(ledger), { mode: 0o600 })
    fs.renameSync(temporary, options.file)
  }
  let expire = () => { for (let [token, lease] of leases) if (now() - lease.lastUsed > idleLeaseMs) leases.delete(token) }
  let eventsFor = (groupId: string, profileId: string) => ledger[`${groupId}:${profileId}`] ?? []
  let usage = (events: Event[], since: number, until: number) => {
    let runs = 0, navigations = 0, activity: [number, number][] = []
    for (let event of events) {
      if (event.kind === 'run' && event.at > since && event.at <= until) runs++
      if (event.kind === 'navigation' && event.at > since && event.at <= until) navigations++
      if (event.kind === 'activity' && event.at + activeTailMs > since && event.at <= until) activity.push([Math.max(since, event.at), Math.min(until, event.at + activeTailMs)])
    }
    activity.sort((a, b) => a[0] - b[0])
    let activeMs = 0, end = since
    for (let [start, stop] of activity) { activeMs += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop) }
    return { runs, navigations, activeMs }
  }
  let append = (groupId: string, profileId: string, event: Event) => {
    let key = `${groupId}:${profileId}`
    let entries = event.kind === 'navigation' ? [event, { ...event, kind: 'activity' as const }] : [event]
    ;(ledger[key] ??= []).push(...entries)
    try { persist() } catch (error) { ledger[key].splice(-entries.length); throw error }
  }
  let enforce = (groupId: string, profileId: string, kind: 'run' | 'navigation' | 'activity') => {
    let group = options.settings().groups[groupId]
    if (!group) throw new Error('Automation group is unavailable')
    let current = now(), events = eventsFor(groupId, profileId)
    for (let [period, length] of Object.entries(windowMs) as [keyof typeof windowMs, number][]) {
      let limits = group[period], used = usage(events, current - length, current)
      let retryCount = (eventKind: Event['kind'], cap: number, added: number) => {
        if (cap === 0) return 'disabled by configuration'
        let relevant = events.filter(event => event.kind === eventKind && event.at > current - length && event.at <= current).sort((a, b) => a.at - b.at)
        let index = relevant.length + added - cap - 1
        return `retry after ${new Date(relevant[index].at + length + 1).toISOString()}`
      }
      if (limits.runs !== undefined && used.runs + Number(kind === 'run') > limits.runs) throw new Error(`Automation ${period} run limit reached; ${retryCount('run', limits.runs, Number(kind === 'run'))}`)
      if (limits.navigations !== undefined && used.navigations + Number(kind === 'navigation') > limits.navigations) throw new Error(`Automation ${period} navigation limit reached; ${retryCount('navigation', limits.navigations, Number(kind === 'navigation'))}`)
      if (limits.activeMinutes !== undefined && used.activeMs >= limits.activeMinutes * 60_000) {
        if (limits.activeMinutes === 0) throw new Error(`Automation ${period} active-time limit reached; disabled by configuration`)
        let low = current + activeTailMs, high = current + length + activeTailMs + 1
        while (low < high) { let middle = Math.floor((low + high) / 2); if (usage(events, middle - length, middle).activeMs < limits.activeMinutes * 60_000) high = middle; else low = middle + 1 }
        throw new Error(`Automation ${period} active-time limit reached; retry after ${new Date(low).toISOString()}`)
      }
    }
  }
  let acquire = (args: { profileId: string; tabId: string; url: string; pluginId?: string }) => {
    ensureLedger()
    expire()
    let match = matchingAutomationGroup(options.settings(), args.profileId, args.url)
    if (!match) throw new Error('No automation policy matches this profile and URL')
    let required = match.group.requiredPlugins[match.host]
    if (required && required !== args.pluginId) throw new Error(`Automation for ${match.host} requires plugin ${required}`)
    let active = [...leases.values()].filter(item => item.groupId === match.id && item.profileId === args.profileId).length
    if (active >= match.group.maxConcurrent) throw new Error(`Automation group ${match.id} is busy`)
    enforce(match.id, args.profileId, 'run')
    let token = randomBytes(32).toString('hex')
    leases.set(token, { token, groupId: match.id, profileId: args.profileId, tabId: args.tabId, pluginId: args.pluginId, acquiredAt: now(), lastUsed: now() })
    try { append(match.id, args.profileId, { at: now(), kind: 'run' }) } catch (error) { leases.delete(token); throw error }
    return { token, group: match.id, profileId: args.profileId, tabId: args.tabId }
  }
  let release = (token: string) => { if (!leases.delete(token)) throw new Error('Automation lease is unavailable'); return { released: true } }
  let authorize = (args: { profileId: string; tabId: string; url: string; token?: string; kind?: 'navigation' | 'activity'; record?: boolean }) => {
    ensureLedger()
    expire()
    let match = matchingAutomationGroup(options.settings(), args.profileId, args.url)
    if (!match) return undefined
    let lease = args.token ? leases.get(args.token) : undefined
    if (!lease || lease.groupId !== match.id || lease.profileId !== args.profileId || lease.tabId !== args.tabId || (match.group.requiredPlugins[match.host] && lease.pluginId !== match.group.requiredPlugins[match.host])) throw new Error(`Automation lease required for ${match.host}`)
    enforce(match.id, args.profileId, args.kind ?? 'activity')
    lease.lastUsed = now()
    if (args.kind && args.record !== false) append(match.id, args.profileId, { at: now(), kind: args.kind, host: match.host })
    return lease
  }
  let like = (args: { profileId: string; tabId: string; url: string; token: string }) => {
    let lease = authorize({ ...args })
    if (!lease?.pluginId) throw new Error('A site plugin is required to like')
    let match = matchingAutomationGroup(options.settings(), args.profileId, args.url)!
    let cap = match.group.likesPerDay[match.host] ?? 0
    let current = now()
    let likes = eventsFor(match.id, args.profileId).filter(event => event.kind === 'like' && event.host === match.host && event.at > current - windowMs.daily).sort((a, b) => a.at - b.at)
    let used = likes.length
    if (!cap) throw new Error(`Likes are disabled or at the daily cap for ${match.host}`)
    if (used >= cap) throw new Error(`Likes are disabled or at the daily cap for ${match.host}; retry after ${new Date(likes[used - cap].at + windowMs.daily + 1).toISOString()}`)
    append(match.id, args.profileId, { at: current, kind: 'like', host: match.host })
    return { reserved: true, remaining: cap - used - 1 }
  }
  let status = () => {
    ensureLedger()
    expire()
    return Object.entries(options.settings().groups).flatMap(([groupId, group]) => group.profiles.map(profileId => {
      let activeLeases = [...leases.values()].filter(lease => lease.groupId === groupId && lease.profileId === profileId).map(({ tabId, pluginId, acquiredAt, lastUsed }) => ({ tabId, pluginId: pluginId ?? null, acquiredAt, lastUsed }))
      return { group: groupId, profileId, active: activeLeases.length, activeLeases, hourly: usage(eventsFor(groupId, profileId), now() - windowMs.hourly, now()), daily: usage(eventsFor(groupId, profileId), now() - windowMs.daily, now()), limits: { hourly: group.hourly, daily: group.daily, maxConcurrent: group.maxConcurrent } }
    }))
  }
  return { acquire, release, authorize, like, status, close: () => leases.clear() }
}
