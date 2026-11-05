import { updateAgentInfo, validateAgentInfo } from '../shared/agent-info'
import fs from 'node:fs'
import path from 'node:path'
import type { AutomationActor, AutomationSafety, AutomationSafetyState, AutomationWarning } from '../shared/automation'
import { automationJobId, automationSessionMinutes, automationProfileLimits, automationSafetyEnabled, automationSiteEnabled, automationWarningEnabled, automationWebsiteHost, isSocialUrl } from '../shared/automation'

type Usage = { profileId: string; siteHost: string; jobId?: string; startedAt: number; lastUsed: number; activeMs?: number; burstStartedAt?: number; burstCount?: number; pendingSession?: boolean; limitReachedAt?: number; actors?: AutomationActor[]; warning?: AutomationWarning; warningHost?: string; warningAt?: number }
type Page = { url: string; warning?: AutomationWarning }
let warnings = ['account-warning', 'challenge', 'rate-limit']
let safetyError = (message: string) => Object.assign(new Error(message), { code: 'AUTOMATION_SAFETY' })
export let isAutomationSafetyError = (error: unknown): error is Error => error instanceof Error && 'code' in error && error.code === 'AUTOMATION_SAFETY'

// Only return a reason, never page text, account details, or challenge tokens.
let readWarning = (): AutomationWarning | undefined => {
  let visible = (node: Element) => !!node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && getComputedStyle(node).display !== 'none'
  let url = new URL(location.href)
  if (/\/(challenge|checkpoint|captcha)(\/|$)/i.test(url.pathname) || url.hostname.endsWith('google.com') && url.pathname.startsWith('/sorry/')) return 'challenge'
  if ([...document.querySelectorAll('iframe[src*="/recaptcha/api2/bframe"], iframe[src*="hcaptcha"][title*="challenge"], #challenge-running, #challenge-stage')].some(visible)) return 'challenge'
  let messages = [document.title, ...[...document.querySelectorAll('[role="dialog"], [role="alert"], h1, h2')].filter(node => visible(node) && !node.closest('article, [data-testid="tweet"], [data-urn]')).map(node => (node as HTMLElement).innerText)]
  // Small standalone warning pages often have no semantic heading or dialog.
  let body = document.body?.innerText ?? ''
  if (body.length < 1500 && !document.querySelector('article, [data-testid="tweet"], [data-urn]')) messages.push(body)
  for (let message of messages) {
    let text = (message ?? '').replace(/\s+/g, ' ').trim()
    if (/we (suspect|detected) automated (behavior|activity)|suspected automated (behavior|activity)|automated (behavior|activity) on your account|your account (has been|is) (temporarily )?(restricted|suspended|locked)|suspicious activity (on|in) your account/i.test(text)) return 'account-warning'
    if (/verify (that )?you('re| are) (a )?human|confirm (that )?you('re| are) (a )?human|unusual traffic from your computer|complete (the|this) (captcha|security check)|checking your browser before/i.test(text)) return 'challenge'
    if (/too many requests|rate limit exceeded|you('re| are) temporarily blocked|we restrict certain activity to protect our community|we limit how often you can/i.test(text)) return 'rate-limit'
  }
  return undefined
}
export let automationWarningScript = `(${readWarning.toString()})()`

export let createAutomationSafety = (options: { file: string; settings: () => AutomationSafety; now?: () => number; sleep?: (ms: number) => Promise<void>; changed?: () => void }) => {
  let now = options.now ?? Date.now, sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let usage: Record<string, Usage> = {}, ledgerError = false
  try {
    let loaded: unknown = JSON.parse(fs.readFileSync(options.file, 'utf8'))
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded) || Object.values(loaded).some(value => !value || !Number.isFinite(value.startedAt) || !Number.isFinite(value.lastUsed) || value.lastUsed < value.startedAt || value.limitReachedAt !== undefined && (!Number.isFinite(value.limitReachedAt) || value.limitReachedAt < value.startedAt) || value.warning !== undefined && (!warnings.includes(value.warning) || typeof value.warningHost !== 'string' || !value.warningHost))) throw new Error('Invalid safety ledger')
    for (let [key, raw] of Object.entries(loaded as Record<string, Usage>)) {
      let value = raw as Usage
      for (let key of ['activeMs', 'burstStartedAt', 'burstCount'] as const) if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key]! < 0)) throw new Error('Invalid activity usage')
      if (value.jobId !== undefined && (typeof value.jobId !== 'string' || !value.jobId.trim() || value.jobId.length > 128)) throw new Error('Invalid job session')
      if (value.pendingSession !== undefined && typeof value.pendingSession !== 'boolean') throw new Error('Invalid pending session')
      for (let actor of value.actors ?? []) {
        if (!actor || typeof actor.paneId !== 'string' || !actor.paneId || actor.hosts !== undefined && (!Array.isArray(actor.hosts) || actor.hosts.some(host => typeof host !== 'string' || automationWebsiteHost(`https://${host}`) !== host))) throw new Error('Invalid automation actors')
        validateAgentInfo(actor)
      }
      if (value.siteHost !== undefined) {
        if (typeof value.profileId !== 'string' || !value.profileId || automationWebsiteHost(`https://${value.siteHost}`) !== value.siteHost) throw new Error('Invalid website usage')
        if (value.activeMs === undefined) {
          // Old elapsed clocks cannot tell active work from idle time. Keep earned breaks.
          let limit = automationSessionMinutes(options.settings(), value.profileId, value.siteHost, value.jobId) * 60_000
          if (value.lastUsed >= value.startedAt + limit) value.limitReachedAt ??= value.lastUsed
          value.activeMs = value.limitReachedAt === undefined ? 0 : limit
        }
        usage[JSON.stringify(value.jobId ? [value.profileId, value.siteHost, value.jobId] : [value.profileId, value.siteHost])] = value
      } else {
        // Website start times are absent from profile clocks. Keep warning
        // pauses; website sessions begin with their next admitted command.
        let siteHost = value.warningHost
        if (value.warning && siteHost && automationWebsiteHost(`https://${siteHost}`) === siteHost) usage[JSON.stringify([key, siteHost])] = { ...value, profileId: key, siteHost, activeMs: 0, startedAt: now(), lastUsed: now(), actors: value.actors?.filter(actor => actor.hosts?.includes(siteHost)).map(actor => ({ ...actor, hosts: [siteHost] })) }
      }
    }
  } catch (error) { ledgerError = (error as NodeJS.ErrnoException).code !== 'ENOENT' }
  let usageKey = (profileId: string, url?: string, jobId?: string) => JSON.stringify(jobId ? [profileId, automationWebsiteHost(url), jobId] : [profileId, automationWebsiteHost(url)])
  let scopedJob = (actor?: AutomationActor) => { let jobId = automationJobId(actor); return jobId && options.settings().jobSessionMinutes?.[jobId] !== undefined ? jobId : undefined }
  let actorFor = (paneId?: string) => Object.values(usage).flatMap(value => value.actors ?? []).find(actor => actor.paneId === paneId)
  let sessionLimit = (value: Usage) => automationSessionMinutes(options.settings(), value.profileId, value.siteHost, value.jobId) * 60_000
  let queues = new Map<string, Promise<boolean>>()
  let lastAdmitted = new Map<string, number>()
  let bursts = new Map<string, { startedAt: number; count: number }>()
  let ensureLedger = () => { if (ledgerError) throw safetyError('Automation safety ledger is unreadable; repair it before automating') }
  let persist = () => {
    ensureLedger()
    try {
      fs.mkdirSync(path.dirname(options.file), { recursive: true, mode: 0o700 })
      fs.writeFileSync(`${options.file}.tmp`, JSON.stringify(usage), { mode: 0o600 })
      fs.renameSync(`${options.file}.tmp`, options.file)
      options.changed?.()
    } catch { ledgerError = true; throw safetyError('Could not save automation safety usage; automation stopped') }
  }
  let retryAt = (profileId: string, value: Usage) => {
    let limits = automationProfileLimits(options.settings(), profileId)
    return (value.limitReachedAt ?? value.lastUsed) + limits.cooldownMinutes * 60_000
  }
  let activeTime = (value: Usage) => (value.activeMs ?? 0) + (value.pendingSession || value.limitReachedAt !== undefined ? 0 : Math.min(3000, Math.max(0, now() - value.lastUsed)))
  let overLimit = (value: Usage) => activeTime(value) >= sessionLimit(value)
  let touch = (value: Usage) => {
    value.activeMs = activeTime(value); value.lastUsed = now()
    if (value.activeMs < sessionLimit(value)) delete value.limitReachedAt
  }
  let reachedLimit = (value: Usage) => !value.pendingSession && (value.activeMs ?? 0) >= sessionLimit(value)
  let rested = (value: Usage) => value.pendingSession || now() >= retryAt(value.profileId, value) || !reachedLimit(value) && now() - value.lastUsed >= 2 * 60_000
  let assertAvailable = (profileId: string, paneId?: string, url?: string, actor = actorFor(paneId)) => {
    if (!automationSiteEnabled(options.settings(), profileId, url, now(), paneId)) return
    ensureLedger()
    let value = usage[usageKey(profileId, url, scopedJob(actor))]
    let warning = Object.values(usage).find(item => item.profileId === profileId && item.warning && automationWarningEnabled(options.settings(), profileId, item.warningHost!, now(), paneId))
    if (warning) throw safetyError(`Automation paused: ${warning.warning} on ${warning.warningHost}. Open the UI alert or Profile > Bot to resolve, resume, or exclude this website`)
    if (value && overLimit(value) && !rested(value)) {
      if (!reachedLimit(value)) {
        let activeMs = activeTime(value)
        value.limitReachedAt = value.lastUsed + Math.max(0, sessionLimit(value) - (value.activeMs ?? 0))
        value.activeMs = activeMs
        persist()
      }
      else options.changed?.()
      throw safetyError(`Automation session limit reached; retry after ${new Date(retryAt(profileId, value)).toISOString()}. Open the UI alert or Profile > Bot to reset the session`)
    }
  }
  let actorsFor = (value: Usage, actor: AutomationActor, url?: string) => {
    let previous = value.actors?.find(item => item.paneId === actor.paneId)
    let host = automationWebsiteHost(url)
    let hosts = [...new Set([...(previous?.hosts ?? []), ...(host ? [host] : [])])]
    let next = { ...previous, paneId: actor.paneId, hosts }
    updateAgentInfo(next, actor)
    return [...(value.actors ?? []).filter(item => item.paneId !== actor.paneId), next]
  }
  let track = (profileId: string, actor: AutomationActor, url?: string) => {
    let value = usage[usageKey(profileId, url, scopedJob(actor))]
    if (!value || !automationSiteEnabled(options.settings(), profileId, url, now(), actor.paneId)) return
    let previous = value.actors?.find(item => item.paneId === actor.paneId)
    if (previous && previous.agentId === actor.agentId && previous.agentName === actor.agentName && previous.agentPurpose === actor.agentPurpose && previous.agentType === actor.agentType && JSON.stringify(previous.agentData) === JSON.stringify(actor.agentData) && JSON.stringify(previous.agentOrigin) === JSON.stringify(actor.agentOrigin) && previous.hosts?.includes(automationWebsiteHost(url)!)) return
    value.actors = actorsFor(value, actor, url)
    persist()
  }
  let before = async (profileId: string, inspect: () => Promise<Page>, targetUrl?: string, pace = true, actor?: AutomationActor, recordUsage = true) => {
    if (!automationSafetyEnabled(options.settings(), profileId, actor?.paneId)) return
    let page = await inspect()
    while (true) {
      let key = usageKey(profileId, targetUrl ?? page.url)
      let jobId = scopedJob(actor), sessionKey = usageKey(profileId, targetUrl ?? page.url, jobId)
      let previous = queues.get(key)
      let task = (previous ?? Promise.resolve()).catch(() => undefined).then(async () => {
        if (!automationSafetyEnabled(options.settings(), profileId, actor?.paneId)) return true
        if (previous) page = await inspect()
        if (key !== usageKey(profileId, targetUrl ?? page.url)) return false
        let enabledForPage = () => automationSiteEnabled(options.settings(), profileId, targetUrl ?? page.url, now(), actor?.paneId)
        if (!enabledForPage()) return true
        ensureLedger()
        let checkWarning = () => {
          let host = automationWebsiteHost(page.url)
          if (!page.warning || !host || !automationSiteEnabled(options.settings(), profileId, page.url, now(), actor?.paneId)) return
          let key = usageKey(profileId, page.url), value = usage[key] ?? { profileId, siteHost: host, startedAt: now(), lastUsed: now(), activeMs: 0 }
          usage[key] = { ...value, warning: page.warning, warningHost: host, warningAt: value.warning === page.warning ? value.warningAt ?? value.startedAt : now(), ...(actor ? { actors: actorsFor(value, actor, page.url) } : {}) }
          persist()
        }
        checkWarning()
        assertAvailable(profileId, actor?.paneId, targetUrl ?? page.url, actor)
        let value = usage[sessionKey], current = now()
        if (!value || rested(value)) value = { profileId, siteHost: automationWebsiteHost(targetUrl ?? page.url)!, ...(jobId ? { jobId } : {}), startedAt: current, lastUsed: current, activeMs: 0, ...(value?.warning ? { warning: value.warning, warningHost: value.warningHost } : {}) }
        let latest = Object.values(usage).filter(item => item.profileId === profileId && item.siteHost === automationWebsiteHost(targetUrl ?? page.url) && !item.pendingSession).sort((a, b) => b.lastUsed - a.lastUsed)[0]
        let lastUsed = Math.max(lastAdmitted.get(key) ?? 0, latest?.lastUsed ?? 0)
        let social = pace && (isSocialUrl(page.url) || isSocialUrl(targetUrl ?? ''))
        let interval = automationProfileLimits(options.settings(), profileId).socialDelayMs
        let burst = bursts.get(key) ?? (latest?.burstStartedAt !== undefined ? { startedAt: latest.burstStartedAt, count: latest.burstCount ?? 3 } : undefined)
        // A fast follow-up opens a three-action burst, including the previous action.
        if (social && lastUsed && current < lastUsed + interval && (!burst || current >= burst.startedAt + 60_000)) burst = { startedAt: current, count: 1 }
        let bursting = social && burst && burst.count < 3 && current < burst.startedAt + 1000
        let delay = social && lastUsed ? Math.max(0, lastUsed + (bursting ? Math.min(interval, 334) : interval) - current) : 0
        if (delay) {
          await sleep(delay)
          page = await inspect()
          // Navigation can change the pacing domain while this command waits.
          // Release this queue before joining the destination's queue.
          if (key !== usageKey(profileId, targetUrl ?? page.url)) return false
          if (!enabledForPage()) return true
          checkWarning()
          assertAvailable(profileId, actor?.paneId, targetUrl ?? page.url, actor)
        }
        if (pace) {
          lastAdmitted.set(key, now())
          if (burst) { if (bursting) burst.count++; bursts.set(key, burst); value.burstStartedAt = burst.startedAt; value.burstCount = burst.count }
        }
        if (!recordUsage) return true
        touch(value)
        usage[sessionKey] = { ...value, ...(actor && recordUsage ? { actors: actorsFor(value, actor, targetUrl ?? page.url) } : {}) }
        persist()
        assertAvailable(profileId, actor?.paneId, targetUrl ?? page.url, actor)
        return true
      })
      queues.set(key, task)
      try { if (await task) return } finally { if (queues.get(key) === task) queues.delete(key) }
    }
  }
  let complete = (profileId: string, actor: AutomationActor, url: string) => {
    if (!automationSiteEnabled(options.settings(), profileId, url, now(), actor.paneId)) return
    ensureLedger()
    let jobId = scopedJob(actor), key = usageKey(profileId, url, jobId), value = usage[key]
    if (!value || rested(value)) value = { profileId, siteHost: automationWebsiteHost(url)!, ...(jobId ? { jobId } : {}), startedAt: now(), lastUsed: now(), activeMs: 0 }
    touch(value)
    let burst = bursts.get(usageKey(profileId, url))
    usage[key] = { ...value, ...(burst ? { burstStartedAt: burst.startedAt, burstCount: burst.count } : {}), actors: actorsFor(value, actor, url) }
    persist()
  }
  let after = (profileId: string, paneId: string, url: string, actor = actorFor(paneId)) => {
    if (!automationSiteEnabled(options.settings(), profileId, url, now(), paneId)) return
    let value = usage[usageKey(profileId, url, scopedJob(actor))]
    if (value && !value.pendingSession) { touch(value); persist() }
  }
  let resume = (profileId: string, page: Page) => {
    ensureLedger()
    if (page.warning) throw safetyError('The page still shows an account warning or challenge')
    let values = Object.values(usage).filter(value => value.profileId === profileId && value.siteHost.replace(/^www\./, '') === new URL(page.url).hostname.replace(/^www\./, ''))
    let warning = Object.values(usage).find(item => item.profileId === profileId && item.warning)
    if (!values.length && warning) throw safetyError(`Open ${warning.warningHost} and resolve its warning before resuming automation`)
    if (values.length) { for (let value of values) { delete value.warning; delete value.warningHost; delete value.warningAt }; persist() }
    return { resumed: true }
  }
  let status = (): AutomationSafetyState => ({ enabled: options.settings().enabled, limits: options.settings(), ...(ledgerError ? { error: 'Automation safety ledger is unreadable; repair it before automating' } : {}), profiles: Object.values(usage).filter(value => !value.jobId || options.settings().jobSessionMinutes?.[value.jobId] !== undefined || value.warning).map(value => ({ ...value, retryAfter: reachedLimit(value) && now() < retryAt(value.profileId, value) ? new Date(retryAt(value.profileId, value)).toISOString() : null })) })
  let resetSession = (profileId: string, siteHost?: string) => {
    ensureLedger()
    for (let value of Object.values(usage).filter(value => value.profileId === profileId && (!siteHost || value.siteHost === siteHost))) { value.startedAt = now(); value.lastUsed = value.startedAt; value.pendingSession = true; value.activeMs = 0; delete value.limitReachedAt; value.actors = []; persist() }
    return { reset: true }
  }
  return { before, complete, after, assertAvailable, resume, resetSession, status, track }
}
