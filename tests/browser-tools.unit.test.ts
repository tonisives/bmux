import { test, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as vaultModule from '../src/main/bitwarden-cli'
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

test('Bitwarden origin filtering excludes different schemes, ports, subdomains, and never-match entries', () => {
  let item = (uri: string, match = 0) => ({ id: 'fixture', type: 1, login: { password: '', uris: [{ uri, match }] } })
  expect(vaultModule.sameOrigin(item('https://example.test/login'), 'https://example.test')).toBe(true)
  for (let uri of ['http://example.test', 'https://example.test:8443', 'https://sub.example.test', 'https://example.test.evil', 'invalid']) expect(vaultModule.sameOrigin(item(uri), 'https://example.test')).toBe(false)
  expect(vaultModule.sameOrigin(item('https://example.test', 5), 'https://example.test')).toBe(false)
})

test('Bitwarden uses private environment input, noninteractive commands, and sanitized failures', async () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-vault-cli-')), executable = path.join(directory, 'bw-fixture')
  fs.writeFileSync(executable, `#!${process.execPath}
let args = process.argv.slice(2), session = Buffer.alloc(64, 7).toString('base64');
if (['BW_RAW','BW_RESPONSE','BW_PRETTY','BW_QUIET','BW_CLEANEXIT'].some(key => process.env[key])) process.exit(2);
if (!args.includes('--nointeraction') || args.includes('fixture-master') || args.includes('fixture-session') || process.env.BMUX_PLUGIN_TOKEN) process.exit(2);
if (args[0] === 'status') process.stdout.write(JSON.stringify({ status: process.env.BW_SESSION ? 'unlocked' : 'locked' }));
else if (args[0] === 'unlock') { if (process.env.BMUX_VAULT_PASSWORD !== 'fixture-master' || !args.includes('--passwordenv')) process.exit(2); process.stdout.write(session); }
else if (args[0] === 'list') { if (process.env.BW_SESSION !== session) { process.stderr.write('private-failure'); process.exit(2) }; process.stdout.write(JSON.stringify([{type:1,id:'fixture',login:{password:'fixture-secret',uris:[{uri:'https://example.test/login'}]}}])); }
`, { mode: 0o700 })
  vi.stubEnv('BW_SESSION', ''); vi.stubEnv('BMUX_PLUGIN_TOKEN', 'invocation-private'); vi.stubEnv('BITWARDENCLI_APPDATA_DIR', directory)
  for (let key of ['BW_RAW', 'BW_RESPONSE', 'BW_PRETTY', 'BW_QUIET', 'BW_CLEANEXIT']) vi.stubEnv(key, 'true')
  let vault = vaultModule.createVault({ executable })
  try {
    expect((await vault.status()).status).toBe('locked')
    await expect(vault.logins('https://example.test')).rejects.toThrow('Bitwarden CLI request failed')
    await vault.unlock('fixture-master')
    expect((await vault.status()).status).toBe('unlocked')
    expect((await vault.logins('https://example.test')).map((item: any) => item.id)).toEqual(['fixture'])
    expect(await vault.logins('https://other.test')).toEqual([])
  } finally { vault.close(); vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }) }
})
