import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createConfig } from '../src/main/config'
import { parseBrowserSettings } from '../src/main/browser-config'
import { DEFAULT_BROWSER, matchesUrl, siteSettings } from '../src/shared/browser-tools'
import { createRequestFilters } from '../src/main/request-filters'

test('browser settings enforce exact origins and preserve inherited profile boundaries', () => {
  let settings = parseBrowserSettings({ darkMode: 'system', profiles: { profile_default: { adblock: false, sites: { 'https://example.test': { darkMode: 'dark', adblock: true } } } } })
  expect(siteSettings(settings, 'profile_default', 'https://example.test/login')).toEqual({ adblock: true, darkMode: 'dark' })
  expect(siteSettings(settings, 'profile_default', 'https://example.test.evil/login')).toEqual({ adblock: false, darkMode: 'system' })
  expect(siteSettings(settings, 'profile_bot', 'https://example.test/login')).toEqual({ adblock: true, darkMode: 'system' })
  expect(() => parseBrowserSettings({ profiles: { default: {} } })).toThrow('profile ID')
  expect(() => parseBrowserSettings({ profiles: { profile_default: { sites: { 'https://example.test/': {} } } } })).toThrow('exact origins')
  expect(() => parseBrowserSettings({ adblock: 'false' })).toThrow()
  expect(() => parseBrowserSettings({ userscripts: [{ id: 'x', file: 'script.js', matches: ['*'] }] })).toThrow()
  expect(() => parseBrowserSettings({ unexpected: true })).toThrow()
  expect(matchesUrl('https://example.test/*', 'https://example.test/a')).toBe(true)
  expect(matchesUrl('https://example.test/*', 'https://example.test.evil/a')).toBe(false)
})

test('settings updates retain unrelated edits and reject invalid changes before writing', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-browser-config-')), file = path.join(directory, 'config.yaml')
  fs.writeFileSync(file, '# keep\nkeyboard:\n  prefix: Ctrl+A\nplugins:\n  personal:\n    enabled: true\n')
  let config = createConfig(file, () => undefined)
  try {
    config.update(['browser', 'profiles', 'profile_default', 'sites', 'https://example.test', 'adblock'], false)
    let text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('# keep'); expect(config.keyboard.prefix).toBe('Ctrl+A'); expect(config.plugins.personal.enabled).toBe(true)
    expect(() => config.update(['browser', 'darkMode'], 'invalid')).toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe(text)
    config.update(['browser', 'profiles', 'profile_default', 'sites', 'https://example.test', 'adblock'], undefined)
    expect(siteSettings(config.browser, 'profile_default', 'https://example.test').adblock).toBe(true)
  } finally { config.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('offline filter fallback, custom exceptions, and profile isolation use one request listener', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-filters-'))
  let settings = { ...structuredClone(DEFAULT_BROWSER), autoUpdateFilters: false, rules: ['||ads.example.test^', '@@||allowed.ads.example.test^'] }
  fs.writeFileSync(path.join(directory, 'adblock.bin.gz'), 'invalid cache')
  let filters = createRequestFilters({ resources: path.resolve('resources'), directory, settings: () => settings, changed: () => undefined, context: () => ({ tabId: 'tab', url: 'https://page.example.test/' }) })
  try {
    expect(filters.status().network).toBeGreaterThan(10000)
    expect(filters.match({ url: 'https://ads.example.test/script.js', resourceType: 'script', referrer: 'https://page.example.test/' })).toBe(true)
    expect(filters.match({ url: 'https://allowed.ads.example.test/script.js', resourceType: 'script', referrer: 'https://page.example.test/' })).toBe(false)
    let listener: any, registrations = 0, session = { webRequest: { onBeforeRequest: (next: any) => { listener = next; registrations++ } } }
    filters.attach(session as any, 'profile_default'); filters.attach(session as any, 'profile_default')
    expect(registrations).toBe(1)
    let response: any
    listener({ url: 'https://ads.example.test/script.js?private=hidden', referrer: 'https://page.example.test/', resourceType: 'script', webContentsId: 1 }, (value: any) => response = value)
    expect(response.cancel).toBe(true)
    expect(JSON.stringify(filters.counts('tab'))).not.toContain('private')
    settings.profiles.profile_default = { adblock: false, sites: {} }
    listener({ url: 'https://ads.example.test/script.js', referrer: '', resourceType: 'script', webContentsId: 1 }, (value: any) => response = value)
    expect(response.cancel).not.toBe(true)
  } finally { filters.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
