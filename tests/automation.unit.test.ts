import { afterEach, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAutomationPolicy } from '../src/main/automation-policy'
import { matchingAutomationGroup, parseAutomationSettings } from '../src/shared/automation'

let directories: string[] = []
afterEach(() => { for (let directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
let fixture = () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-automation-test-'))
  directories.push(directory)
  let time = Date.parse('2026-09-23T00:00:00Z')
  let settings = parseAutomationSettings({ groups: { social: { profiles: ['bot'], hosts: ['x.com', 'linkedin.com'], maxConcurrent: 1, hourly: { runs: 2, navigations: 2, activeMinutes: 1 }, daily: { runs: 3 }, requiredPlugins: { 'x.com': 'bmux.x' }, likesPerDay: { 'x.com': 1 } } } })
  let file = path.join(directory, 'ledger.json')
  let policy = createAutomationPolicy({ file, settings: () => settings, now: () => time })
  return { policy, file, settings, advance: (ms: number) => { time += ms }, restart: () => createAutomationPolicy({ file, settings: () => settings, now: () => time }) }
}

test('groups hosts for one profile and validates policy configuration', () => {
  let { settings } = fixture()
  expect(matchingAutomationGroup(settings, 'bot', 'https://www.x.com/home')?.id).toBe('social')
  expect(matchingAutomationGroup(settings, 'personal', 'https://x.com/home')).toBeUndefined()
  expect(() => parseAutomationSettings({ groups: { a: { profiles: ['bot'], hosts: ['x.com'] }, b: { profiles: ['bot'], hosts: ['x.com'] } } })).toThrow('Overlapping')
})

test('requires the configured plugin and serializes a shared group', () => {
  let { policy } = fixture()
  expect(() => policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home' })).toThrow('requires plugin')
  let lease = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  expect(() => policy.acquire({ profileId: 'bot', tabId: 'tab-2', url: 'https://linkedin.com/feed' })).toThrow('busy')
  expect(() => policy.authorize({ profileId: 'bot', tabId: 'tab-2', url: 'https://x.com/home', token: lease.token })).toThrow('lease required')
  policy.release(lease.token)
  expect(policy.acquire({ profileId: 'bot', tabId: 'tab-2', url: 'https://linkedin.com/feed' }).group).toBe('social')
})

test('page lifetime checks retain active leases and expire abandoned ones', () => {
  let { policy, advance } = fixture()
  let lease = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  expect(policy.hasLease(lease.token)).toBe(true)
  advance(4 * 60_000)
  expect(policy.hasLease(lease.token)).toBe(true)
  advance(60_001)
  expect(policy.hasLease(lease.token)).toBe(false)
  expect(policy.status()[0].active).toBe(0)
})

test('persists rolling run and navigation counts, with idle time excluded', () => {
  let { policy, restart, advance } = fixture()
  let first = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  policy.authorize({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', token: first.token, kind: 'navigation' })
  advance(5 * 60_000)
  expect(policy.status()[0].hourly.activeMs).toBe(30_000)
  policy.release(first.token)
  let next = restart()
  let second = next.acquire({ profileId: 'bot', tabId: 'tab-2', url: 'https://x.com/home', pluginId: 'bmux.x' })
  next.authorize({ profileId: 'bot', tabId: 'tab-2', url: 'https://x.com/home', token: second.token, kind: 'navigation' })
  expect(() => next.authorize({ profileId: 'bot', tabId: 'tab-2', url: 'https://x.com/home', token: second.token, kind: 'navigation' })).toThrow('navigation limit')
  next.release(second.token)
  expect(() => next.acquire({ profileId: 'bot', tabId: 'tab-3', url: 'https://x.com/home', pluginId: 'bmux.x' })).toThrow('run limit')
  advance(60 * 60_000)
  expect(next.acquire({ profileId: 'bot', tabId: 'tab-3', url: 'https://x.com/home', pluginId: 'bmux.x' }).group).toBe('social')
})

test('reserves opted-in likes once per rolling day', () => {
  let { policy, advance } = fixture()
  let lease = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  let args = { profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/user/status/123', token: lease.token }
  expect(policy.like(args).remaining).toBe(0)
  expect(() => policy.like(args)).toThrow('daily cap')
  policy.release(lease.token)
  advance(24 * 60 * 60_000 + 1)
  let next = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  expect(policy.like({ ...args, token: next.token }).remaining).toBe(0)
})


test('validates weekly follow overrides between zero and ten', () => {
  for (let cap of [-1, 11, 1.5, '10']) expect(() => parseAutomationSettings({ groups: { social: { profiles: ['bot'], hosts: ['x.com'], followsPerWeek: { 'x.com': cap } } } })).toThrow('follow cap')
  expect(() => parseAutomationSettings({ groups: { social: { profiles: ['bot'], hosts: ['x.com'], followsPerWeek: { 'reddit.com': 1 } } } })).toThrow('follow cap')
})

test('persists ten weekly follow reservations across restarts and day pruning', () => {
  let { policy, restart, advance } = fixture()
  let lease = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  let args = { profileId: 'bot', tabId: 'tab-1', token: lease.token }
  for (let index = 0; index < 10; index++) expect(policy.follow({ ...args, url: `https://x.com/person${index}` }).remaining).toBe(9 - index)
  expect(() => policy.follow({ ...args, url: 'https://x.com/extra' })).toThrow('Weekly follow cap')
  policy.release(lease.token)
  advance(2 * 24 * 60 * 60_000)
  let next = restart()
  let second = next.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  expect(() => next.follow({ ...args, token: second.token, url: 'https://x.com/extra' })).toThrow('Weekly follow cap')
  expect(next.status()[0].weekly.follows['x.com']).toBe(10)
  next.release(second.token)
  advance(5 * 24 * 60 * 60_000)
  let third = next.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  expect(next.follow({ ...args, token: third.token, url: 'https://x.com/person0' }).remaining).toBe(9)
})

test('requires a plugin lease and shares reservations across URL aliases', () => {
  let { policy, settings } = fixture()
  let lease = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://x.com/home', pluginId: 'bmux.x' })
  let args = { profileId: 'bot', tabId: 'tab-1', token: lease.token, url: 'https://x.com/person' }
  expect(() => policy.follow({ ...args, token: 'missing' })).toThrow('lease required')
  expect(() => policy.follow({ ...args, tabId: 'tab-2' })).toThrow('lease required')
  expect(() => policy.follow({ ...args, url: 'https://reddit.com/user/person' })).toThrow('site plugin')
  expect(() => policy.follow({ ...args, url: 'http://x.com/person' })).toThrow('HTTPS')
  expect(policy.follow(args).remaining).toBe(9)
  expect(() => policy.follow({ ...args, url: 'https://www.x.com/Person/?ref=test' })).toThrow('already reserved')
  settings.groups.social.followsPerWeek['x.com'] = 1
  expect(() => policy.follow({ ...args, url: 'https://x.com/another' })).toThrow('Weekly follow cap')
  settings.groups.social.followsPerWeek['linkedin.com'] = 0
  expect(() => policy.follow({ ...args, url: 'https://linkedin.com/in/person' })).toThrow('Weekly follow cap')
  delete settings.groups.social.followsPerWeek['linkedin.com']
  expect(policy.follow({ ...args, url: 'https://linkedin.com/in/person' }).remaining).toBe(9)
  expect(policy.status()[0].weekly.follows).toEqual({ 'x.com': 1, 'linkedin.com': 1 })
  policy.release(lease.token)
  let noPlugin = policy.acquire({ profileId: 'bot', tabId: 'tab-1', url: 'https://linkedin.com/in/person' })
  expect(() => policy.follow({ ...args, token: noPlugin.token, url: 'https://linkedin.com/in/person' })).toThrow('site plugin')
})
