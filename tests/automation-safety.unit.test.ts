import { afterEach, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { automationWarningScript, createAutomationSafety } from '../src/main/automation-safety'
import { automationSessionMinutes, updateAutomationSafetyLimit, automationWebsiteHost, automationProfileLimits, automationSiteEnabled, automationSafetyEnabled, automationSiteExclusion, automationWarningEnabled, updateAutomationSiteExclusion, automationTargetUrl, DEFAULT_AUTOMATION, isSocialUrl, paceAutomationCommand, parseAutomationSettings } from '../src/shared/automation'

let directories: string[] = []
afterEach(() => { for (let directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
let fixture = (pause?: (ms: number) => Promise<void>) => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-safety-test-'))
  directories.push(directory)
  let time = Date.parse('2026-10-01T00:00:00Z'), settings = { ...DEFAULT_AUTOMATION.safety }, sleeps: number[] = []
  let file = path.join(directory, 'usage.json')
  let changes = 0
  let current: ReturnType<typeof createAutomationSafety>
  let create = () => current = createAutomationSafety({ file, settings: () => settings, now: () => time, sleep: async ms => { sleeps.push(ms); if (pause) await pause(ms); time += ms }, changed: () => { changes++ } })
  let active = (ms: number) => {
    // Complete an interaction every second, leaving the final interval open.
    for (let remaining = ms; remaining > 0;) {
      let step = Math.min(1000, remaining)
      time += step; remaining -= step
      if (remaining) for (let row of current.status().profiles) current.after(row.profileId, '%active', `https://${row.siteHost}/`, row.jobId ? { paneId: '%active', agentType: 'clawtab', agentData: { jobId: row.jobId } } : undefined)
    }
  }
  return { active, policy: create(), file, settings, sleeps, changes: () => changes, advance: (ms: number) => { time += ms }, restart: create }
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
  let { policy, settings, advance, active, sleeps } = fixture()
  await policy.before('bot', instagram)
  settings.maxSessionMinutes = updateAutomationSafetyLimit(settings, 'maxSessionMinutes', 20)
  settings.cooldownMinutes = updateAutomationSafetyLimit(settings, 'cooldownMinutes', 5)
  settings.socialDelayMs = updateAutomationSafetyLimit(settings, 'socialDelayMs', 750)
  for (let minutes of [4, 4, 3]) { active(minutes * 60_000); await policy.before('bot', instagram) }
  await policy.before('bot', instagram)
  expect(sleeps).toEqual([334])
  for (let minutes of [4, 4]) { active(minutes * 60_000); await policy.before('bot', instagram) }
  active(60_000 - 334)
  expect(() => policy.assertAvailable('bot', undefined, 'https://www.instagram.com/')).toThrow('retry after 2026-10-01T00:25:00.000Z')
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

test('paces concurrent panes on the same hostname and profile, independently of other sites and profiles', async () => {
  let { policy, sleeps } = fixture()
  await Promise.all([
    policy.before('bot', instagram, undefined, true, { paneId: '%1' }),
    policy.before('bot', async () => ({ url: 'https://WWW.INSTAGRAM.COM:8443/another-path' }), undefined, true, { paneId: '%2' }),
    policy.before('bot', async () => ({ url: 'https://x.com/' }), undefined, true, { paneId: '%3' }),
  ])
  expect(sleeps).toEqual([334])
  await policy.before('other', instagram)
  await policy.before('bot', async () => ({ url: 'http://127.0.0.1/fixture' }))
  await policy.before('bot', async () => ({ url: 'http://127.0.0.1/fixture' }))
  expect(sleeps).toHaveLength(1)
})

test('a sleeping hostname queue does not block other sites, profiles, or local fixtures', async () => {
  let release!: () => void, sleeping!: () => void
  let gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { sleeping = resolve })
  let { policy, sleeps } = fixture(async () => { sleeping(); await gate })
  await policy.before('bot', instagram)
  let finished = false
  let waiting = policy.before('bot', instagram).then(() => { finished = true })
  await started
  try {
    await Promise.all([
      policy.before('bot', async () => ({ url: 'https://x.com/' })),
      policy.before('bot', async () => ({ url: 'https://www.reddit.com/' })),
      policy.before('bot', async () => ({ url: 'https://www.tiktok.com/' })),
      policy.before('other', instagram),
      policy.before('bot', async () => ({ url: 'http://127.0.0.1/fixture' })),
    ])
    expect(finished).toBe(false)
    expect(sleeps).toEqual([334])
  } finally { release(); await waiting }
})

test('persisted pacing uses only the requested hostname after a restart', async () => {
  let { policy, advance, sleeps, restart } = fixture()
  await policy.before('bot', instagram)
  advance(1000)
  await policy.before('bot', async () => ({ url: 'https://x.com/' }))
  expect(sleeps).toEqual([])
  await restart().before('bot', instagram)
  await restart().before('bot', instagram)
  expect(sleeps).toEqual([334])
})

test('a warning from another hostname still stops an action waiting in this profile', async () => {
  let release!: () => void, sleeping!: () => void
  let gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { sleeping = resolve })
  let { policy } = fixture(async () => { sleeping(); await gate })
  await policy.before('bot', instagram)
  let waiting = expect(policy.before('bot', instagram)).rejects.toThrow('challenge on x.com')
  await started
  try {
    await expect(policy.before('bot', async () => ({ url: 'https://x.com/', warning: 'challenge' }))).rejects.toThrow('challenge on x.com')
  } finally { release(); await waiting }
})

test('navigation during a delay joins the destination queue and respects its latest action', async () => {
  let { policy, advance, sleeps } = fixture()
  await policy.before('bot', instagram)
  let inspections = 0
  await policy.before('bot', async () => {
    if (++inspections === 1) return instagram()
    if (inspections === 2) {
      advance(500)
      await policy.before('bot', async () => ({ url: 'https://x.com/' }))
    }
    return { url: 'https://x.com/' }
  })
  expect(sleeps).toEqual([334, 334])
  expect(policy.status().profiles.find(row => row.siteHost === 'x.com')?.lastUsed).toBe(Date.parse('2026-10-01T00:00:01.168Z'))
})

test('queued commands recheck the hostname before entering its pacing queue', async () => {
  let { policy, sleeps } = fixture()
  let inspections = 0
  await Promise.all([
    policy.before('bot', instagram),
    policy.before('bot', async () => ++inspections === 1 ? instagram() : { url: 'https://x.com/' }),
  ])
  expect(sleeps).toEqual([])
  expect(policy.status().profiles.map(row => row.siteHost)).toEqual(['www.instagram.com', 'x.com'])
})

test('session limits and cooldown survive app restarts and failed retries do not extend the break', async () => {
  let { policy, advance, active, restart } = fixture()
  await policy.before('bot', instagram)
  active(10 * 60_000)
  await expect(policy.before('bot', instagram)).rejects.toThrow('retry after 2026-10-01T00:30:00.000Z')
  let next = restart()
  advance(19 * 60_000)
  await expect(next.before('bot', instagram)).rejects.toThrow('00:30:00.000Z')
  advance(60_000)
  await next.before('bot', instagram)
  expect(next.status().profiles[0].startedAt).toBe(Date.parse('2026-10-01T00:30:00Z'))
})

test('records only admitted automation panes and agent IDs without extending cooldown', async () => {
  let { policy, advance, active, restart } = fixture()
  await policy.before('bot', instagram, undefined, true, { paneId: '%1', agentId: '%42' })
  active(10 * 60_000)
  await expect(policy.before('bot', instagram, undefined, true, { paneId: '%2', agentId: 'research' })).rejects.toThrow('session limit')
  let next = restart()
  expect(next.status().profiles[0]).toMatchObject({ actors: [{ paneId: '%1', agentId: '%42' }], retryAfter: '2026-10-01T00:30:00.000Z' })
  advance(20 * 60_000)
  await next.before('bot', instagram, undefined, true, { paneId: '%3' })
  expect(next.status().profiles[0].actors).toEqual([{ paneId: '%3', hosts: ['www.instagram.com'] }])
})

test('website clocks and actors stay separate across navigation, resets and restarts', async () => {
  let { policy, active, restart } = fixture()
  let actor = { paneId: '%1', agentId: 'research', agentType: 'tmux', agentData: { paneId: '%42' } }
  await policy.before('bot', instagram, 'https://example.com/path', true, actor)
  active(10 * 60_000)
  await expect(policy.before('bot', instagram, 'https://example.com/other', true, { paneId: '%2' })).rejects.toThrow('session limit')
  await policy.before('bot', instagram, 'https://x.com/', true, { paneId: '%3' })
  let next = restart()
  let rows = next.status().profiles
  expect(rows.find(row => row.siteHost === 'example.com')).toMatchObject({ actors: [{ ...actor, hosts: ['example.com'] }], retryAfter: '2026-10-01T00:30:00.000Z' })
  expect(rows.find(row => row.siteHost === 'x.com')).toMatchObject({ actors: [{ paneId: '%3', hosts: ['x.com'] }], retryAfter: null })
  next.resetSession('bot', 'example.com')
  expect(next.status().profiles.find(row => row.siteHost === 'example.com')?.actors).toEqual([])
  expect(next.status().profiles.find(row => row.siteHost === 'x.com')?.actors).toHaveLength(1)
})

test('new-pane tracking skips local, excluded and unrelated sites', async () => {
  let { policy, settings } = fixture()
  await policy.before('bot', instagram)
  settings.sites = { bot: { 'x.com': false } }
  policy.track('bot', { paneId: '%1' }, 'http://localhost/')
  policy.track('bot', { paneId: '%2' }, 'https://x.com/')
  policy.track('bot', { paneId: '%3' }, 'https://example.com/')
  policy.track('bot', { paneId: '%4' }, 'https://www.instagram.com/')
  expect(policy.status().profiles[0].actors).toEqual([{ paneId: '%4', hosts: ['www.instagram.com'] }])
})

test('pane toggles persist independently and bypass only the chosen pane', async () => {
  let { policy, settings, active, restart } = fixture()
  await policy.before('bot', instagram, undefined, true, { paneId: '%1' })
  active(10 * 60_000)
  settings.panes = { '%1': false, '%2': true }
  expect(parseAutomationSettings({ safety: { panes: settings.panes } }).safety.panes).toEqual(settings.panes)
  let next = restart()
  await next.before('bot', async () => { throw new Error('Disabled pane must not inspect') }, undefined, true, { paneId: '%1' })
  await expect(next.before('bot', instagram, undefined, true, { paneId: '%2' })).rejects.toThrow('session limit')
  expect(() => next.assertAvailable('bot', '%1', 'https://instagram.com/')).not.toThrow()
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

test('resuming a website clears both www aliases without clearing other websites or session usage', async () => {
  let { policy, restart } = fixture()
  for (let host of ['www.instagram.com', 'instagram.com', 'x.com']) await expect(policy.before('bot', async () => ({ url: `https://${host}/`, warning: 'challenge' }))).rejects.toThrow('Automation paused')
  let previous = policy.status().profiles
  policy.resume('bot', { url: 'https://instagram.com/' })
  let restored = restart().status().profiles
  for (let usage of restored.filter(usage => usage.siteHost!.includes('instagram.com'))) {
    expect(usage.warning).toBeUndefined()
    expect(usage.warningAt).toBeUndefined()
    expect(usage.startedAt).toBe(previous.find(item => item.siteHost === usage.siteHost)!.startedAt)
  }
  expect(restored.find(usage => usage.siteHost === 'x.com')!.warning).toBe('challenge')
})

test('hitting the session limit publishes the cooldown without extending its deadline', async () => {
  let { policy, active, changes } = fixture()
  await policy.before('bot', instagram)
  active(10 * 60_000)
  let previous = changes()
  expect(() => policy.assertAvailable('bot', undefined, 'https://www.instagram.com/')).toThrow('Open the UI alert or Profile > Bot')
  expect(changes()).toBe(previous + 1)
  expect(policy.status().profiles[0].retryAfter).toBe('2026-10-01T00:30:00.000Z')
})

test('idle websites never raise retroactive limits after exclusions expire and a completed break starts a fresh session', async () => {
  let { policy, settings, advance, restart } = fixture()
  let youtube = async () => ({ url: 'https://studio.youtube.com/' })
  let actor = { paneId: '%11', agentId: '%76' }
  await policy.before('bot', youtube, undefined, true, actor)
  advance(2 * 60_000)
  await policy.before('bot', youtube, undefined, true, actor)
  advance(12 * 60_000)
  settings.sites = { bot: { 'studio.youtube.com': updateAutomationSiteExclusion(undefined, false, 15, Date.parse('2026-10-01T00:14:00Z')) } }
  expect(policy.status().profiles[0].retryAfter).toBeNull()
  let next = restart()
  await next.before('bot', instagram, undefined, true, { paneId: '%36', agentId: '%99' })
  advance(15 * 60_000)
  expect(automationSiteEnabled(settings, 'bot', 'https://studio.youtube.com/', Date.parse('2026-10-01T00:29:00Z'))).toBe(true)
  let usage = next.status().profiles.find(row => row.siteHost === 'studio.youtube.com')!
  expect(usage).toMatchObject({ lastUsed: Date.parse('2026-10-01T00:02:00Z'), actors: [{ ...actor, hosts: ['studio.youtube.com'] }], retryAfter: null })
  await next.before('bot', youtube, undefined, true, actor)
  expect(next.status().profiles.find(row => row.siteHost === 'studio.youtube.com')).toMatchObject({ startedAt: Date.parse('2026-10-01T00:29:00Z'), retryAfter: null })
})

test('slow commands count at most three seconds and idle time survives restarts', async () => {
  let { policy, advance, restart } = fixture()
  await policy.before('bot', instagram)
  advance(10 * 60_000)
  policy.after('bot', '%1', 'https://www.instagram.com/')
  expect(policy.status().profiles[0]).toMatchObject({ activeMs: 3000, retryAfter: null })
  advance(9 * 60_000)
  let next = restart()
  await next.before('bot', instagram)
  expect(next.status().profiles[0]).toMatchObject({ activeMs: 0, retryAfter: null })
})

test('a human session reset persists fresh usage for only that profile and preserves warning pauses', async () => {
  let { policy, active, restart } = fixture()
  await policy.before('bot', instagram)
  await policy.before('other', instagram)
  active(10 * 60_000)
  policy.resetSession('bot')
  let next = restart()
  await next.before('bot', instagram)
  await expect(next.before('other', instagram)).rejects.toThrow('session limit')
  expect(next.status().profiles.find(item => item.profileId === 'bot')).toMatchObject({ startedAt: Date.parse('2026-10-01T00:10:00Z'), retryAfter: null })
  await expect(next.before('bot', async () => ({ url: 'https://instagram.com/', warning: 'account-warning' }))).rejects.toThrow('Automation paused')
  next.resetSession('bot')
  await expect(restart().before('bot', instagram)).rejects.toThrow('Automation paused')
})

test('a reset session starts with the next admitted command after an agent waits', async () => {
  let { policy, advance, active, restart } = fixture()
  let actor = { paneId: '%1', agentId: 'waiting-agent' }
  await policy.before('bot', instagram, undefined, true, actor)
  active(10 * 60_000)
  await expect(policy.before('bot', instagram)).rejects.toThrow('session limit')
  policy.resetSession('bot')
  policy.after('bot', actor.paneId, 'https://www.instagram.com/')
  advance(9 * 60_000)
  let next = restart()
  await next.before('bot', instagram, undefined, true, actor)
  advance(2 * 60_000)
  await expect(next.before('bot', instagram, undefined, true, actor)).resolves.toBeUndefined()
  expect(next.status().profiles[0]).toMatchObject({ startedAt: Date.parse('2026-10-01T00:21:00Z'), retryAfter: null })
})

test('a reset navigation session starts on commit and survives an unused preflight and restart', async () => {
  let { policy, advance, active, restart } = fixture()
  let url = 'https://www.instagram.com/', actor = { paneId: '%1', agentId: 'navigation-agent' }
  await policy.before('bot', instagram, undefined, true, actor)
  active(10 * 60_000)
  policy.resetSession('bot')
  advance(9 * 60_000)
  await policy.before('bot', instagram, url, true, actor, false)
  advance(2 * 60_000)
  let next = restart()
  await next.before('bot', instagram, url, true, actor, false)
  next.complete('bot', actor, url)
  advance(2 * 60_000)
  await expect(next.before('bot', instagram, undefined, true, actor)).resolves.toBeUndefined()
  expect(next.status().profiles[0]).toMatchObject({ startedAt: Date.parse('2026-10-01T00:23:00Z'), retryAfter: null })
})

test('a page change during the delay is checked again before dispatch', async () => {
  let { policy } = fixture()
  await policy.before('bot', instagram)
  let inspected = 0
  await expect(policy.before('bot', async () => ({ url: 'https://www.instagram.com/', ...(++inspected > 1 ? { warning: 'challenge' as const } : {}) }))).rejects.toThrow('challenge')
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

test('navigation from a blank pane counts only toward its destination website', async () => {
  let { policy, active } = fixture()
  await policy.before('bot', async () => ({ url: 'about:blank' }), 'https://instagram.com/')
  active(10 * 60_000)
  await policy.before('bot', async () => ({ url: 'about:blank' }), 'https://youtube.com/')
  await expect(policy.before('bot', async () => ({ url: 'about:blank' }), 'https://instagram.com/')).rejects.toThrow('session limit')
})

test('blank panes and raw CDP navigation cannot avoid session accounting or social pacing', async () => {
  let { policy, active, sleeps } = fixture()
  let target = automationTargetUrl('cdp', { method: 'Page.navigate', params: { url: 'https://instagram.com/' } })
  expect(target).toBe('https://instagram.com/')
  await policy.before('bot', async () => ({ url: 'about:blank' }))
  await policy.before('bot', async () => ({ url: 'about:blank' }), target)
  expect(sleeps).toEqual([])
  await policy.before('bot', async () => ({ url: 'about:blank' }), target)
  expect(sleeps).toEqual([334])
  active(10 * 60_000)
  await policy.before('bot', async () => ({ url: 'about:blank' }))
  await expect(policy.before('bot', async () => ({ url: 'about:blank' }), target)).rejects.toThrow('session limit')
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
  expect(sleeps).toEqual([334])
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
  let { policy, settings, restart, advance, active } = fixture()
  await expect(policy.before('bot', async () => ({ url: 'https://unblock.example.com/', warning: 'challenge' }))).rejects.toThrow('on unblock.example.com')
  settings.sites = { bot: { 'unblock.example.com': false } }
  let next = restart()
  await next.before('bot', async () => ({ url: 'https://unblock.example.com/', warning: 'challenge' }))
  await next.before('bot', async () => ({ url: 'file:///preview.html' }))
  await expect(next.before('other', async () => ({ url: 'https://unblock.example.com/', warning: 'challenge' }))).rejects.toThrow('Automation paused')
  await expect(next.before('bot', async () => ({ url: 'https://example.com/', warning: 'account-warning' }))).rejects.toThrow('on example.com')
  settings.sites.bot['example.com'] = false
  await next.before('bot', instagram)
  active(10 * 60_000)
  await expect(next.before('bot', instagram)).rejects.toThrow('session limit')
  settings.sites.bot['example.com'] = true
  expect(() => next.assertAvailable('bot', undefined, 'https://example.com/')).toThrow('on example.com')
  expect(parseAutomationSettings({ safety: { sites: settings.sites } }).safety.sites).toEqual(settings.sites)
  for (let sites of [{ bot: { 'example.com': 'false' } }, { bot: { 'https://example.com': false } }, { bot: [] }]) expect(() => parseAutomationSettings({ safety: { sites } })).toThrow()
})


test.each([15, 60] as const)('timed exclusions expire after %i minutes across restarts', async duration => {
  let { policy, settings, restart, advance, active } = fixture()
  let start = Date.parse('2026-10-01T00:00:00Z')
  let warning = async () => ({ url: 'https://example.com/', warning: 'challenge' as const })
  await expect(policy.before('bot', warning)).rejects.toThrow('Automation paused')
  settings.sites = { bot: { 'example.com': updateAutomationSiteExclusion(undefined, false, duration, start) } }
  expect(automationWarningEnabled(settings, 'bot', 'EXAMPLE.COM', start)).toBe(false)
  expect(automationWarningEnabled(settings, 'other', 'example.com', start)).toBe(true)
  expect(automationWarningEnabled(settings, 'bot', 'sub.example.com', start)).toBe(true)
  await restart().before('bot', warning)
  advance(duration * 60_000 - 1)
  expect(() => restart().assertAvailable('bot', undefined, 'https://example.com/')).not.toThrow('Automation paused')
  advance(1)
  expect(() => restart().assertAvailable('bot', undefined, 'https://example.com/')).toThrow('Automation paused')
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
  let { settings, policy, advance, active, sleeps, restart } = fixture()
  settings.profileLimits = { bot: { maxSessionMinutes: 2, cooldownMinutes: 3, socialDelayMs: 500 }, other: { maxSessionMinutes: 20, cooldownMinutes: 10, socialDelayMs: 1500 } }
  expect(parseAutomationSettings({ safety: settings }).safety.profileLimits).toEqual(settings.profileLimits)
  expect(automationProfileLimits(settings, 'default')).toEqual({ maxSessionMinutes: 10, cooldownMinutes: 20, socialDelayMs: 3000, simulateMouseMovement: true })
  for (let entry of [{ unknown: 1 }, { maxSessionMinutes: 0 }, { cooldownMinutes: '3' }, { socialDelayMs: 30001 }, false]) expect(() => parseAutomationSettings({ safety: { profileLimits: { bot: entry } } })).toThrow()
  await policy.before('bot', instagram)
  await policy.before('bot', instagram)
  await policy.before('other', instagram)
  await policy.before('other', instagram)
  expect(sleeps).toEqual([334, 334])
  active(2 * 60_000 - 668)
  let next = restart()
  await expect(next.before('bot', instagram)).rejects.toThrow('00:05:00')
  await next.before('other', instagram)
  expect(next.status().profiles.find(item => item.profileId === 'other')!.retryAfter).toBeNull()
  settings.profileLimits.bot.maxSessionMinutes = 4
  expect(() => next.assertAvailable('bot', undefined, 'https://www.instagram.com/')).not.toThrow()
  settings.profileLimits.bot.maxSessionMinutes = 2
  advance(3 * 60_000)
  await next.before('bot', instagram)
})

test('excluded websites skip session limits, pacing, and warnings only in their profile', async () => {
  let { settings, policy, active, sleeps, restart } = fixture()
  await policy.before('bot', instagram)
  await policy.before('other', instagram)
  let before = policy.status().profiles.find(item => item.profileId === 'bot')
  settings.sites = { bot: { 'www.instagram.com': updateAutomationSiteExclusion(undefined, false, undefined) } }
  await policy.before('bot', async () => ({ url: 'https://www.instagram.com/', warning: 'challenge' }))
  expect(sleeps).toEqual([])
  expect(policy.status().profiles.find(item => item.profileId === 'bot')).toEqual(before)
  active(10 * 60_000)
  let next = restart()
  expect(automationSiteEnabled(settings, 'bot', 'https://www.instagram.com/')).toBe(false)
  expect(automationSiteEnabled(settings, 'bot', 'https://instagram.com/')).toBe(true)
  expect(() => next.assertAvailable('bot', undefined, 'https://www.instagram.com/')).not.toThrow()
  await next.before('bot', async () => ({ url: 'https://www.instagram.com/', warning: 'challenge' }))
  await next.before('bot', async () => ({ url: 'about:blank' }), 'https://www.instagram.com/')
  await next.before('bot', async () => ({ url: 'https://www.instagram.com/' }), 'https://x.com/')
  await next.before('bot', async () => ({ url: 'https://x.com/' }))
  await expect(next.before('other', instagram)).rejects.toThrow('session limit')
  delete settings.sites.bot['www.instagram.com']
  await expect(next.before('bot', instagram)).resolves.toBeUndefined()
})

let localResources = [
  'file:///Users/test/review/index.html', 'about:blank', 'data:text/html,hello', 'blob:https://example.com/id',
  'chrome://settings/', 'devtools://devtools/', 'chrome-extension://extension/page.html', undefined, 'not a URL',
  'http://localhost:3000/', 'http://app.localhost/', 'http://LOCALHOST./', 'http://127.0.0.1/', 'http://127.1/',
  'http://2130706433/', 'http://0x7f000001/', 'http://0.0.0.0/', 'http://10.0.0.1/', 'http://172.16.0.1/',
  'http://192.168.1.1/', 'http://169.254.169.254/', 'http://100.64.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
  'http://[fd00::1]/', 'http://[fe80::1]/', 'http://router/', 'http://printer.local/', 'http://service.lan/',
  'http://app.internal/', 'http://router.home.arpa/', 'http://fixture.test/',
]
test.each(localResources)('local and non-website resources bypass safety without recording usage: %s', async url => {
  let { policy, file, settings, advance, active, sleeps, restart } = fixture()
  settings.profiles = { bot: true }
  expect(automationWebsiteHost(url)).toBeUndefined()
  expect(automationSiteEnabled(settings, 'bot', url)).toBe(false)
  await policy.before('local', async () => ({ url: url ?? '', warning: 'challenge' }), undefined, true, { paneId: '%local' })
  expect(policy.status().profiles).toEqual([])
  expect(fs.existsSync(file)).toBe(false)
  await policy.before('bot', instagram)
  active(10 * 60_000)
  let paused = policy.status()
  await restart().before('bot', async () => ({ url: url ?? '', warning: 'challenge' }), undefined, true, { paneId: '%local' })
  expect(() => policy.assertAvailable('bot', '%local', url)).not.toThrow()
  expect(policy.status()).toEqual(paused)
  await policy.before('bot', instagram, url ?? 'about:blank')
  expect(sleeps).toEqual([])
  await expect(policy.before('bot', async () => ({ url: url ?? '' }), 'https://www.instagram.com/')).rejects.toThrow('session limit')
})
test('public website exclusions still apply after hostname normalization', () => {
  let { settings } = fixture()
  settings.sites = { bot: { 'example.com': false } }
  expect(automationWebsiteHost('https://EXAMPLE.COM.:8443/path')).toBe('example.com')
  expect(automationSiteEnabled(settings, 'bot', 'https://EXAMPLE.COM.:8443/path')).toBe(false)
  expect(automationSiteEnabled(settings, 'bot', 'https://sub.example.com/')).toBe(true)
})

test('mouse movement defaults on and can be overridden independently per profile', () => {
  let settings = parseAutomationSettings({ safety: { simulateMouseMovement: true, profileLimits: { bot: { simulateMouseMovement: false } } } }).safety
  expect(automationProfileLimits(settings, 'bot').simulateMouseMovement).toBe(false)
  expect(automationProfileLimits(settings, 'other').simulateMouseMovement).toBe(true)
  expect(() => parseAutomationSettings({ safety: { simulateMouseMovement: 'yes' } })).toThrow()
  expect(() => parseAutomationSettings({ safety: { profileLimits: { bot: { simulateMouseMovement: 1 } } } })).toThrow()
  expect(paceAutomationCommand('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved' } })).toBe(false)
})

test('social delay starts after an animated click completes', async () => {
  let { policy, advance, sleeps, restart } = fixture()
  await policy.before('bot', instagram)
  advance(600)
  policy.after('bot', 'pane', 'https://www.instagram.com/')
  advance(100)
  await restart().before('bot', instagram)
  expect(sleeps).toEqual([234])
})

test('navigation preflights pace each destination hostname and profile without creating website usage', async () => {
  let { policy, file, sleeps } = fixture()
  let blank = async () => ({ url: 'about:blank' })
  await Promise.all([
    policy.before('bot', blank, 'https://www.instagram.com/', true, { paneId: '%1' }, false),
    policy.before('bot', blank, 'https://x.com/', true, { paneId: '%2' }, false),
    policy.before('other', blank, 'https://x.com/', true, { paneId: '%3' }, false),
    policy.before('bot', blank, 'https://www.instagram.com/another-path', true, { paneId: '%4' }, false),
  ])
  expect(sleeps).toEqual([334])
  expect(policy.status().profiles).toEqual([])
  expect(fs.existsSync(file)).toBe(false)
})

test('a navigation preflight creates no session until navigation succeeds', async () => {
  let { policy, file, active } = fixture()
  let actor = { paneId: '%1', agentId: 'research' }
  await policy.before('bot', async () => ({ url: 'about:blank' }), 'https://example.com/', true, actor, false)
  expect(policy.status().profiles).toEqual([])
  expect(fs.existsSync(file)).toBe(false)
  policy.complete('bot', actor, 'https://example.com/')
  expect(policy.status().profiles).toMatchObject([{ siteHost: 'example.com', actors: [{ ...actor, hosts: ['example.com'] }] }])
  active(10 * 60_000)
  await expect(policy.before('bot', instagram, 'https://example.com/', true, { paneId: '%2' }, false)).rejects.toThrow('session limit')
  expect(policy.status().profiles[0].actors).toHaveLength(1)
})

test('legacy profile clocks restart per website while warning pauses survive', async () => {
  let { file, restart } = fixture()
  let startedAt = Date.parse('2026-10-01T00:00:00Z')
  fs.writeFileSync(file, JSON.stringify({ bot: { startedAt, lastUsed: startedAt, actors: [{ paneId: '%1', hosts: ['example.com'] }, { paneId: '%2', hosts: ['x.com'] }] }, unknown: { startedAt, lastUsed: startedAt } }))
  let policy = restart()
  expect(policy.status().profiles).toEqual([])
  fs.writeFileSync(file, JSON.stringify({ bot: { startedAt, lastUsed: startedAt, warning: 'challenge', warningHost: 'example.com', actors: [{ paneId: '%1', hosts: ['example.com'] }, { paneId: '%2', hosts: ['x.com'] }] } }))
  expect(restart().status().profiles).toMatchObject([{ profileId: 'bot', siteHost: 'example.com', warning: 'challenge', actors: [{ paneId: '%1' }] }])
  await policy.before('unknown', instagram)
  expect(policy.status().profiles.find(row => row.profileId === 'unknown')?.siteHost).toBe('www.instagram.com')
})


test('screenshots inspect current policy without spending a social command delay', async () => {
  let { policy, sleeps, active } = fixture()
  await policy.before('bot', instagram)
  expect(paceAutomationCommand('screenshot', {})).toBe(false)
  await policy.before('bot', instagram, undefined, paceAutomationCommand('screenshot', {}))
  expect(sleeps).toEqual([])
  expect(paceAutomationCommand('eval', {})).toBe(true)
  expect(paceAutomationCommand('click', {})).toBe(true)
  active(10 * 60_000)
  await expect(policy.before('bot', instagram, undefined, paceAutomationCommand('screenshot', {}))).rejects.toThrow('session limit')
})


test('only explicit evaluation observations skip command pacing', () => {
  expect(paceAutomationCommand('eval', { observation: true })).toBe(false)
  expect(paceAutomationCommand('eval', { observation: 'true' })).toBe(true)
  expect(paceAutomationCommand('cdp', { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed' }, observation: true })).toBe(true)
})


test('idle gaps stop counting at three seconds, including after a restart', async () => {
  let { policy, advance, restart } = fixture()
  await policy.before('bot', instagram)
  advance(2000)
  await policy.before('bot', instagram)
  expect(policy.status().profiles[0].activeMs).toBe(2000)
  advance(60_000)
  let next = restart()
  await next.before('bot', instagram)
  expect(next.status().profiles[0].activeMs).toBe(5000)
  for (let i = 0; i < 15; i++) { advance(60_000); await next.before('bot', instagram) }
  expect(next.status().profiles[0]).toMatchObject({ activeMs: 50_000, retryAfter: null })
})

test('parallel actions share a three-action burst then normal pacing and a minute cooldown across restarts', async () => {
  let { policy, sleeps, advance, restart } = fixture()
  await Promise.all(Array.from({ length: 5 }, (_, i) => policy.before('bot', instagram, undefined, true, { paneId: `%${i}` })))
  expect(sleeps).toEqual([334, 334, 3000, 3000])
  let next = restart()
  await next.before('bot', instagram)
  expect(sleeps.at(-1)).toBe(3000)
  advance(60_000)
  await next.before('bot', instagram)
  await next.before('bot', instagram)
  await next.before('bot', instagram)
  expect(sleeps.slice(-2)).toEqual([334, 334])
})

test('old idle clocks become active clocks while existing breaks remain in force', async () => {
  let { file, restart, advance } = fixture()
  let startedAt = Date.parse('2026-10-01T00:00:00Z')
  fs.writeFileSync(file, JSON.stringify({ idle: { profileId: 'bot', siteHost: 'example.com', startedAt, lastUsed: startedAt }, paused: { profileId: 'bot', siteHost: 'x.com', startedAt, lastUsed: startedAt, limitReachedAt: startedAt + 600_000 } }))
  advance(11 * 60_000)
  let next = restart()
  await expect(next.before('bot', async () => ({ url: 'https://example.com/' }))).resolves.toBeUndefined()
  await expect(next.before('bot', async () => ({ url: 'https://x.com/' }))).rejects.toThrow('session limit')
})


test('failed retries preserve the persisted active-session break deadline', async () => {
  let { policy, active, advance, file, restart } = fixture()
  await policy.before('bot', instagram)
  active(10 * 60_000)
  await expect(policy.before('bot', instagram)).rejects.toThrow('00:30:00.000Z')
  let saved = fs.readFileSync(file, 'utf8')
  advance(19 * 60_000)
  await expect(restart().before('bot', instagram)).rejects.toThrow('00:30:00.000Z')
  expect(fs.readFileSync(file, 'utf8')).toBe(saved)
})


test('committed navigation preserves the burst allowance across restarts', async () => {
  let { policy, restart, sleeps } = fixture()
  let url = 'https://www.instagram.com/', actor = { paneId: '%1' }
  let blank = async () => ({ url: 'about:blank' })
  for (let i = 0; i < 4; i++) {
    await policy.before('bot', blank, url, true, actor, false)
    policy.complete('bot', actor, url)
    policy = restart()
  }
  expect(sleeps).toEqual([334, 334, 3000])
})


test('two minutes idle renews only that website and profile, including across restarts', async () => {
  let { policy, advance, restart } = fixture()
  let x = async () => ({ url: 'https://x.com/' })
  await policy.before('bot', instagram, undefined, true, { paneId: '%old' })
  await policy.before('bot', x)
  await policy.before('other', instagram)
  advance(119_999)
  let next = restart()
  // These sites remain active while the original website reaches two minutes idle.
  await next.before('bot', x)
  await next.before('other', instagram)
  expect(next.status().profiles.find(row => row.profileId === 'bot' && row.siteHost === 'x.com')?.activeMs).toBe(3000)
  advance(1)
  await next.before('bot', instagram, undefined, true, { paneId: '%new' })
  expect(next.status().profiles.find(row => row.profileId === 'bot' && row.siteHost === 'www.instagram.com')).toMatchObject({ activeMs: 0, startedAt: Date.parse('2026-10-01T00:02:00Z'), actors: [{ paneId: '%new' }], retryAfter: null })
  await next.before('bot', x)
  expect(next.status().profiles.find(row => row.profileId === 'bot' && row.siteHost === 'x.com')?.activeMs).toBeGreaterThan(3000)
  expect(next.status().profiles.find(row => row.profileId === 'other')?.activeMs).toBe(3000)
})

test('an interaction just before two minutes idle keeps the current session', async () => {
  let { policy, advance, restart } = fixture()
  await policy.before('bot', instagram)
  let startedAt = policy.status().profiles[0].startedAt
  advance(119_999)
  let next = restart()
  await next.before('bot', instagram)
  expect(next.status().profiles[0]).toMatchObject({ startedAt, activeMs: 3000 })
})


test('website and job session limits validate and inherit in scope order', () => {
  let settings = parseAutomationSettings({ safety: { profileLimits: { bot: { maxSessionMinutes: 3 } }, siteSessionMinutes: { bot: { 'one.example.com': 5 } }, jobSessionMinutes: { 'research-screenshots': 30 } } }).safety
  expect(automationSessionMinutes(settings, 'bot', 'one.example.com', 'research-screenshots')).toBe(30)
  expect(automationSessionMinutes(settings, 'bot', 'one.example.com')).toBe(5)
  expect(automationSessionMinutes(settings, 'bot', 'two.example.com')).toBe(3)
  expect(automationSessionMinutes(settings, 'other', 'one.example.com')).toBe(10)
  for (let amount of [0, 1441, 1.5, '30', null]) {
    expect(() => parseAutomationSettings({ safety: { jobSessionMinutes: { research: amount } } })).toThrow()
    expect(() => parseAutomationSettings({ safety: { siteSessionMinutes: { bot: { 'one.example.com': amount } } } })).toThrow()
  }
  expect(() => parseAutomationSettings({ safety: { siteSessionMinutes: { bot: { 'https://one.example.com': 30 } } } })).toThrow()
})

test('a job shares its budget across panes while other jobs and websites retain their limits across restarts', async () => {
  let { policy, settings, active, restart } = fixture()
  settings.maxSessionMinutes = 1
  settings.siteSessionMinutes = { bot: { 'one.example.com': 2 } }
  settings.jobSessionMinutes = { research: 4 }
  let page = async () => ({ url: 'https://one.example.com/' })
  let job = { paneId: '%research', agentId: 'research-bot', agentType: 'clawtab', agentData: { jobId: 'research' } }
  await policy.before('bot', page, undefined, false, { paneId: '%ordinary' })
  await policy.before('bot', page, undefined, false, job)
  await policy.before('bot', page, undefined, false, { ...job, paneId: '%reader' })
  expect(policy.status().profiles).toHaveLength(2)
  active(2 * 60_000)
  let next = restart()
  await expect(next.before('bot', page, undefined, false, { paneId: '%ordinary' })).rejects.toThrow('session limit')
  await next.before('bot', page, undefined, false, job)
  active(2 * 60_000)
  await expect(next.before('bot', page, undefined, false, { ...job, paneId: '%reader' })).rejects.toThrow('session limit')
  await next.before('bot', async () => ({ url: 'https://two.example.com/' }), undefined, false, job)
  expect(next.status().profiles.find(row => row.jobId === 'research' && row.siteHost === 'two.example.com')?.activeMs).toBe(0)
  settings.jobSessionMinutes.research = 6
  await next.before('bot', page, undefined, false, job)
  delete settings.jobSessionMinutes.research
  expect(next.status().profiles.some(row => row.jobId === 'research')).toBe(false)
})

test('job-specific budgets preserve shared site pacing and account warning pauses', async () => {
  let { policy, settings, sleeps, restart } = fixture()
  settings.jobSessionMinutes = { first: 30, second: 40 }
  let first = { paneId: '%first', agentType: 'clawtab', agentData: { jobId: 'first' } }
  let second = { paneId: '%second', agentType: 'clawtab', agentData: { jobId: 'second' } }
  await policy.before('bot', instagram, undefined, true, first)
  await policy.before('bot', instagram, undefined, true, second)
  await policy.before('bot', instagram, undefined, true, first)
  await restart().before('bot', instagram, undefined, true, second)
  expect(sleeps).toEqual([334, 334, 3000])
  await expect(policy.before('bot', async () => ({ url: 'https://www.instagram.com/', warning: 'account-warning' as const }), undefined, false, first)).rejects.toThrow('account-warning')
  await expect(policy.before('bot', instagram, undefined, false, second)).rejects.toThrow('account-warning')
})


test('plugin managed sessions ignore elapsed limits while preserving account warnings', async () => {
  let { file, settings, policy, active } = fixture()
  await policy.before('bot', instagram)
  active(settings.maxSessionMinutes * 60_000)
  expect(() => policy.assertAvailable('bot', '%plugin', 'https://www.instagram.com/')).toThrow('session limit')
  let managed = true
  let plugin = createAutomationSafety({ file, settings: () => settings, now: () => Date.parse('2026-10-01T00:00:00Z') + settings.maxSessionMinutes * 60_000, sessionManaged: (profile, pane) => managed && profile === 'bot' && (!pane || pane === '%plugin') })
  let actor = { paneId: '%plugin' }
  await plugin.before('bot', instagram, undefined, false, actor)
  expect(() => plugin.assertAvailable('bot', '%plugin', 'https://www.instagram.com/')).not.toThrow()
  expect(plugin.status().profiles).toEqual([])
  await expect(plugin.before('bot', async () => ({ url: 'https://www.instagram.com/', warning: 'challenge' }), undefined, false, actor)).rejects.toThrow('challenge')
  expect(plugin.status().profiles[0].warning).toBe('challenge')
  managed = false
  expect(() => plugin.assertAvailable('bot', '%plugin', 'https://www.instagram.com/')).toThrow('challenge')
})
