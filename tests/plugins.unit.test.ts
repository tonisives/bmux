import { afterEach, describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { stringify } from 'yaml'
import { createPlugins } from '../src/main/plugins'
import { parsePluginManifest, matchesPluginUrl } from '../src/main/plugin-manifest'
import { parseConfig } from '../src/main/config'
import type { PluginSettings, PluginContext } from '../src/shared/plugins'

let cleanup: (() => void)[] = []
afterEach(() => { for (let dispose of cleanup.splice(0)) dispose() })
let fixture = (script: string, overrides: Record<string, unknown> = {}) => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-plugin-test-'))
  let folder = path.join(directory, 'plugins', 'test')
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'run.mjs'), script)
  let action = { id: 'run', title: 'Test script', command: [process.execPath, './run.mjs'], capabilities: ['browser.read'], ...overrides }
  let manifest = { schema_version: 1, id: 'test', name: 'Test', version: '1', actions: [action] }
  fs.writeFileSync(path.join(folder, 'plugin.yaml'), stringify(manifest))
  let settings: PluginSettings = { test: { enabled: true, hooks: false } }
  let browser = vi.fn(async () => ({ content: 'fixture' })), changed = vi.fn(), context: PluginContext = { tabId: 'original', documentId: 'document-1', url: 'https://example.test/', clientId: 'client' }
  let plugins = createPlugins({ directory: path.join(directory, 'plugins'), cli: path.resolve('bin/bmux.mjs'), dataDirectory: directory, settings: () => settings, context: target => ({ ...context, ...target }), changed, interactive: () => true, show: vi.fn(), browser })
  cleanup.push(() => { plugins.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  let writeManifest = (value: unknown) => fs.writeFileSync(path.join(folder, 'plugin.yaml'), typeof value === 'string' ? value : stringify(value))
  return { directory, plugins, browser, context, manifest, writeManifest, settings: (next: PluginSettings) => { settings = next; plugins.reload() } }
}
let hostScript = `import { execFileSync } from 'node:child_process';
let host = (method, args = {}) => JSON.parse(execFileSync(process.env.BMUX_CLI, ['plugin','host',method,'--stdin'], { input: JSON.stringify(args), encoding:'utf8', stdio:['pipe','pipe','pipe'] })).result;
`
let done = async (plugins: ReturnType<typeof createPlugins>, id: string) => {
  await vi.waitFor(() => expect(plugins.runs().find(run => run.id === id)?.status).not.toMatch(/queued|running/), { timeout: 8000 })
  return plugins.runs().find(run => run.id === id)!
}
describe('plugin definitions', () => {
  test('validates capability, parameter, timeout and hook contracts', () => {
    let { manifest } = fixture('')
    expect(parsePluginManifest(stringify(manifest)).actions[0].timeout_seconds).toBe(120)
    expect(() => parsePluginManifest(stringify({ ...manifest, actions: [{ ...manifest.actions[0], capabilities: ['unsafe'] }] }))).toThrow()
    expect(() => parsePluginManifest(stringify({ ...manifest, hooks: [{ ...manifest.actions[0], event: 'page-ready' }] }))).toThrow()
    expect(() => parsePluginManifest(stringify({ ...manifest, actions: [{ ...manifest.actions[0], timeout_seconds: 0 }] }))).toThrow()
    expect(matchesPluginUrl('https://example.test/*', 'https://example.test/path')).toBe(true)
    expect(matchesPluginUrl('https://example.test/*', 'https://example.test.evil/path')).toBe(false)
    expect(matchesPluginUrl('http://127.0.0.1:*/plugin-fixture*', 'http://127.0.0.1:8123/plugin-fixture')).toBe(true)
  })
  test('keeps keyboard bindings valid before a plugin is installed', () => {
    let config = parseConfig('keyboard:\n  shortcuts:\n    Cmd+Shift+L: plugin:experimental.bitwarden/fill\nplugins:\n  experimental.bitwarden:\n    enabled: true\n')
    expect(config.plugins['experimental.bitwarden']).toEqual({ enabled: true, hooks: false })
    expect(() => parseConfig('keyboard: {}\nplugins:\n  x:\n    enabled: yes')).toThrow()
  })
  test('preserves a valid manifest through malformed edits and resolves symlinks', () => {
    let { plugins, directory, writeManifest } = fixture('')
    writeManifest('bad: ['); plugins.reload()
    expect(plugins.list()[0].actions).toHaveLength(1)
    expect(plugins.list()[0].error).toContain('previous')
    fs.renameSync(path.join(directory, 'plugins/test'), path.join(directory, 'source'))
    fs.symlinkSync(path.join(directory, 'source'), path.join(directory, 'plugins/test'))
    plugins.reload(); expect(plugins.list()[0].id).toBe('test')
  })
})
test('executes real scripts with pinned context and only explicit output', async () => {
  let { plugins, browser, context } = fixture(hostScript + `console.log('PRIVATE_STDOUT'); console.error('PRIVATE_STDERR'); let context = host('context'); host('dom'); host('result', { tab: context.tabId });`)
  let { id } = plugins.run('test/run', context)
  expect((await done(plugins, id)).result).toEqual({ tab: 'original' })
  expect(browser).toHaveBeenCalledWith('dom', {}, context, expect.any(AbortSignal))
  expect(JSON.stringify(plugins.runs())).not.toContain('PRIVATE')
})
test('rejects missing capabilities, forged invocation tokens and cross-tab requests', async () => {
  let script = hostScript + `let denied = 0; for (let [method,args] of [['eval',{expression:'1'}],['dom',{tab:'other'}],['bitwarden.fill',{}]]) { try { host(method,args) } catch { denied++ } } process.env.BMUX_PLUGIN_TOKEN = 'forged'; try { host('context') } catch { denied++ } process.exit(denied === 4 ? 0 : 1);`
  let { plugins, context, browser } = fixture(script)
  expect((await done(plugins, plugins.run('test/run', context).id)).status).toBe('completed')
  expect(browser).not.toHaveBeenCalled()
})
test('routes password parameters privately and authenticates UI responses', async () => {
  let { plugins, context } = fixture(hostScript + `let value = host('context').parameters.password; host('result', { received: value === 'disposable-test-value' });`, { parameters: [{ name: 'password', title: 'Password', kind: 'password', required: true }] })
  let { id } = plugins.run('test/run', context, {}, true)
  await vi.waitFor(() => expect(plugins.prompt('client')).toBeTruthy())
  let request = plugins.prompt('client')!
  expect(() => plugins.respond('wrong-client', { id: request.id, value: 'disposable-test-value' })).toThrow()
  plugins.respond('client', { id: request.id, value: 'disposable-test-value' })
  expect((await done(plugins, id)).result).toEqual({ received: true })
  expect(JSON.stringify(plugins.runs())).not.toContain('disposable-test-value')
})
test('limits running processes, prioritizes manual work and cancels on disable', async () => {
  let { plugins, context, settings } = fixture('setInterval(() => {}, 1000)')
  for (let index = 0; index < 6; index++) plugins.run('test/run', context)
  expect(plugins.runs().filter(run => run.status === 'running')).toHaveLength(4)
  expect(plugins.runs().filter(run => run.status === 'queued')).toHaveLength(2)
  settings({ test: { enabled: false, hooks: false } })
  expect(plugins.runs().every(run => run.status === 'cancelled')).toBe(true)
  expect(() => plugins.run('test/run', context)).toThrow()
})
test('reports missing executables and timeouts without raw errors', async () => {
  let missing = fixture('', { command: ['/missing/disposable-plugin-test'] })
  expect((await done(missing.plugins, missing.plugins.run('test/run', {}).id)).error).toBe('Could not start plugin command')
  let slow = fixture('setInterval(() => {}, 1000)', { timeout_seconds: 1 })
  expect((await done(slow.plugins, slow.plugins.run('test/run', {}).id)).error).toBe('Plugin timed out')
})
test('filters hooks and starts startup only on activation, invalidates page hooks', async () => {
  let { plugins, manifest, writeManifest, settings, context } = fixture('setInterval(() => {}, 1000)')
  writeManifest({ ...manifest, hooks: [{ ...manifest.actions[0], id: 'start', event: 'startup' }, { ...manifest.actions[0], id: 'page', event: 'page-ready', matches: ['https://example.test/*'], profiles: ['work'] }] })
  plugins.reload(); expect(plugins.runs()).toHaveLength(0)
  settings({ test: { enabled: true, hooks: true } }); plugins.reload()
  expect(plugins.runs().filter(run => run.actionId === 'start')).toHaveLength(1)
  plugins.hook('page-ready', { ...context, profileId: 'other' }); expect(plugins.runs()).toHaveLength(1)
  plugins.hook('page-ready', { ...context, profileId: 'work' }); expect(plugins.runs()).toHaveLength(2)
  plugins.invalidate('original')
  expect(plugins.runs().find(run => run.actionId === 'page')?.status).toBe('cancelled')
})
