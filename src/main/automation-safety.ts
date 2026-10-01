import fs from 'node:fs'
import path from 'node:path'
import type { AutomationSafety, AutomationSafetyState, AutomationWarning } from '../shared/automation'
import { automationSafetyEnabled, isSocialUrl } from '../shared/automation'

type Usage = { startedAt: number; lastUsed: number; warning?: AutomationWarning; warningHost?: string }
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
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded) || Object.values(loaded).some(value => !value || !Number.isFinite(value.startedAt) || !Number.isFinite(value.lastUsed) || value.lastUsed < value.startedAt || value.warning !== undefined && (!warnings.includes(value.warning) || typeof value.warningHost !== 'string' || !value.warningHost))) throw new Error('Invalid safety ledger')
    usage = loaded as Record<string, Usage>
  } catch (error) { ledgerError = (error as NodeJS.ErrnoException).code !== 'ENOENT' }
  let queues = new Map<string, Promise<void>>()
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
  let retryAt = (value: Usage) => Math.max(value.startedAt + options.settings().maxSessionMinutes * 60_000, value.lastUsed) + options.settings().cooldownMinutes * 60_000
  let assertAvailable = (profileId: string) => {
    if (!automationSafetyEnabled(options.settings(), profileId)) return
    ensureLedger()
    let value = usage[profileId]
    if (value?.warning) throw safetyError(`Automation paused: ${value.warning}. Resolve it manually, then run automation resume in the bmux command prompt`)
    if (value && now() >= value.startedAt + options.settings().maxSessionMinutes * 60_000 && now() < retryAt(value)) throw safetyError(`Automation session limit reached; retry after ${new Date(retryAt(value)).toISOString()}`)
  }
  let before = async (profileId: string, inspect: () => Promise<Page>, targetUrl?: string, pace = true) => {
    if (!automationSafetyEnabled(options.settings(), profileId)) return
    let previous = queues.get(profileId) ?? Promise.resolve()
    let task = previous.catch(() => undefined).then(async () => {
      if (!automationSafetyEnabled(options.settings(), profileId)) return
      assertAvailable(profileId)
      let page = await inspect()
      let value = usage[profileId], current = now()
      if (!value || current >= retryAt(value) || current - value.lastUsed >= options.settings().cooldownMinutes * 60_000) value = { startedAt: current, lastUsed: current }
      let delay = pace && usage[profileId] && (isSocialUrl(page.url) || isSocialUrl(targetUrl ?? '')) ? Math.max(0, value.lastUsed + options.settings().socialDelayMs - current) : 0
      if (delay) { await sleep(delay); assertAvailable(profileId); page = await inspect() }
      usage[profileId] = { ...value, lastUsed: now(), ...(page.warning ? { warning: page.warning, warningHost: new URL(page.url).hostname } : {}) }
      persist()
      assertAvailable(profileId)
    })
    queues.set(profileId, task)
    try { await task } finally { if (queues.get(profileId) === task) queues.delete(profileId) }
  }
  let resume = (profileId: string, page: Page) => {
    ensureLedger()
    if (page.warning) throw safetyError('The page still shows an account warning or challenge')
    let value = usage[profileId]
    if (value?.warningHost && new URL(page.url).hostname.replace(/^www\./, '') !== value.warningHost.replace(/^www\./, '')) throw safetyError(`Open ${value.warningHost} and resolve its warning before resuming automation`)
    if (value) { delete value.warning; delete value.warningHost; persist() }
    return { resumed: true }
  }
  let status = (): AutomationSafetyState => ({ enabled: options.settings().enabled, limits: options.settings(), ...(ledgerError ? { error: 'Automation safety ledger is unreadable; repair it before automating' } : {}), profiles: Object.entries(usage).map(([profileId, value]) => ({ profileId, ...value, retryAfter: now() >= value.startedAt + options.settings().maxSessionMinutes * 60_000 && now() < retryAt(value) ? new Date(retryAt(value)).toISOString() : null })) })
  return { before, assertAvailable, resume, status }
}
