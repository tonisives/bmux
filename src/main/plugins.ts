import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { matchesPluginUrl, parsePluginManifest } from './plugin-manifest'
import type { PluginAction, PluginContext, PluginHook, PluginInfo, PluginManifest, PluginPrompt, PluginRun, PluginSettings } from '../shared/plugins'
import type { VaultInteraction } from './bitwarden'

type Definition = { bundled?: boolean; directory: string; manifest: PluginManifest; error?: string }
type Run = { public: PluginRun; definition: Definition; action: PluginAction; context: PluginContext; parameters: Record<string, unknown>; token: string; interactive: boolean; controller: AbortController; child?: ChildProcess; timer?: ReturnType<typeof setTimeout>; pending?: { prompt: PluginPrompt; resolve: (value: unknown) => void; reject: (error: Error) => void } }
type Options = {
  bundledDirectory?: string; directory: string; cli: string; dataDirectory: string
  settings: () => PluginSettings
  changed: () => void
  context: (target: PluginContext) => PluginContext
  interactive: (context: PluginContext) => boolean
  show: (clientId: string) => void
  browser: (method: string, args: Record<string, unknown>, context: PluginContext, signal: AbortSignal) => Promise<unknown>
  bitwarden?: (context: PluginContext, signal: AbortSignal, interaction: VaultInteraction) => Promise<unknown>
}
let live = (run: Run) => ['queued', 'running'].includes(run.public.status)
let record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}
let shortText = (value: unknown, limit = 4096) => { if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid text'); return value }
let methods: Record<string, PluginAction['capabilities'][number]> = {
  'forms.list': 'browser.forms', 'forms.save': 'browser.forms', 'forms.fill': 'browser.forms', 'forms.delete': 'browser.forms',
  dom: 'browser.read', screenshot: 'browser.read', wait: 'browser.read', eval: 'browser.write', fill: 'browser.write', click: 'browser.write', type: 'browser.write', key: 'browser.write', navigate: 'browser.write', back: 'browser.write', forward: 'browser.write', reload: 'browser.write', cdp: 'browser.cdp',
  'tab.list': 'browser.manage', 'tab.create': 'browser.manage', 'tab.close': 'browser.manage', 'tab.select': 'browser.manage', 'profile.list': 'browser.manage', 'list-sessions': 'browser.manage', 'list-windows': 'browser.manage', 'list-panes': 'browser.manage', 'new-window': 'browser.manage', 'split-window': 'browser.manage', 'select-pane': 'browser.manage', 'select-window': 'browser.manage', 'activate-client': 'browser.manage',
}
export let createPlugins = (options: Options) => {
  let definitions = new Map<string, Definition>(), runs = new Map<string, Run>(), settings = options.settings()
  let discoveryErrors: PluginInfo[] = [], active = 0, closed = false, scanning = false
  let socketDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-plugins-'))
  fs.chmodSync(socketDirectory, 0o700)
  let socketPath = path.join(socketDirectory, 'host.sock')
  let connections = new Set<net.Socket>()
  let list = (): PluginInfo[] => [...definitions.values()].map(({ manifest, error }): PluginInfo => ({ id: manifest.id, name: manifest.name, version: manifest.version, enabled: settings[manifest.id]?.enabled === true, hooks: settings[manifest.id]?.hooks === true, error, actions: manifest.actions.map(({ id, title, description }) => ({ id, title, description })) })).concat(discoveryErrors)
  let publicRuns = () => [...runs.values()].reverse().map(run => ({ ...run.public }))
  let prompt = (clientId: string) => [...runs.values()].find(run => run.context.clientId === clientId && run.pending)?.pending?.prompt
  let kill = (run: Run) => {
    if (!run.child?.pid) return
    let pid = run.child.pid
    try { process.kill(-pid, 'SIGTERM') } catch { /* Process group has exited. */ }
    let timer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* Exited. */ } }, 500)
    timer.unref()
  }
  let finish = (run: Run, status: PluginRun['status'], error?: string) => {
    if (!live(run)) return
    run.public.status = status; run.public.error = error
    run.token = ''; run.parameters = {}; run.controller.abort()
    clearTimeout(run.timer)
    let pending = run.pending; run.pending = undefined
    pending?.reject(new Error('Plugin interaction cancelled'))
    kill(run)
    options.changed()
    pump()
  }
  let cancel = (id: string) => { let run = runs.get(id); if (!run) throw new Error('Run not found'); finish(run, 'cancelled'); return { id } }
  let requestUI = (run: Run, raw: Record<string, unknown>): Promise<unknown> => {
    if (!live(run) || !run.interactive || !run.context.clientId || !options.interactive(run.context)) throw new Error('Interactive client required')
    if (run.pending || prompt(run.context.clientId)) throw new Error('Another plugin prompt is open')
    let kind = raw.kind as PluginPrompt['kind']
    if (!['pick', 'text', 'password', 'confirm'].includes(kind)) throw new Error('Unknown prompt kind')
    let items = kind === 'pick' ? (Array.isArray(raw.items) && raw.items.length <= 1000 ? raw.items.map(rawItem => {
      let item = record(rawItem)
      return { id: shortText(item.id, 256), label: shortText(item.label), description: item.description === undefined ? undefined : shortText(item.description) }
    }) : undefined) : undefined
    if (kind === 'pick' && (!items?.length || new Set(items.map(item => item.id)).size !== items.length)) throw new Error('Picker requires unique items')
    let request: PluginPrompt = { id: randomUUID(), runId: run.public.id, pluginName: run.definition.manifest.name, kind, title: shortText(raw.title), required: raw.required === true, items }
    return new Promise((resolve, reject) => {
      run.pending = { prompt: request, resolve, reject }
      options.changed(); options.show(run.context.clientId!)
    })
  }
  let respond = (clientId: string, args: Record<string, unknown>) => {
    let run = [...runs.values()].find(run => run.pending?.prompt.id === args.id)
    if (!run?.pending || run.context.clientId !== clientId || !options.interactive(run.context)) throw new Error('Plugin prompt is unavailable')
    if (args.cancel === true) { finish(run, 'cancelled'); return null }
    let { prompt: request, resolve } = run.pending, value = args.value
    if (request.kind === 'confirm') { if (typeof value !== 'boolean') throw new Error('Expected a boolean') }
    else {
      shortText(value, 65536)
      if (request.required && !(value as string).length) throw new Error('A value is required')
      if (request.kind === 'pick' && !request.items?.some(item => item.id === value)) throw new Error('Invalid selection')
    }
    run.pending = undefined; resolve(value); options.changed(); return null
  }
  let reconcile = () => {
    for (let run of runs.values()) {
      if (!live(run)) continue
      if (!settings[run.public.pluginId]?.enabled || (run.public.hook && !settings[run.public.pluginId]?.hooks)) { finish(run, 'cancelled'); continue }
      if (run.pending && !options.interactive(run.context)) finish(run, 'cancelled')
    }
  }
  let host = async (request: Record<string, unknown>) => {
    let run = runs.get(String(request.runId))
    if (!run || !live(run) || !run.token || request.token !== run.token) throw new Error('Invalid plugin invocation')
    let method = String(request.method), args = record(request.args ?? {})
      if (method === 'context') {
      if (args.refresh === true) run.context = options.context(run.context)
      return { ...run.context, interactive: run.interactive && options.interactive(run.context), runId: run.public.id, pluginId: run.public.pluginId, actionId: run.public.actionId, parameters: run.parameters }
    }
    if (method === 'progress') {
      if (typeof args.percent !== 'number' || !Number.isFinite(args.percent) || args.percent < 0 || args.percent > 100) throw new Error('Invalid progress')
      run.public.progress = { percent: args.percent, message: shortText(args.message) }; options.changed(); return null
    }
    if (method === 'result') { if (JSON.stringify(args).length > 65536) throw new Error('Result too large'); run.public.result = args; options.changed(); return null }
    if (method === 'ui') { if (!run.action.capabilities.includes('ui')) throw new Error('Capability ui required'); return requestUI(run, args) }
    if (method === 'bitwarden.fill') {
      if (!run.definition.bundled || run.public.pluginId !== 'bmux.bitwarden' || run.public.actionId !== 'fill' || !run.interactive || !run.action.capabilities.includes('ui') || !run.action.capabilities.includes('browser.write') || !options.bitwarden) throw new Error('Bundled Bitwarden action required')
      return options.bitwarden({ ...run.context }, run.controller.signal, {
        ui: args => requestUI(run, args),
        progress: message => { run.public.progress = { percent: 100, message }; options.changed() },
      })
    }
    let capability = methods[method]
    if (!capability || !run.action.capabilities.includes(capability)) throw new Error('Browser capability required or unknown method')
    if (method === 'wait' && args.expression !== undefined && !run.action.capabilities.includes('browser.write')) throw new Error('JavaScript waits require browser.write')
    if (capability !== 'browser.manage' && args.tab !== undefined && args.tab !== run.context.tabId) throw new Error('Invocation is bound to its original tab')
    if (run.public.hook && ['tab.select', 'select-pane', 'select-window', 'activate-client'].includes(method)) throw new Error('Hooks cannot change selection')
    try { return await options.browser(method, args, { ...run.context }, run.controller.signal) }
    catch { throw new Error('Browser operation failed or target document changed') }
  }
  let server = net.createServer(connection => {
    connections.add(connection); connection.on('close', () => connections.delete(connection)); connection.on('error', () => undefined)
    connection.setEncoding('utf8')
    let buffer = '', received = false
    connection.on('data', chunk => {
      if (received) return
      buffer += chunk
      if (buffer.length > 1_048_576) { connection.destroy(); return }
      if (!buffer.includes('\n')) return
      received = true
      void (async () => {
        try { let result = await host(record(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))))); connection.end(JSON.stringify({ ok: true, result }) + '\n') }
        catch (error) { connection.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Plugin host request failed' }) + '\n') }
      })()
    })
  })
  let ready = new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { fs.chmodSync(socketPath, 0o600); resolve() }) })
  void ready.catch(() => undefined)
  let launch = async (run: Run) => {
    try {
      await ready
      for (let parameter of run.action.parameters) {
        let value = run.parameters[parameter.name]
        if (value === undefined && (run.interactive || parameter.required)) {
          value = await requestUI(run, { kind: parameter.kind === 'choice' ? 'pick' : parameter.kind === 'boolean' ? 'confirm' : parameter.kind, title: parameter.title, required: parameter.required, items: parameter.choices?.map(value => ({ id: value, label: value })) })
        }
        if (value !== undefined && (parameter.kind === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 65536 || (parameter.required && !value.length) || (parameter.kind === 'choice' && !parameter.choices?.includes(value)))) throw new Error('Invalid parameter')
        if (parameter.required && value === undefined) throw new Error('Missing required parameter')
        run.parameters[parameter.name] = value
      }
      if (!live(run)) return
      let env: NodeJS.ProcessEnv = { ...process.env, BMUX_DATA_DIR: options.dataDirectory, BMUX_PLUGIN_SOCKET: socketPath, BMUX_PLUGIN_RUN_ID: run.public.id, BMUX_PLUGIN_TOKEN: run.token, BMUX_CLI: options.cli }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.BW_SESSION; delete env.BMUX_VAULT_PASSWORD
      let [command, ...args] = run.action.command
      let executable = command.startsWith('.') ? path.resolve(run.definition.directory, command) : command
      if (run.definition.bundled && command === 'node') { executable = process.execPath; env.ELECTRON_RUN_AS_NODE = '1' }
      let child = spawn(executable, args, { cwd: run.definition.directory, env, detached: true, stdio: 'ignore' })
      run.child = child
      await new Promise<void>(resolve => {
        child.once('error', () => { finish(run, 'failed', 'Could not start plugin command'); resolve() })
        child.once('exit', code => { finish(run, code === 0 ? 'completed' : 'failed', code === 0 ? undefined : 'Plugin command failed'); resolve() })
      })
    } catch { finish(run, 'failed', 'Plugin parameters or startup failed') }
    finally { active--; pump() }
  }
  let pump = () => {
    if (closed) return
    while (active < 4) {
      let run = [...runs.values()].filter(run => run.public.status === 'queued').sort((a, b) => Number(a.public.hook) - Number(b.public.hook))[0]
      if (!run) break
      active++; run.public.status = 'running'
      run.timer = setTimeout(() => finish(run, 'failed', 'Plugin timed out'), run.action.timeout_seconds * 1000)
      void launch(run); options.changed()
    }
  }
  let enqueue = (definition: Definition, action: PluginAction, context: PluginContext, parameters: Record<string, unknown>, hook: boolean, interactive: boolean) => {
    if (closed) throw new Error('Plugin host is closed')
    if (hook) for (let prior of runs.values()) if (prior.public.hook && prior.public.status === 'queued' && prior.public.pluginId === definition.manifest.id && prior.public.actionId === action.id && prior.context.tabId === context.tabId) finish(prior, 'cancelled')
    if ([...runs.values()].filter(run => live(run)).length >= 256) throw new Error('Plugin queue is full')
    for (let [id, run] of runs) if (!live(run) && runs.size >= 200) runs.delete(id)
    let id = randomUUID()
    let run: Run = { public: { id, pluginId: definition.manifest.id, actionId: action.id, title: action.title, hook, status: 'queued' }, definition, action, context, parameters: { ...parameters }, interactive, token: randomBytes(32).toString('hex'), controller: new AbortController() }
    runs.set(id, run); options.changed(); pump(); return { id }
  }
  let runAction = (target: string, context: PluginContext, parameters: Record<string, unknown> = {}, interactive = false) => {
    let [pluginId, actionId, extra] = target.split('/'), definition = definitions.get(pluginId)
    let action = definition?.manifest.actions.find(action => action.id === actionId)
    if (extra || !definition || !action || !settings[pluginId]?.enabled) throw new Error('Plugin action unavailable; check plugin configuration')
    if (Object.keys(parameters).some(key => !action.parameters.some(parameter => parameter.name === key))) throw new Error('Unknown plugin parameter')
    return enqueue(definition, action, options.context(context), parameters, false, interactive)
  }
  let hook = (event: PluginHook['event'], context: PluginContext, onlyPlugin?: string) => {
    for (let definition of definitions.values()) {
      let id = definition.manifest.id
      if (!settings[id]?.enabled || !settings[id]?.hooks || (onlyPlugin && id !== onlyPlugin)) continue
      for (let action of definition.manifest.hooks) {
        if (action.event !== event || (action.profiles && !action.profiles.includes(context.profileId ?? ''))) continue
        if (event !== 'startup' && !action.matches?.some(pattern => matchesPluginUrl(pattern, context.url ?? ''))) continue
        try { enqueue(definition, action, context, {}, true, false) } catch { /* Bound the hook queue without blocking navigation. */ }
      }
    }
  }
  let invalidate = (tabId: string) => {
    for (let run of runs.values()) if (run.context.tabId === tabId && (run.public.hook || run.pending)) finish(run, 'cancelled')
  }
  let reload = () => {
    if (closed || scanning) return
    scanning = true
    let previous = definitions, next = new Map<string, Definition>(), previousSettings = settings
    settings = options.settings(); discoveryErrors = []
    try {
      let entries = [options.bundledDirectory, options.directory].filter((directory): directory is string => !!directory && fs.existsSync(directory)).flatMap(root => fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() || entry.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name)).map(entry => ({ name: entry.name, directory: path.join(root, entry.name), bundled: root === options.bundledDirectory })))
      for (let entry of entries) {
        let directory = entry.directory
        try {
          let manifest = parsePluginManifest(fs.readFileSync(path.join(directory, 'plugin.yaml'), 'utf8'))
          if (next.has(manifest.id)) throw new Error('Duplicate plugin ID')
          next.set(manifest.id, { directory, manifest, bundled: entry.bundled })
        } catch {
          let old = [...previous.values()].find(item => item.directory === directory)
          if (old && !next.has(old.manifest.id)) next.set(old.manifest.id, { ...old, error: 'Invalid manifest update; using previous definition' })
          else discoveryErrors.push({ id: entry.name, name: entry.name, version: '', enabled: false, hooks: false, actions: [], error: 'Invalid or duplicate plugin manifest' })
        }
      }
      definitions = next
      for (let run of runs.values()) if (!next.has(run.public.pluginId)) finish(run, 'cancelled')
      reconcile()
      for (let id of next.keys()) if (settings[id]?.enabled && settings[id]?.hooks && (!previous.has(id) || !previousSettings[id]?.enabled || !previousSettings[id]?.hooks)) hook('startup', {}, id)
    } finally { scanning = false; options.changed() }
  }
  let fingerprint = ''
  let watcher = setInterval(() => {
    try {
      let entries = fs.existsSync(options.directory) ? fs.readdirSync(options.directory).sort() : []
      let next = JSON.stringify(entries.map(entry => { try { let stat = fs.statSync(path.join(options.directory, entry, 'plugin.yaml')); return [entry, stat.mtimeMs, stat.size] } catch { return [entry] } }))
      if (next !== fingerprint) { fingerprint = next; reload() }
    } catch { /* Retry on the next tick after atomic directory edits. */ }
  }, 500)
  watcher.unref()
  let close = () => {
    closed = true; clearInterval(watcher)
    for (let run of runs.values()) finish(run, 'cancelled')
    for (let connection of connections) connection.destroy()
    server.close(() => { fs.rmSync(socketDirectory, { recursive: true, force: true }) })
  }
  reload()
  return { ready, list, runs: publicRuns, prompt, respond, reconcile, run: runAction, cancel, reload, hook, invalidate, close }
}
