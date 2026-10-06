import { afterEach, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { automationWarningScript, createAutomationSafety } from '../src/main/automation-safety'
import { automationTargetUrl, DEFAULT_AUTOMATION, isSocialUrl, paceAutomationCommand, parseAutomationSettings } from '../src/shared/automation'

let directories: string[] = []
afterEach(() => { for (let directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
let fixture = () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-safety-test-'))
  directories.push(directory)
  let time = Date.parse('2026-10-01T00:00:00Z'), settings = { ...DEFAULT_AUTOMATION.safety }, sleeps: number[] = []
  let file = path.join(directory, 'usage.json')
  let create = () => createAutomationSafety({ file, settings: () => settings, now: () => time, sleep: async ms => { sleeps.push(ms); time += ms } })
  return { policy: create(), file, settings, sleeps, advance: (ms: number) => { time += ms }, restart: create }
}
let instagram = async () => ({ url: 'https://www.instagram.com/' })

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
