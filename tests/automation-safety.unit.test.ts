import { afterEach, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { automationWarningScript, createAutomationSafety } from '../src/main/automation-safety'
import { updateAutomationSafetyLimit, automationProfileLimits, automationSiteEnabled, automationSafetyEnabled, automationSiteExclusion, automationWarningEnabled, updateAutomationSiteExclusion, automationTargetUrl, DEFAULT_AUTOMATION, isSocialUrl, paceAutomationCommand, parseAutomationSettings } from '../src/shared/automation'

let directories: string[] = []
afterEach(() => { for (let directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
let fixture = () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-safety-test-'))
  directories.push(directory)
  let time = Date.parse('2026-10-01T00:00:00Z'), settings = { ...DEFAULT_AUTOMATION.safety }, sleeps: number[] = []
  let file = path.join(directory, 'usage.json')
  let changes = 0
  let create = () => createAutomationSafety({ file, settings: () => settings, now: () => time, sleep: async ms => { sleeps.push(ms); time += ms }, changed: () => { changes++ } })
  return { policy: create(), file, settings, sleeps, changes: () => changes, advance: (ms: number) => { time += ms }, restart: create }
}
let instagram = async () => ({ url: 'https://www.instagram.com/' })

test('limit edits validate existing bounds and cannot change protection or exclusion settings', () => {
  let settings = structuredClone(DEFAULT_AUTOMATION.safety), original = structuredClone(settings)
  expect(updateAutomationSafetyLimit(settings, 'maxSessionMinutes', 1440)).toBe(1440)
  expect(updateAutomationSafetyLimit(settings, 'cooldownMinutes', 1)).toBe(1)
  expect(updateAutomationSafetyLimit(settings, 'socialDelayMs', 1250)).toBe(1250)
  for (let key of ['maxSessionMinutes', 'cooldownMinutes', 'socialDelayMs']) {
    for (let value of [undefined, null, 0, -1, 1.5, '2', true, Infinity, 30_001]) expect(() => updateAutomationSafetyLimit(settings, key, value)).toThrow()
  }
  for (let key of ['enabled', 'profiles', 'sites', 'unknown', undefined]) expect(() => updateAutomationSafetyLimit(settings, key, false)).toThrow()
  expect(settings).toEqual(original)
})

test('edited session, break, and pacing limits take effect in the running policy', async () => {
  let { policy, settings, advance, sleeps } = fixture()
  await policy.before('bot', instagram)
  settings.maxSessionMinutes = updateAutomationSafetyLimit(settings, 'maxSessionMinutes', 20)
  settings.cooldownMinutes = updateAutomationSafetyLimit(settings, 'cooldownMinutes', 5)
  settings.socialDelayMs = updateAutomationSafetyLimit(settings, 'socialDelayMs', 750)
  for (let minutes of [4, 4, 3]) { advance(minutes * 60_000); await policy.before('bot', instagram) }
  await policy.before('bot', instagram)
  expect(sleeps).toEqual([750])
  advance(9 * 60_000 - 750)
  expect(() => policy.assertAvailable('bot')).toThrow('retry after 2026-10-01T00:25:00.000Z')
  advance(5 * 60_000)
  await policy.before('bot', instagram)
  expect(policy.status().profiles[0].retryAfter).toBeNull()
})

test('old and new configs enable global safety without optional groups', () => {
  expect(parseAutomationSettings(undefined).safety).toEqual(DEFAULT_AUTOMATION.safety)
  expect(parseAutomationSettings({ groups: {} }).safety.enabled).toBe(true)
  expect(parseAutomationSettings({ safety: { maxSessionMinutes: 3 } }).safety.maxSessionMinutes).toBe(3)
  for (let safety of [{ enabled: 'yes' }, { maxSessionMinutes: 0 }, { socialDelayMs: -1 }, { cooldownMinutes: Infinity }, { unknown: 1 }]) expect(() => parseAutomationSettings({ safety })).toThrow()
  expect(isSocialUrl('https://studio.youtube.com/upload')).toBe(true)
  expect(isSocialUrl('https://www.instagram.com/')).toBe(true)
  expect(isSocialUrl('https://threads.net/')).toBe(true)
  expect(isSocialUrl('https://instagram.com.evil.test/')).toBe(false)
})

test('paces concurrent calls across panes in one profile, without delaying other profiles or local fixtures', async () => {
  let { policy, sleeps } = fixture()
  await Promise.all([policy.before('bot', instagram), policy.before('bot', instagram), policy.before('bot', async () => ({ url: 'https://x.com/' }))])
  expect(sleeps).toEqual([2000, 2000])
  await policy.before('other', instagram)
  await policy.before('local', async () => ({ url: 'http://127.0.0.1/fixture' }))
  await policy.before('local', async () => ({ url: 'http://127.0.0.1/fixture' }))
  expect(sleeps).toHaveLength(2)
})

test('session limits and cooldown survive app restarts and failed retries do not extend the break', async () => {
  let { policy, advance, restart } = fixture()
  await policy.before('bot', instagram)
  advance(10 * 60_000)
  await expect(policy.before('bot', instagram)).rejects.toThrow('retry after 2026-10-01T00:30:00.000Z')
  let next = restart()
  advance(19 * 60_000)
  await expect(next.before('bot', instagram)).rejects.toThrow('00:30:00.000Z')
  advance(60_000)
  await next.before('bot', instagram)
  expect(next.status().profiles[0].startedAt).toBe(Date.parse('2026-10-01T00:30:00Z'))
})

test('records affected automation panes and agent IDs, including denied commands, without extending cooldown', async () => {
  let { policy, advance, restart } = fixture()
  await policy.before('bot', instagram, undefined, true, { paneId: '%1', agentId: '%42' })
  advance(10 * 60_000)
  await expect(policy.before('bot', instagram, undefined, true, { paneId: '%2', agentId: 'research' })).rejects.toThrow('session limit')
  let next = restart()
  expect(next.status().profiles[0]).toMatchObject({ actors: [{ paneId: '%1', agentId: '%42' }, { paneId: '%2', agentId: 'research' }], retryAfter: '2026-10-01T00:30:00.000Z' })
  advance(20 * 60_000)
  await next.before('bot', instagram, undefined, true, { paneId: '%3' })
  expect(next.status().profiles[0].actors).toEqual([{ paneId: '%3' }])
})

test('pane toggles persist independently and bypass only the chosen pane', async () => {
  let { policy, settings, advance, restart } = fixture()
  await policy.before('bot', instagram, undefined, true, { paneId: '%1' })
  advance(10 * 60_000)
  settings.panes = { '%1': false, '%2': true }
  expect(parseAutomationSettings({ safety: { panes: settings.panes } }).safety.panes).toEqual(settings.panes)
  let next = restart()
  await next.before('bot', async () => { throw new Error('Disabled pane must not inspect') }, undefined, true, { paneId: '%1' })
  await expect(next.before('bot', instagram, undefined, true, { paneId: '%2' })).rejects.toThrow('session limit')
  expect(() => next.assertAvailable('bot', '%1')).not.toThrow()
  settings.enabled = false
  expect(automationSafetyEnabled(settings, 'bot', '%1')).toBe(false)
  expect(automationSafetyEnabled(settings, 'bot', '%2')).toBe(true)
  expect(automationSafetyEnabled(settings, 'bot', '%3')).toBe(false)
  expect(() => parseAutomationSettings({ safety: { panes: { '%1': 'false' } } })).toThrow('pane IDs')
})

test('warnings latch across restarts and other sites until a human resolves the affected site', async () => {
  let { policy, advance, restart } = fixture()
  await expect(policy.before('bot', async () => ({ url: 'https://www.instagram.com/', warning: 'account-warning' }))).rejects.toThrow('Automation paused')
  advance(24 * 60 * 60_000)
  let next = restart()
  await expect(next.before('bot', async () => ({ url: 'https://x.com/' }))).rejects.toThrow('Automation paused')
  expect(() => next.resume('bot', { url: 'https://instagram.com/', warning: 'challenge' })).toThrow('still shows')
  expect(() => next.resume('bot', { url: 'https://x.com/' })).toThrow('Open www.instagram.com')
  next.resume('bot', { url: 'https://instagram.com/' })
  await next.before('bot', instagram)
  expect(next.status().profiles[0].warning).toBeUndefined()
})

test('hitting the session limit publishes the cooldown without extending its deadline', async () => {
  let { policy, advance, changes } = fixture()
  await policy.before('bot', instagram)
  let previous = changes()
  advance(10 * 60_000)
  expect(() => policy.assertAvailable('bot')).toThrow('Open the UI alert or Profile > Anti-bot')
  expect(changes()).toBe(previous + 1)
  expect(policy.status().profiles[0].retryAfter).toBe('2026-10-01T00:30:00.000Z')
})

test('a human session reset persists fresh usage for only that profile and preserves warning pauses', async () => {
  let { policy, advance, restart } = fixture()
  await policy.before('bot', instagram)
  await policy.before('other', instagram)
  advance(10 * 60_000)
  policy.resetSession('bot')
  let next = restart()
  await next.before('bot', instagram)
  await expect(next.before('other', instagram)).rejects.toThrow('session limit')
  expect(next.status().profiles.find(item => item.profileId === 'bot')).toMatchObject({ startedAt: Date.parse('2026-10-01T00:10:00Z'), retryAfter: null })
  await expect(next.before('bot', async () => ({ url: 'https://instagram.com/', warning: 'account-warning' }))).rejects.toThrow('Automation paused')
  next.resetSession('bot')
  await expect(restart().before('bot', instagram)).rejects.toThrow('Automation paused')
})

test('a page change during the delay is checked again before dispatch', async () => {
  let { policy } = fixture()
  await policy.before('bot', instagram)
  let inspected = 0
  await expect(policy.before('bot', async () => ({ url: 'https://instagram.com/', ...(++inspected > 1 ? { warning: 'challenge' as const } : {}) }))).rejects.toThrow('challenge')
  expect(inspected).toBe(2)
})

test('corrupt or unwritable ledgers stop automation, while an explicit opt-out skips inspection', async () => {
  let { file, policy, restart, settings } = fixture()
  fs.writeFileSync(file, '{broken')
  await expect(restart().before('bot', instagram)).rejects.toThrow('unreadable')
  fs.mkdirSync(`${file}.tmp`)
  await expect(policy.before('bot', instagram)).rejects.toThrow('Could not save')
  settings.enabled = false
  await policy.before('bot', async () => { throw new Error('must not inspect') })
})

test('navigation from a blank pane to social sites counts toward the same session', async () => {
  let { policy, advance } = fixture()
  await policy.before('bot', async () => ({ url: 'about:blank' }), 'https://instagram.com/')
  advance(10 * 60_000)
  await expect(policy.before('bot', async () => ({ url: 'about:blank' }), 'https://youtube.com/')).rejects.toThrow('session limit')
})

test('blank panes and raw CDP navigation cannot avoid session accounting or social pacing', async () => {
  let { policy, advance, sleeps } = fixture()
  let target = automationTargetUrl('cdp', { method: 'Page.navigate', params: { url: 'https://instagram.com/' } })
  expect(target).toBe('https://instagram.com/')
  await policy.before('bot', async () => ({ url: 'about:blank' }))
  await policy.before('bot', async () => ({ url: 'about:blank' }), target)
  expect(sleeps).toEqual([2000])
  advance(10 * 60_000)
  await expect(policy.before('bot', async () => ({ url: 'about:blank' }))).rejects.toThrow('session limit')
})

test('profile opt-outs skip the guard without changing other profiles or deleting paused usage', async () => {
  let { policy, settings } = fixture()
  await expect(policy.before('bot', async () => ({ url: 'https://instagram.com/', warning: 'account-warning' }))).rejects.toThrow('Automation paused')
  settings.profiles = { bot: false }
  await policy.before('bot', async () => { throw new Error('disabled profiles must not inspect') })
  await policy.before('other', instagram)
  settings.profiles.bot = true
  await expect(policy.before('bot', instagram)).rejects.toThrow('Automation paused')
  expect(() => parseAutomationSettings({ safety: { profiles: { bot: 'false' } } })).toThrow('profile IDs')
})

test('releasing an input avoids artificial long presses while later actions remain paced', async () => {
  let { policy, sleeps } = fixture()
  expect(paceAutomationCommand('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased' } })).toBe(false)
  expect(paceAutomationCommand('cdp', { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp' } })).toBe(false)
  expect(paceAutomationCommand('cdp', { method: 'Runtime.evaluate', params: { type: 'mouseReleased' } })).toBe(true)
  await policy.before('bot', instagram)
  await policy.before('bot', instagram, undefined, false)
  expect(sleeps).toEqual([])
  await policy.before('bot', instagram)
  expect(sleeps).toEqual([2000])
})

test('detects warning pages and visible dialogs without matching feed posts or hidden CAPTCHA frames', () => {
  let detect = (options: { url?: string; body?: string; title?: string; dialog?: string; feed?: boolean; challenge?: boolean }) => vm.runInNewContext(automationWarningScript, {
    URL, location: { href: options.url ?? 'https://instagram.com/' }, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    document: {
      title: options.title ?? '', body: { innerText: options.body ?? '' }, querySelector: () => options.feed ? {} : null,
      querySelectorAll: (selector: string) => selector.startsWith('iframe') ? [{ getClientRects: () => options.challenge ? [{}] : [] }] : options.dialog ? [{ innerText: options.dialog, getClientRects: () => [{}], closest: () => null }] : [],
    },
  })
  expect(detect({ body: 'We suspect automated behavior on your account.' })).toBe('account-warning')
  expect(detect({ dialog: 'We restrict certain activity to protect our community.', feed: true })).toBe('rate-limit')
  expect(detect({ body: 'Please verify that you are human.' })).toBe('challenge')
  expect(detect({ url: 'https://instagram.com/challenge/123/' })).toBe('challenge')
  expect(detect({ url: 'https://www.google.com/sorry/index' })).toBe('challenge')
  expect(detect({ challenge: true })).toBe('challenge')
  expect(detect({ feed: true, body: 'A post about how we suspect automated behavior on your account.' })).toBeUndefined()
  expect(detect({ body: 'Welcome back. Sign in to Instagram.' })).toBeUndefined()
})

test('site warning opt-outs release a latched pause without disabling profile limits or other hosts', async () => {
  let { policy, settings, restart, advance } = fixture()
  await expect(policy.before('bot', async () => ({ url: 'https://unblock.example.com/', warning: 'challenge' }))).rejects.toThrow('on unblock.example.com')
  settings.sites = { bot: { 'unblock.example.com': false } }
  let next = restart()
  await next.before('bot', async () => ({ url: 'https://unblock.example.com/', warning: 'challenge' }))
  await next.before('bot', async () => ({ url: 'file:///preview.html' }))
  await expect(next.before('other', async () => ({ url: 'https://unblock.example.com/', warning: 'challenge' }))).rejects.toThrow('Automation paused')
  await expect(next.before('bot', async () => ({ url: 'https://example.com/', warning: 'account-warning' }))).rejects.toThrow('on example.com')
  settings.sites.bot['example.com'] = false
  advance(10 * 60_000)
  await expect(next.before('bot', instagram)).rejects.toThrow('session limit')
  settings.sites.bot['example.com'] = true
  expect(() => next.assertAvailable('bot')).toThrow('on example.com')
  expect(parseAutomationSettings({ safety: { sites: settings.sites } }).safety.sites).toEqual(settings.sites)
  for (let sites of [{ bot: { 'example.com': 'false' } }, { bot: { 'https://example.com': false } }, { bot: [] }]) expect(() => parseAutomationSettings({ safety: { sites } })).toThrow()
})


test.each([15, 60] as const)('timed exclusions expire after %i minutes across restarts', async duration => {
  let { policy, settings, restart, advance } = fixture()
  let start = Date.parse('2026-10-01T00:00:00Z')
  let warning = async () => ({ url: 'https://example.com/', warning: 'challenge' as const })
  await expect(policy.before('bot', warning)).rejects.toThrow('Automation paused')
  settings.sites = { bot: { 'example.com': updateAutomationSiteExclusion(undefined, false, duration, start) } }
  expect(automationWarningEnabled(settings, 'bot', 'EXAMPLE.COM', start)).toBe(false)
  expect(automationWarningEnabled(settings, 'other', 'example.com', start)).toBe(true)
  expect(automationWarningEnabled(settings, 'bot', 'sub.example.com', start)).toBe(true)
  await restart().before('bot', warning)
  advance(duration * 60_000 - 1)
  expect(() => restart().assertAvailable('bot')).not.toThrow('Automation paused')
  advance(1)
  expect(() => restart().assertAvailable('bot')).toThrow('Automation paused')
})

test('turning exclusions on stays permanent, including previously timed and expired rules', () => {
  let rule = updateAutomationSiteExclusion(undefined, false, 15, 1000)
  let off = updateAutomationSiteExclusion(rule, true, undefined, 2000)
  expect(off).toEqual({ enabled: false, durationMinutes: null, expiresAt: null })
  let persistent = { enabled: true, durationMinutes: null, expiresAt: null }
  for (let previous of [undefined, rule, off, false, true]) {
    let on = updateAutomationSiteExclusion(previous, false, undefined, 1_000_000)
    expect(on).toEqual(persistent)
    let settings = parseAutomationSettings({ safety: { sites: { bot: { 'example.com': on } } } }).safety
    expect(automationWarningEnabled(settings, 'bot', 'example.com', 100_000_000)).toBe(false)
    expect(automationWarningEnabled(settings, 'other', 'example.com', 100_000_000)).toBe(true)
  }
  expect(updateAutomationSiteExclusion(rule, false, null)).toEqual({ enabled: true, durationMinutes: null, expiresAt: null })
  expect(automationSiteExclusion(false)).toEqual({ enabled: true, durationMinutes: null, expiresAt: null })
  expect(automationSiteExclusion(true)?.enabled).toBe(false)
  for (let duration of [0, -1, 30, '15', Infinity]) expect(() => updateAutomationSiteExclusion(rule, false, duration)).toThrow('durationMinutes')
  expect(() => updateAutomationSiteExclusion(rule, 'false', 15)).toThrow('enabled')
  let sites = { bot: { 'example.com': rule, localhost: false } }
  expect(parseAutomationSettings({ safety: { sites } }).safety.sites).toEqual(sites)
  for (let invalid of [{ ...rule, expiresAt: null }, { ...rule, expiresAt: Infinity }, { ...rule, durationMinutes: 30 }, { ...rule, durationMinutes: null }, { ...rule, enabled: 'false' }, { ...rule, unknown: true }]) expect(() => parseAutomationSettings({ safety: { sites: { bot: { 'example.com': invalid } } } })).toThrow()
})


test('profile limits validate, inherit old defaults, and isolate pacing and cooldowns across restarts', async () => {
  let { settings, policy, advance, sleeps, restart } = fixture()
  settings.profileLimits = { bot: { maxSessionMinutes: 2, cooldownMinutes: 3, socialDelayMs: 500 }, other: { maxSessionMinutes: 20, cooldownMinutes: 10, socialDelayMs: 1500 } }
  expect(parseAutomationSettings({ safety: settings }).safety.profileLimits).toEqual(settings.profileLimits)
  expect(automationProfileLimits(settings, 'default')).toEqual({ maxSessionMinutes: 10, cooldownMinutes: 20, socialDelayMs: 2000 })
  for (let entry of [{ unknown: 1 }, { maxSessionMinutes: 0 }, { cooldownMinutes: '3' }, { socialDelayMs: 30001 }, false]) expect(() => parseAutomationSettings({ safety: { profileLimits: { bot: entry } } })).toThrow()
  await policy.before('bot', instagram)
  await policy.before('bot', instagram)
  await policy.before('other', instagram)
  await policy.before('other', instagram)
  expect(sleeps).toEqual([500, 1500])
  advance(2 * 60_000 - 2000)
  let next = restart()
  await expect(next.before('bot', instagram)).rejects.toThrow('00:05:00')
  await next.before('other', instagram)
  expect(next.status().profiles.find(item => item.profileId === 'other')!.retryAfter).toBeNull()
  settings.profileLimits.bot.maxSessionMinutes = 4
  expect(() => next.assertAvailable('bot')).not.toThrow()
  settings.profileLimits.bot.maxSessionMinutes = 2
  advance(3 * 60_000)
  await next.before('bot', instagram)
})

test('excluded websites skip session limits, pacing, and warnings only in their profile', async () => {
  let { settings, policy, advance, sleeps, restart } = fixture()
  await policy.before('bot', instagram)
  await policy.before('other', instagram)
  let before = policy.status().profiles.find(item => item.profileId === 'bot')
  settings.sites = { bot: { 'www.instagram.com': updateAutomationSiteExclusion(undefined, false, undefined) } }
  await policy.before('bot', async () => ({ url: 'https://www.instagram.com/', warning: 'challenge' }))
  expect(sleeps).toEqual([])
  expect(policy.status().profiles.find(item => item.profileId === 'bot')).toEqual(before)
  advance(10 * 60_000)
  let next = restart()
  expect(automationSiteEnabled(settings, 'bot', 'https://www.instagram.com/')).toBe(false)
  expect(automationSiteEnabled(settings, 'bot', 'https://instagram.com/')).toBe(true)
  expect(() => next.assertAvailable('bot', undefined, 'https://www.instagram.com/')).not.toThrow()
  await next.before('bot', async () => ({ url: 'https://www.instagram.com/', warning: 'challenge' }))
  await next.before('bot', async () => ({ url: 'about:blank' }), 'https://www.instagram.com/')
  await expect(next.before('bot', async () => ({ url: 'https://www.instagram.com/' }), 'https://x.com/')).rejects.toThrow('session limit')
  await expect(next.before('bot', async () => ({ url: 'https://x.com/' }))).rejects.toThrow('session limit')
  await expect(next.before('other', instagram)).rejects.toThrow('session limit')
  delete settings.sites.bot['www.instagram.com']
  await expect(next.before('bot', instagram)).rejects.toThrow('session limit')
})
