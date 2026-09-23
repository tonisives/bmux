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
