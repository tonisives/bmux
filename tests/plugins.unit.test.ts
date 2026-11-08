import { afterEach, describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { stringify } from 'yaml'
import { createPlugins } from '../src/main/plugins'
import { parsePluginManifest, matchesPluginUrl } from '../src/main/plugin-manifest'
import { pluginRangeValue } from '../src/shared/plugin-range'
import { parseConfig } from '../src/main/config'
import type { PluginSettings, PluginContext } from '../src/shared/plugins'

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (let dispose of cleanup.splice(0)) await dispose() })
let fixture = (script: string, overrides: Record<string, unknown> = {}, decisions?: (method: 'usage' | 'create' | 'memory', args: Record<string, unknown>) => Promise<unknown>, prepare?: (context: PluginContext, title: string, signal: AbortSignal) => Promise<PluginContext>, automation?: Parameters<typeof createPlugins>[0]['automation']) => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-plugin-test-'))
  let folder = path.join(directory, 'plugins', 'test')
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'run.mjs'), script)
  let action = { id: 'run', title: 'Test script', command: [process.execPath, './run.mjs'], capabilities: ['browser.read'], ...overrides }
  let manifest = { schema_version: 1, id: 'test', name: 'Test', version: '1', actions: [action] }
  fs.writeFileSync(path.join(folder, 'plugin.yaml'), stringify(manifest))
  let settings: PluginSettings = { test: { enabled: true, hooks: false } }
  let browser = vi.fn(async () => ({ content: 'fixture' })), changed = vi.fn(), context: PluginContext = { paneId: 'original', documentId: 'document-1', url: 'https://example.test/', clientId: 'client' }
  let finished = vi.fn()
  let plugins = createPlugins({ finished, bundledDirectory: path.join(directory, 'bundled'), directory: path.join(directory, 'plugins'), cli: path.resolve('bin/bmux.mjs'), dataDirectory: directory, decisions, prepare, automation, settings: () => settings, context: target => ({ ...context, ...target }), changed, interactive: () => true, show: vi.fn(), browser })
  cleanup.push(async () => { plugins.close(); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
  let writeManifest = (value: unknown) => fs.writeFileSync(path.join(folder, 'plugin.yaml'), typeof value === 'string' ? value : stringify(value))
  return { directory, plugins, browser, finished, context, manifest, writeManifest, settings: (next: PluginSettings) => { settings = next; plugins.reload() } }
}
let hostScript = `import { execFileSync } from 'node:child_process';
let host = (method, args = {}) => JSON.parse(execFileSync(process.execPath, [process.env.BMUX_CLI,'plugin','host',method,'--stdin'], { input: JSON.stringify(args), encoding:'utf8', stdio:['pipe','pipe','pipe'] })).result;
`
let done = async (plugins: ReturnType<typeof createPlugins>, id: string) => {
  await vi.waitFor(() => expect(plugins.runs().find(run => run.id === id)?.status).not.toMatch(/queued|running/), { timeout: 8000 })
  return plugins.runs().find(run => run.id === id)!
}
describe('plugin definitions', () => {
  test('plugin pacing is an explicit action setting and is passed with a unique run owner', async () => {
    let { plugins, browser, finished, manifest } = fixture(hostScript + "host('dom'); host('result', {done:true});", { pacing: 'plugin' })
    expect(parsePluginManifest(stringify(manifest)).actions[0].pacing).toBe('plugin')
    for (let pacing of [true, 'fast', 0]) expect(() => parsePluginManifest(stringify({ ...manifest, actions: [{ ...manifest.actions[0], pacing }] }))).toThrow('pacing must be plugin')
    let run = plugins.run('test/run', { paneId: 'original' })
    expect((await done(plugins, run.id)).status).toBe('completed')
    expect(finished).toHaveBeenCalledExactlyOnceWith(run.id)
    expect(browser).toHaveBeenCalledWith('dom', expect.any(Object), expect.objectContaining({ pacing: 'plugin', runId: run.id }), expect.any(AbortSignal))
  })
  test('binds follow reservations to the invocation profile, pane and lease', async () => {
    let automation = { acquire: vi.fn(() => ({ token: 'private-lease', group: 'social' })), release: vi.fn(), follow: vi.fn(() => ({ reserved: true, remaining: 9 })), like: vi.fn(), authorize: vi.fn(), status: vi.fn() }
    let { plugins, context } = fixture(hostScript + "host('automation.acquire', {url:'https://x.com/person'}); host('result', host('automation.follow', {url:'https://x.com/person',profileId:'other',tabId:'other',token:'other'}));", {}, undefined, undefined, automation)
    context.profileId = 'bot'
    let run = plugins.run('test/run', { paneId: 'original' })
    let result = await done(plugins, run.id)
    expect(result.status).toBe('completed')
    expect(result.result).toEqual({ reserved: true, remaining: 9 })
    expect(automation.follow).toHaveBeenCalledExactlyOnceWith({ profileId: 'bot', tabId: 'original', url: 'https://x.com/person', token: 'private-lease' })
    expect(automation.release).toHaveBeenCalledWith('private-lease')
  })
  test('keeps social plugins optional and independently installable', () => {
    for (let [id, site] of [['bmux.x', 'x'], ['bmux.linkedin', 'linkedin'], ['bmux.reddit', undefined]] as const) {
      let folder = path.resolve('optional-plugins', id)
      let manifest = parsePluginManifest(fs.readFileSync(path.join(folder, 'plugin.yaml'), 'utf8'))
      expect(fs.existsSync(path.resolve('bundled-plugins', id))).toBe(false)
      expect(manifest.id).toBe(id)
      expect(manifest.actions[0].command).toEqual(site ? ['node', './browse.mjs', site] : ['node', './browse.mjs'])
      expect(fs.existsSync(path.join(folder, 'browse.mjs'))).toBe(true)
      expect(manifest.actions.find(action => action.id === 'follow')?.command).toEqual(['node', './follow.mjs', site ?? 'reddit'])
      expect(fs.existsSync(path.join(folder, 'follow.mjs'))).toBe(true)
    }
  })
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
  test('validates action feature groups and publishes them to the plugin view', () => {
    let { manifest, plugins, writeManifest } = fixture('', { group: '  Browsing  ' })
    expect(parsePluginManifest(stringify(manifest)).actions[0].group).toBe('Browsing')
    expect(plugins.list()[0].actions[0].group).toBe('Browsing')
    for (let group of ['', '   ', false, ['Browsing']]) {
      expect(() => parsePluginManifest(stringify({ ...manifest, actions: [{ ...manifest.actions[0], group }] }))).toThrow()
    }
    writeManifest({ ...manifest, actions: [{ ...manifest.actions[0], group: undefined }] }); plugins.reload()
    expect(plugins.list()[0].actions[0]).not.toHaveProperty('group')
  })
  test('publishes plugin origin for built-in and custom groups, including invalid manifests', () => {
    let { directory, manifest, plugins } = fixture('')
    let bundled = path.join(directory, 'bundled', 'builtin')
    fs.mkdirSync(bundled, { recursive: true })
    fs.writeFileSync(path.join(bundled, 'plugin.yaml'), stringify({ ...manifest, id: 'builtin' }))
    plugins.reload()
    expect(plugins.list().find(plugin => plugin.id === 'builtin')).toMatchObject({ bundled: true })
    expect(plugins.list().find(plugin => plugin.id === 'test')).toMatchObject({ bundled: false })
    let invalid = path.join(directory, 'bundled', 'invalid')
    fs.mkdirSync(invalid)
    fs.writeFileSync(path.join(invalid, 'plugin.yaml'), 'invalid: [')
    plugins.reload()
    expect(plugins.list().find(plugin => plugin.id === 'invalid')).toMatchObject({ bundled: true, error: 'Invalid or duplicate plugin manifest' })
  })
  test('validates and publishes declarative proxy providers', () => {
    let { manifest, plugins, writeManifest } = fixture('')
    let provider = { id: 'service', title: 'Proxy service', help: 'Use service credentials.', authenticated: true, regions: [{ group: 'Asia Pacific', label: 'Singapore', protocol: 'https', host: 'sg.proxy.example', port: 89 }] }
    writeManifest({ ...manifest, proxy_providers: [provider] }); plugins.reload()
    expect(plugins.list()[0].proxyProviders).toEqual([provider])
    expect(() => parsePluginManifest(stringify({ ...manifest, proxy_providers: [{ ...provider, regions: [{ ...provider.regions[0], protocol: 'invalid' }] }] }))).toThrow()
    expect(() => parsePluginManifest(stringify({ ...manifest, proxy_providers: [{ ...provider, regions: [provider.regions[0], provider.regions[0]] }] }))).toThrow()
  })
  test('publishes bookmark controls and confines scripts to their plugin directory', () => {
    let { manifest, plugins, directory, writeManifest, settings } = fixture('')
    let bookmark = { matches: ['https://example.test/*'], script: './page.js', controls: [{ name: 'minimum', title: 'Minimum', kind: 'number', default: 2, min: 0, step: 1 }] }
    let file = path.join(directory, 'plugins/test/page.js')
    fs.writeFileSync(file, '() => () => {}')
    writeManifest({ ...manifest, bookmark }); plugins.reload()
    expect(plugins.list()[0].bookmark).toEqual(bookmark)
    expect(plugins.bookmarks()[0].source).toBe('() => () => {}')
    settings({ test: { enabled: false, hooks: false } })
    expect(plugins.bookmarks()[0]).toMatchObject({ source: '', error: 'Plugin disabled' })
    settings({ test: { enabled: true, hooks: false } })
    fs.unlinkSync(file); fs.writeFileSync(path.join(directory, 'outside.js'), 'outside')
    fs.symlinkSync(path.join(directory, 'outside.js'), file)
    expect(plugins.bookmarks()[0]).toMatchObject({ source: '', error: 'Bookmark script unavailable' })
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
    fs.symlinkSync(path.join(directory, 'source'), path.join(directory, 'plugins/test'), process.platform === 'win32' ? 'junction' : 'dir')
    plugins.reload(); expect(plugins.list()[0].id).toBe('test')
  })
})
test('executes real scripts with pinned context and only explicit output', async () => {
  let { plugins, browser, context } = fixture(hostScript + `console.log('PRIVATE_STDOUT'); console.error('PRIVATE_STDERR'); let context = host('context'); host('dom'); host('result', { pane: context.paneId });`)
  let { id } = plugins.run('test/run', context)
  expect((await done(plugins, id)).result).toEqual({ pane: 'original' })
  expect(browser).toHaveBeenCalledWith('dom', {}, { ...context, runId: id, agentId: 'plugin:test', agentName: 'Test', agentPurpose: 'Test script', agentContext: 'test', agentData: { runId: id, action: 'run' } }, expect.any(AbortSignal))
  expect(JSON.stringify(plugins.runs())).not.toContain('PRIVATE')
})
test('page helper installation requires the explicit CDP capability', async () => {
  let script = hostScript + `host('script.install', { source: 'window.helper = true', worldName: 'test-helper' });`
  let denied = fixture(script)
  expect((await done(denied.plugins, denied.plugins.run('test/run', denied.context).id)).status).toBe('failed')
  expect(denied.browser).not.toHaveBeenCalled()
  let allowed = fixture(script, { capabilities: ['browser.cdp'] })
  expect((await done(allowed.plugins, allowed.plugins.run('test/run', allowed.context).id)).status).toBe('completed')
  expect(allowed.browser).toHaveBeenCalledWith('script.install', expect.objectContaining({ source: 'window.helper = true', worldName: 'test-helper' }), expect.objectContaining(allowed.context), expect.any(AbortSignal))
})
test('rejects missing capabilities, forged invocation tokens and cross-pane requests', async () => {
  let script = hostScript + `let denied = 0; for (let [method,args] of [['eval',{expression:'1'}],['dom',{pane:'other'}],['bitwarden.fill',{}]]) { try { host(method,args) } catch { denied++ } } process.env.BMUX_PLUGIN_TOKEN = 'forged'; try { host('context') } catch { denied++ } process.exit(denied === 4 ? 0 : 1);`
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
test('cancelling a plugin terminates its process and descendants', async () => {
  let { plugins } = fixture(hostScript + `import { spawn } from 'node:child_process'; let child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); host('result', { pid: process.pid, childPid: child.pid }); setInterval(() => {}, 1000);`)
  let { id } = plugins.run('test/run', {})
  let result = () => plugins.runs().find(run => run.id === id)?.result as { pid: number; childPid: number } | undefined
  await vi.waitFor(() => expect(result()).toMatchObject({ pid: expect.any(Number), childPid: expect.any(Number) }), { timeout: 8000 })
  let { pid, childPid } = result()!
  plugins.cancel(id)
  await vi.waitFor(() => { for (let processId of [pid, childPid]) expect(() => process.kill(processId, 0)).toThrow() }, { timeout: 8000 })
  expect(plugins.runs().find(run => run.id === id)?.status).toBe('cancelled')
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

test('overlay is available to manual UI scripts and validates queued controls', async () => {
  let script = hostScript + `host('overlay.update',{title:'Fixture observer',nodes:[],controls:[{id:'start',label:'Start',kind:'button'},{id:'ads',label:'Skip ads',kind:'toggle',value:false}]});
  for(let attempt=0;attempt<200;attempt++){let input=host('overlay.events');if(input.length){host('result',{inputs:input});break}await new Promise(resolve=>setTimeout(resolve,20))}`
  let { plugins, context } = fixture(script, { capabilities: ['ui'] })
  let { id } = plugins.run('test/run', context)
  await vi.waitFor(() => expect(plugins.overlay(context.paneId!)).toMatchObject({ runId: id, ended: false, content: { title: 'Fixture observer' } }))
  plugins.invalidate(context.paneId!)
  expect(plugins.overlay(context.paneId!)).toMatchObject({ runId: id, ended: false })
  expect(() => plugins.overlayInput(id, 'ads', 'true')).toThrow()
  expect(() => plugins.overlayInput(id, 'unknown', undefined)).toThrow()
  expect(plugins.overlayInput(id, 'ads', true)).toEqual({ accepted: true })
  expect((await done(plugins, id)).result).toEqual({ inputs: [{ id: 'ads', value: true }] })
  expect(plugins.overlay(context.paneId!)).toMatchObject({ ended: true })
  expect(() => plugins.overlayInput(id, 'start', undefined)).toThrow()
})
test.each(['completed', 'cancelled', 'failed'] as const)('navigation removes %s overlays and their page links', async status => {
  let script = hostScript + `host('overlay.update',{title:'Finished observer',nodes:[],controls:[]});` + (status === 'completed' ? '' : status === 'failed' ? `throw new Error('Fixture failure')` : `setInterval(()=>{},1000)`)
  let { plugins, context } = fixture(script, { capabilities: ['ui'] })
  let { id } = plugins.run('test/run', context)
  await vi.waitFor(() => expect(plugins.overlay(context.paneId!)).toMatchObject({ runId: id }))
  if (status === 'cancelled') plugins.cancel(id)
  expect((await done(plugins, id)).status).toBe(status)
  plugins.invalidate('another-pane')
  expect(plugins.overlay(context.paneId!)).toMatchObject({ ended: true })
  plugins.invalidate(context.paneId!)
  expect(plugins.overlay(context.paneId!)).toBeUndefined()
  expect(plugins.runs().find(run => run.id === id)).toMatchObject({ status })
  expect(plugins.runs().find(run => run.id === id)).not.toHaveProperty('overlayPaneId')
  expect(() => plugins.restartOverlay(id)).toThrow()
})
test('overlay requires the UI capability', async () => {
  let { plugins, context } = fixture(hostScript + `host('overlay.update',{title:'Denied'});`)
  expect((await done(plugins, plugins.run('test/run', context).id)).status).toBe('failed')
  expect(plugins.overlay(context.paneId!)).toBeUndefined()
})

test('subscription AI host calls require their own capability and keep authentication out of scripts', async () => {
  let decisions = vi.fn(async () => ({ remaining: 10 }))
  let denied = fixture(hostScript + `host('decisions.usage');`)
  expect((await done(denied.plugins, denied.plugins.run('test/run', denied.context).id)).status).toBe('failed')
  let allowed = fixture(hostScript + `host('result',host('decisions.usage'));`, { capabilities: ['ai.decisions'] }, decisions)
  expect((await done(allowed.plugins, allowed.plugins.run('test/run', allowed.context).id)).result).toEqual({ remaining: 10 })
  expect(decisions).toHaveBeenCalledWith('usage', {})
})

test('daily memory host calls require the AI capability and forward bounded data', async () => {
  let memory = vi.fn(async () => ({ day: '2026-11-05', entries: [] }))
  let script = hostScript + `host('result',host('decisions.memory',{operation:'read',profile:'a'.repeat(64)}));`
  let denied = fixture(script, {}, memory)
  expect((await done(denied.plugins, denied.plugins.run('test/run', denied.context).id)).status).toBe('failed')
  let allowed = fixture(script, { capabilities: ['ai.decisions'] }, memory)
  expect((await done(allowed.plugins, allowed.plugins.run('test/run', allowed.context).id)).result).toEqual({ day: '2026-11-05', entries: [] })
  expect(memory).toHaveBeenCalledWith('memory', { operation: 'read', profile: 'a'.repeat(64) })
})

test('one settings form validates atomically, hides CLI session IDs, and pins launch to the active profile', async () => {
  let prepare = vi.fn(async (context: PluginContext) => ({ ...context, paneId: 'new-pane', documentId: 'new-document', url: 'about:blank' }))
  let { plugins, context } = fixture(hostScript + `let c=host('context',{refresh:true});host('result',{pane:c.paneId,profile:c.profileId,approved:c.launchApproved,url:c.launchUrl,parameters:c.parameters});`, {
    capabilities: ['browser.manage', 'ui'], launch_url: 'https://example.test/feed', launch_label: 'Build feed', parameters: [
      { name: 'seconds', title: 'Duration', kind: 'text', default: '300' },
      { name: 'ads', title: 'Skip ads', kind: 'boolean', default: false },
      { name: 'session', title: 'Session ID', kind: 'text', hidden: true },
    ],
  }, undefined, prepare)
  let { id } = plugins.run('test/run', { ...context, profileId: 'active-profile' }, {}, true)
  await vi.waitFor(() => expect(plugins.prompt('client')?.kind).toBe('form'))
  let prompt = plugins.prompt('client')!
  expect(prompt.launchLabel).toBe('Build feed')
  expect(prompt.fields?.map(field => field.name)).toEqual(['seconds', 'ads'])
  expect(prompt.values).toEqual({ seconds: '300', ads: false })
  expect(prepare).not.toHaveBeenCalled()
  expect(() => plugins.respond('client', { id: prompt.id, destination: 'window', value: { ads: 'yes' } })).toThrow()
  expect(() => plugins.respond('client', { id: prompt.id, destination: 'window', value: { session: 'forged' } })).toThrow()
  expect(plugins.prompt('client')?.id).toBe(prompt.id)
  expect(() => plugins.respond('client', { id: prompt.id, value: { seconds: '5', ads: false } })).toThrow('Choose Current pane or New window')
  expect(prepare).not.toHaveBeenCalled()
  plugins.respond('client', { id: prompt.id, destination: 'window', value: { seconds: '5', ads: false } })
  expect((await done(plugins, id)).result).toEqual({ pane: 'new-pane', profile: 'active-profile', approved: true, url: 'https://example.test/feed', parameters: { seconds: '5', ads: false } })
  expect(prepare).toHaveBeenCalledOnce()
})
test('cancelled settings never create a window and explicit CLI parameters never trigger UI launch', async () => {
  let prepare = vi.fn(async (context: PluginContext) => context)
  let { plugins, context } = fixture(hostScript + `host('result',{approved:host('context').launchApproved === true});`, { capabilities: ['browser.manage'], launch_url: 'https://example.test/', parameters: [{ name: 'session', title: 'Session ID', kind: 'text', hidden: true }] }, undefined, prepare)
  let { id } = plugins.run('test/run', context, {}, true)
  await vi.waitFor(() => expect(plugins.prompt('client')).toBeTruthy())
  plugins.respond('client', { id: plugins.prompt('client')!.id, cancel: true })
  expect((await done(plugins, id)).status).toBe('cancelled')
  expect((await done(plugins, plugins.run('test/run', context, { session: 'shared-cli-session' }).id)).result).toEqual({ approved: false })
  expect(prepare).not.toHaveBeenCalled()
})
test('launch URLs and parameter defaults are validated before scripts can run', () => {
  let { manifest } = fixture('')
  let parse = (extra: Record<string, unknown>) => parsePluginManifest(stringify({ ...manifest, actions: [{ ...manifest.actions[0], ...extra }] }))
  expect(() => parse({ launch_url: 'file:///private/tmp/test', capabilities: ['browser.manage'] })).toThrow()
  expect(() => parse({ launch_url: 'https://example.test/' })).toThrow()
  expect(() => parse({ parameters: [{ name: 'ads', title: 'Ads', kind: 'boolean', default: 'false' }] })).toThrow()
  expect(() => parse({ parameters: [{ name: 'secret', title: 'Secret', kind: 'password', default: 'private' }] })).toThrow()
})

test('Restart retains the settings approved in the combined form', async () => {
  let { plugins, context } = fixture(hostScript + `host('overlay.update',{title:'Fixture',nodes:[],controls:[]});host('result',{parameters:host('context').parameters});`, { capabilities: ['ui'], parameters: [
    { name: 'seconds', title: 'Duration', kind: 'text' }, { name: 'ads', title: 'Skip ads', kind: 'boolean' },
  ] })
  let { id } = plugins.run('test/run', context, {}, true)
  await vi.waitFor(() => expect(plugins.prompt('client')?.kind).toBe('form'))
  plugins.respond('client', { id: plugins.prompt('client')!.id, value: { seconds: '120', ads: true } })
  expect((await done(plugins, id)).result).toEqual({ parameters: { seconds: '120', ads: true } })
  let restart = plugins.restartOverlay(id)
  expect((await done(plugins, restart.id)).result).toEqual({ parameters: { seconds: '120', ads: true } })
  expect(plugins.prompt('client')).toBeUndefined()
})

test('saved form values are profile scoped, validated, and only read before interactive configuration', async () => {
  let prepare = vi.fn(async (context: PluginContext) => ({ ...context, paneId: 'new-pane' }))
  let { plugins, context } = fixture(hostScript + `host('result',{parameters:host('context').parameters});`, {
    capabilities: ['ui', 'browser.manage'], launch_url: 'https://example.test/',
    configuration_command: [process.execPath, '-e', 'console.log(JSON.stringify({seconds:process.env.BMUX_PLUGIN_PROFILE_ID,ads:false}))'],
    parameters: [{ name: 'seconds', title: 'Duration', kind: 'text', section: 'Session', default: '300' }, { name: 'ads', title: 'Skip ads', kind: 'boolean', advanced: true, section: 'Interactions' }],
    presets: [{ id: 'quick', title: 'Quick browsing', values: { seconds: '300', ads: false } }],
  }, undefined, prepare)
  let { id } = plugins.run('test/run', { ...context, profileId: 'profile-one' }, {}, true)
  await vi.waitFor(() => expect(plugins.prompt('client')?.kind).toBe('form'))
  let prompt = plugins.prompt('client')!
  expect(prompt.savedValues).toEqual({ seconds: 'profile-one', ads: false })
  expect(prompt.values).toEqual({})
  expect(prompt.fields?.[1]).toMatchObject({ advanced: true, section: 'Interactions' })
  expect(prompt.presets?.[0].values).toEqual({ seconds: '300', ads: false })
  expect(prepare).not.toHaveBeenCalled()
  plugins.respond('client', { id: prompt.id, cancel: true })
  expect((await done(plugins, id)).status).toBe('cancelled')
  expect(prepare).not.toHaveBeenCalled()
  let cli = plugins.run('test/run', context, { seconds: '5', ads: true })
  expect((await done(plugins, cli.id)).result).toEqual({ parameters: { seconds: '5', ads: true } })
})
test('invalid saved settings fail before creating a window', async () => {
  let prepare = vi.fn(async (context: PluginContext) => context)
  let { plugins, context } = fixture('', { capabilities: ['browser.manage'], launch_url: 'https://example.test/', configuration_command: [process.execPath, '-e', 'console.log(JSON.stringify({secret:"private-disposable-value"}))'], parameters: [{ name: 'seconds', title: 'Duration', kind: 'text' }] }, undefined, prepare)
  let result = await done(plugins, plugins.run('test/run', context, {}, true).id)
  expect(result.status).toBe('failed')
  expect(JSON.stringify(result)).not.toContain('private-disposable-value')
  expect(prepare).not.toHaveBeenCalled()
})
test('preset metadata cannot set hidden fields, credentials, unknown fields or invalid choices', () => {
  let { manifest } = fixture('')
  let parse = (presets: unknown) => parsePluginManifest(stringify({ ...manifest, actions: [{ ...manifest.actions[0], parameters: [{ name: 'mode', title: 'Mode', kind: 'choice', choices: ['fast'] }, { name: 'session', title: 'Session', kind: 'text', hidden: true }, { name: 'password', title: 'Password', kind: 'password' }], presets }] }))
  expect(parse([{ id: 'fast', title: 'Fast', values: { mode: 'fast' } }]).actions[0].presets?.[0].values).toEqual({ mode: 'fast' })
  for (let values of [{ mode: 'invalid' }, { session: 'hidden' }, { password: 'private' }, { unknown: true }]) expect(() => parse([{ id: 'invalid', title: 'Invalid', values }])).toThrow()
  expect(() => parse([{ id: 'duplicate', title: 'One', values: {} }, { id: 'duplicate', title: 'Two', values: {} }])).toThrow()
})
test('choosing session settings returns to the form and waits for a new start', async () => {
  let { plugins, context } = fixture(hostScript + `host('overlay.update',{title:'Fixture',nodes:[],controls:[]});`, { capabilities: ['ui'], parameters: [{ name: 'seconds', title: 'Duration', kind: 'text' }, { name: 'ads', title: 'Skip ads', kind: 'boolean' }] })
  let id = plugins.run('test/run', { ...context, profileId: 'profile-one' }, { seconds: '5', ads: true }).id
  expect((await done(plugins, id)).status).toBe('completed')
  let next = plugins.configureOverlay(id)
  await vi.waitFor(() => expect(plugins.prompt('client')?.kind).toBe('form'))
  expect(plugins.prompt('client')?.values).toEqual({})
  expect(plugins.runs().find(run => run.id === next.id)?.status).toBe('running')
  plugins.respond('client', { id: plugins.prompt('client')!.id, cancel: true })
  expect((await done(plugins, next.id)).status).toBe('cancelled')
})

test('new-window setup survives source video navigation while document-bound prompts still cancel', async () => {
  let prepare = vi.fn(async (context: PluginContext) => ({ ...context, paneId: 'new-pane', documentId: 'new-document' }))
  let setup = fixture(hostScript + `host('result',{pane:host('context').paneId});`, { capabilities: ['browser.manage'], launch_url: 'https://example.test/', parameters: [{ name: 'seconds', title: 'Duration', kind: 'text' }] }, undefined, prepare)
  let id = setup.plugins.run('test/run', setup.context, {}, true).id
  await vi.waitFor(() => expect(setup.plugins.prompt('client')?.kind).toBe('form'))
  let prompt = setup.plugins.prompt('client')!
  setup.plugins.invalidate('original')
  expect(setup.plugins.prompt('client')?.id).toBe(prompt.id)
  expect(prepare).not.toHaveBeenCalled()
  setup.plugins.respond('client', { id: prompt.id, destination: 'window', value: { seconds: '5' } })
  expect((await done(setup.plugins, id)).result).toEqual({ pane: 'new-pane' })
  let bound = fixture(hostScript + `host('ui',{kind:'text',title:'Document-bound prompt'});`, { capabilities: ['ui'] })
  let original = bound.plugins.run('test/run', bound.context, {}, true).id
  await vi.waitFor(() => expect(bound.plugins.prompt('client')).toBeTruthy())
  bound.plugins.invalidate('original')
  expect((await done(bound.plugins, original)).status).toBe('cancelled')
})

test('form edits save privately before cancellation and reject hidden fields and passwords', async () => {
  let { plugins, context, directory } = fixture('', {
    configuration_command: [process.execPath, '-e', 'console.log(JSON.stringify({name:"Before",ads:false}))'],
    configuration_save_command: [process.execPath, '-e', 'let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>require("fs").writeFileSync("saved.json",JSON.stringify({profile:process.env.BMUX_PLUGIN_PROFILE_ID,token:!!process.env.BMUX_PLUGIN_TOKEN,values:JSON.parse(input)})))'],
    parameters: [{name:'name',title:'Persona',kind:'text',multiline:true},{name:'ads',title:'Skip ads',kind:'boolean'},{name:'session',title:'Session',kind:'text',hidden:true},{name:'password',title:'Password',kind:'password'}],
  })
  let { id } = plugins.run('test/run', {...context,profileId:'profile-save'}, {}, true)
  await vi.waitFor(() => expect(plugins.prompt('client')?.kind).toBe('form'))
  let prompt = plugins.prompt('client')!
  expect(prompt.autosave).toBe(true)
  expect(() => plugins.respond('wrong-client',{id:prompt.id,save:true,value:{name:'Wrong'}})).toThrow()
  for(let value of [{session:'hidden'},{password:'private'},{unknown:'unknown'},{ads:'yes'}]) expect(() => plugins.respond('client',{id:prompt.id,save:true,value})).toThrow()
  await plugins.respond('client',{id:prompt.id,save:true,value:{name:'A developer\nInterested in AI',ads:true}})
  expect(JSON.parse(fs.readFileSync(path.join(directory,'plugins/test/saved.json'),'utf8'))).toEqual({profile:'profile-save',token:false,values:{name:'A developer\nInterested in AI',ads:true}})
  expect(JSON.stringify(plugins.runs())).not.toContain('Interested in AI')
  plugins.respond('client',{id:prompt.id,cancel:true})
  expect((await done(plugins,id)).status).toBe('cancelled')
})

test('configuration save failures preserve the open form and can be retried', async () => {
  let { plugins, context } = fixture('',{configuration_command:[process.execPath,'-e','console.log("{}")'],configuration_save_command:[process.execPath,'-e','process.exit(1)'],parameters:[{name:'one',title:'One',kind:'text'},{name:'two',title:'Two',kind:'text'}]})
  plugins.run('test/run',context,{},true)
  await vi.waitFor(() => expect(plugins.prompt('client')?.kind).toBe('form'))
  let prompt = plugins.prompt('client')!
  await expect(plugins.respond('client',{id:prompt.id,save:true,value:{one:'changed'}})).rejects.toThrow('Could not save plugin settings')
  expect(plugins.prompt('client')?.id).toBe(prompt.id)
})

test('range parameters validate slider bounds, defaults and presets', () => {
  let range = { min: 1, max: 120, step: 1, unit: 's' }
  expect(pluginRangeValue('8-12', range)).toEqual([8, 12])
  expect(pluginRangeValue('10', range)).toEqual([10, 10])
  for (let value of ['0-12', '12-8', '8-121', '8.5-12', '', 'NaN']) expect(() => pluginRangeValue(value, range)).toThrow()
  let manifest = (parameter: Record<string, unknown>, values?: Record<string, unknown>) => stringify({ schema_version: 1, id: 'slider', name: 'Slider', version: '1', actions: [{ id: 'run', title: 'Run', command: ['node', './run.mjs'], parameters: [{ name: 'watch', title: 'Watch', kind: 'text', ...parameter }], ...(values ? { presets: [{ id: 'preset', title: 'Preset', values }] } : {}) }] })
  expect(parsePluginManifest(manifest({ range, default: '8-12' })).actions[0].parameters[0].range).toEqual(range)
  expect(() => parsePluginManifest(manifest({ range, default: '0-12' }))).toThrow()
  expect(() => parsePluginManifest(manifest({ range }, { watch: '15-12' }))).toThrow()
  for (let invalid of [{ ...range, min: 120 }, { ...range, step: 0 }, { ...range, max: Infinity }]) expect(() => parsePluginManifest(manifest({ range: invalid }))).toThrow()
  expect(() => parsePluginManifest(manifest({ kind: 'boolean', range }))).toThrow()
})

test('named configuration switches preserve the form, profile scope and defaults before starting', async () => {
  let prepare = vi.fn(async (context: PluginContext) => context)
  let command = [process.execPath, './configuration.mjs']
  let { plugins, directory, context } = fixture('', {
    capabilities: ['browser.manage'], launch_url: 'https://example.test/',
    configuration_command: command, configuration_save_command: [...command,'save'], configuration_profile_command: [...command,'profile'],
    parameters: [{name:'persona',title:'Persona',kind:'text'}, {name:'watch',title:'Watch',kind:'text',default:'8-12',range:{min:1,max:120,step:1}}],
  }, undefined, prepare)
  fs.writeFileSync(path.join(directory,'plugins/test/configuration.mjs'), `
    if(process.env.BMUX_PLUGIN_CONFIGURATION_VERSION!=='2')throw new Error('Missing version');
    let input='';for await(let chunk of process.stdin)input+=chunk;
    let profile=process.argv[2]==='profile'?JSON.parse(input).id:'default';
    console.log(JSON.stringify({values:{persona:process.env.BMUX_PLUGIN_PROFILE_ID+' '+profile},profiles:{active:profile,items:[{id:'default',name:'Default'},{id:'research',name:'Research'}]}}));
  `)
  let id = plugins.run('test/run',{...context,profileId:'profile-fixture'},{},true).id
  await vi.waitFor(() => expect(plugins.prompt('client')?.kind).toBe('form'))
  let prompt = plugins.prompt('client')!
  expect(prompt.savedValues).toEqual({persona:'profile-fixture default'})
  expect(prompt.values).toEqual({watch:'8-12'})
  await expect(plugins.respond('client',{id:prompt.id,profile:{action:'select',id:'research',extra:'bad'}})).rejects.toThrow('Unknown profile operation')
  await plugins.respond('client',{id:prompt.id,profile:{action:'select',id:'research'}})
  let selected = plugins.prompt('client')!
  expect(selected.id).not.toBe(prompt.id); expect(selected.runId).toBe(id)
  expect(selected.profiles?.active).toBe('research')
  expect(selected.savedValues).toEqual({persona:'profile-fixture research'})
  expect(selected.values).toEqual({watch:'8-12'})
  expect(prepare).not.toHaveBeenCalled()
  expect(() => plugins.respond('client',{id:prompt.id,cancel:true})).toThrow('unavailable')
  plugins.respond('client',{id:selected.id,cancel:true})
  expect((await done(plugins,id)).status).toBe('cancelled')
})


test('different plugins retain separate overlay tabs and a new run replaces only its own plugin', async () => {
  let { directory, plugins, context, manifest, settings } = fixture(hostScript + `host('overlay.update',{title:'First',controls:[]});`, { capabilities: ['ui'] })
  let second = path.join(directory, 'plugins', 'second')
  fs.mkdirSync(second)
  fs.writeFileSync(path.join(second, 'run.mjs'), hostScript + `host('overlay.update',{title:'Second',icon:'search',controls:[]});`)
  fs.writeFileSync(path.join(second, 'plugin.yaml'), stringify({ ...manifest, id: 'second' }))
  settings({ test: { enabled: true, hooks: false }, second: { enabled: true, hooks: false } })
  let first = plugins.run('test/run', context)
  await done(plugins, first.id)
  let other = plugins.run('second/run', context)
  await done(plugins, other.id)
  expect(plugins.overlays(context.paneId!).map(overlay => overlay.runId)).toEqual([other.id, first.id])
  let newer = plugins.run('test/run', context)
  await done(plugins, newer.id)
  expect(plugins.overlays(context.paneId!).map(overlay => overlay.runId)).toEqual([newer.id, other.id])
  expect(plugins.overlays('unrelated-pane')).toEqual([])
})
