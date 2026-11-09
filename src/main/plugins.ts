import fs from 'node:fs'
import { sharedSocialField } from '../shared/plugins'
import { AgentScrollError } from './agent-scroll'
import { pluginRangeValue } from '../shared/plugin-range'
import { parsePluginOverlay, validatePluginOverlayInput } from '../shared/plugin-overlay'
import type { PluginOverlayContent, PluginOverlayInput } from '../shared/plugin-overlay'
import path from 'node:path'
import net from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { matchesPluginUrl, parsePluginManifest } from './plugin-manifest'
import { isAutomationSafetyError } from './automation-safety'
import { createPluginSocket, listenSocket } from '../../bin/ipc.mjs'
import type { PluginAction, PluginContext, PluginHook, PluginInfo, PluginManifest, PluginParameter, PluginPrompt, PluginRun, PluginSettings, PluginSettingsProfiles } from '../shared/plugins'

type Definition = { bundled?: boolean; directory: string; manifest: PluginManifest; error?: string }
type Run = { summary?: string[]; sharedSettings?: boolean; destination?: 'current' | 'window'; profiles?: PluginSettingsProfiles; saving?: Promise<unknown>; overlay?: PluginOverlayContent; overlayInputs?: PluginOverlayInput[]; restartParameters?: Record<string, unknown>; public: PluginRun; definition: Definition; action: PluginAction; context: PluginContext; parameters: Record<string, unknown>; savedValues?: Record<string, string | boolean>; token: string; automationToken?: string; policyError?: string; interactive: boolean; controller: AbortController; child?: ChildProcess; timer?: ReturnType<typeof setTimeout>; pending?: { prompt: PluginPrompt; resolve: (value: unknown) => void; reject: (error: Error) => void } }
type Options = {
  browseHistory?: (context: PluginContext, method: string, args: Record<string, unknown>) => Promise<unknown>;
  bundledDirectory?: string; directory: string; cli: string; dataDirectory: string
  activity?: (context: PluginContext, method: string) => ((outcome?: 'success' | 'error') => void) | undefined
  decisions?: (method: 'usage' | 'create' | 'memory', args: Record<string, unknown>) => Promise<unknown>
  settings: () => PluginSettings
  overlayChanged?: () => void
  changed: () => void
  context: (target: PluginContext) => PluginContext
  interactive: (context: PluginContext) => boolean
  selected?: (context: PluginContext) => boolean
  prepare?: (context: PluginContext, title: string, signal: AbortSignal, destination?: 'current' | 'window') => Promise<PluginContext>
  show: (clientId: string) => void
  browser: (method: string, args: Record<string, unknown>, context: PluginContext, signal: AbortSignal) => Promise<unknown>
  finished?: (runId: string) => void
  automation?: { acquire: (args: { profileId: string; tabId: string; url: string; pluginId?: string }) => { token: string; group: string }; release: (token: string) => unknown; follow: (args: { profileId: string; tabId: string; url: string; token: string }) => unknown; like: (args: { profileId: string; tabId: string; url: string; token: string }) => unknown; authorize: (args: { profileId: string; tabId: string; url: string; token?: string; kind?: 'activity' | 'navigation'; record?: boolean }) => unknown; status: () => unknown }
}
let live = (run: Run) => ['queued', 'running'].includes(run.public.status)
let record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}
let shortText = (value: unknown, limit = 4096) => { if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid text'); return value }
let validateParameter = (parameter: PluginParameter, value: unknown) => {
  if (value === undefined) { if (parameter.required) throw new Error('Missing required parameter'); return }
  if (parameter.kind === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 65536 || (parameter.required && !value.length) || (parameter.kind === 'choice' && !parameter.choices?.includes(value))) throw new Error('Invalid parameter')
  if (parameter.range) pluginRangeValue(value, parameter.range)
}
let methods: Record<string, PluginAction['capabilities'][number]> = {
  'forms.list': 'browser.forms', 'forms.save': 'browser.forms', 'forms.fill': 'browser.forms', 'forms.delete': 'browser.forms',
  dom: 'browser.read', screenshot: 'browser.read', wait: 'browser.read', eval: 'browser.write', fill: 'browser.write', click: 'browser.write', scroll: 'browser.write', type: 'browser.write', key: 'browser.write', navigate: 'browser.write', back: 'browser.write', forward: 'browser.write', reload: 'browser.write', cdp: 'browser.cdp', 'script.install': 'browser.cdp',
  'profile.list': 'browser.manage', 'list-sessions': 'browser.manage', 'list-windows': 'browser.manage', 'list-panes': 'browser.manage', 'new-window': 'browser.manage', 'split-window': 'browser.manage', 'select-pane': 'browser.manage', 'select-window': 'browser.manage', 'activate-client': 'browser.manage',
}
export let createPlugins = (options: Options) => {
  let definitions = new Map<string, Definition>(), runs = new Map<string, Run>(), settings = options.settings()
  let discoveryErrors: PluginInfo[] = [], active = 0, closed = false, scanning = false
  let { socketPath, directory: socketDirectory } = createPluginSocket()
  let connections = new Set<net.Socket>()
  let list = (): PluginInfo[] => [...definitions.values()].map(({ manifest, error, bundled }): PluginInfo => ({ settingsAction: manifest.actions.find(action => action.configuration_profile_command && action.configuration_save_command)?.id ?? manifest.actions.find(action => action.configuration_save_command)?.id, bundled: !!bundled, id: manifest.id, name: manifest.name, category: manifest.category, description: manifest.description, version: manifest.version, enabled: settings[manifest.id]?.enabled === true, hooks: settings[manifest.id]?.hooks === true, hasHooks: manifest.hooks.length > 0, error, actions: manifest.actions.map(({ id, title, description, group }) => ({ id, title, description, ...(group ? { group } : {}) })), proxyProviders: manifest.proxyProviders, bookmark: manifest.bookmark })).concat(discoveryErrors)
  let publicRuns = () => [...runs.values()].reverse().map(run => ({ ...run.public, ...(run.overlay && run.context.paneId ? { overlayPaneId: run.context.paneId } : {}) }))
  let prompt = (clientId: string) => [...runs.values()].find(run => run.context.clientId === clientId && run.pending)?.pending?.prompt
  let kill = (run: Run) => {
    if (!run.child?.pid) return
    let pid = run.child.pid
    if (process.platform === 'win32') {
      let killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => run.child?.kill())
      return
    }
    try { process.kill(-pid, 'SIGTERM') } catch { /* Process group has exited. */ }
    let timer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* Exited. */ } }, 500)
    timer.unref()
  }
  let finish = (run: Run, status: PluginRun['status'], error?: string) => {
    if (!live(run)) return
    run.public.status = status; run.public.error = status === 'failed' ? run.policyError ?? error : error
    if (run.automationToken) { try { options.automation?.release(run.automationToken) } catch { /* Lease already expired. */ }; run.automationToken = undefined }
    run.token = ''; run.parameters = {}; run.controller.abort()
    options.finished?.(run.public.id)
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
    if (!['pick', 'text', 'password', 'confirm', 'form'].includes(kind)) throw new Error('Unknown prompt kind')
    let items = kind === 'pick' ? (Array.isArray(raw.items) && raw.items.length <= 1000 ? raw.items.map(rawItem => {
      let item = record(rawItem)
      return { id: shortText(item.id, 256), label: shortText(item.label), description: item.description === undefined ? undefined : shortText(item.description) }
    }) : undefined) : undefined
    if (kind === 'pick' && (!items?.length || new Set(items.map(item => item.id)).size !== items.length)) throw new Error('Picker requires unique items')
    let request: PluginPrompt = { id: randomUUID(), runId: run.public.id, pluginName: run.definition.manifest.name, kind, title: shortText(raw.title), required: raw.required === true, items, ...(kind === 'form' ? { sharedSettings: run.sharedSettings, summary: run.summary, fields: run.action.parameters.filter(field => !field.hidden && (!run.sharedSettings || sharedSocialField(field))), autosave: !!run.action.configuration_save_command, savedValues: run.savedValues, profiles: run.profiles, presets: run.action.presets, values: Object.fromEntries(Object.entries(run.parameters).filter(([key]) => run.action.parameters.some(field => field.name === key && !field.hidden))), profileId: run.context.profileId, launchLabel: run.action.launch_label, launch: !!run.action.launch_url } : {}) }
    return new Promise((resolve, reject) => {
      run.pending = { prompt: request, resolve, reject }
      options.changed(); options.show(run.context.clientId!)
    })
  }
  let configuration = (run: Run, commandLine: string[], values?: Record<string, unknown>) => {
    let [command, ...args] = commandLine
    let executable = command.startsWith('.') ? path.resolve(run.definition.directory, command) : command
    let env: NodeJS.ProcessEnv = { ...process.env, BMUX_PLUGIN_PROFILE_ID: run.context.profileId, BMUX_PLUGIN_CONFIGURATION_VERSION: '2', BMUX_DATA_DIR: options.dataDirectory }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.BW_SESSION; delete env.BMUX_VAULT_PASSWORD
    delete env.BMUX_PLUGIN_SOCKET; delete env.BMUX_PLUGIN_TOKEN; delete env.BMUX_PLUGIN_RUN_ID
    if (run.definition.bundled && command === 'node') { executable = process.execPath; env.ELECTRON_RUN_AS_NODE = '1' }
    return new Promise<string>((resolve, reject) => {
      let child = execFile(executable, args, { cwd: run.definition.directory, env, signal: run.controller.signal, timeout: 5000, maxBuffer: 65536, encoding: 'utf8', windowsHide: true }, (error, stdout) => error ? reject(new Error(values ? 'Could not save plugin settings' : 'Could not read plugin settings')) : resolve(stdout))
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(values ? JSON.stringify(values) : undefined)
    })
  }
  let readConfiguration = (run: Run, output: string) => {
    let payload = record(JSON.parse(output)), profiled = !!run.action.configuration_profile_command
    let saved = profiled ? record(payload.values) : payload, values: Record<string, string | boolean> = {}
    for (let [name, value] of Object.entries(saved)) {
      let field = run.action.parameters.find(field => field.name === name && !field.hidden && field.kind !== 'password')
      if (!field) throw new Error('Unknown saved setting')
      validateParameter(field, value); values[name] = value as string | boolean
    }
    if (profiled) {
      if (payload.summary !== undefined && (!Array.isArray(payload.summary) || payload.summary.length > 12)) throw new Error('Invalid configuration summary')
      run.summary = payload.summary === undefined ? undefined : (payload.summary as unknown[]).map(line => shortText(line, 512))
      let profiles = record(payload.profiles)
      let items = (raw: unknown) => {
        if (!Array.isArray(raw) || !raw.length || raw.length > 16) throw new Error('Invalid configuration profiles')
        let entries = raw.map(entry => { let item = record(entry), id = shortText(item.id, 128), name = shortText(item.name, 60); if (!/^[a-zA-Z0-9._-]+$/.test(id) || !name.trim()) throw new Error('Invalid configuration profile'); return { id, name } })
        if (new Set(entries.map(item => item.id)).size !== entries.length || new Set(entries.map(item => item.name)).size !== entries.length) throw new Error('Duplicate configuration profile')
        return entries
      }
      let entries = items(profiles.items), active = shortText(profiles.active, 128)
      if (!entries.some(item => item.id === active)) throw new Error('Unknown configuration profile')
      run.profiles = { active, items: entries, ...(profiles.templates === undefined ? {} : { templates: items(profiles.templates) }) }
    }
    run.savedValues = values
  }
  let changeProfile = async (run: Run, raw: unknown) => {
    let operation = record(raw), request = run.pending!.prompt
    if (request.kind !== 'form' || !run.action.configuration_profile_command || !['create','select','rename','delete'].includes(String(operation.action))) throw new Error('Profile configuration is unavailable')
    if (Object.keys(operation).some(key => !['action','id','name','template'].includes(key))) throw new Error('Unknown profile operation')
    for (let key of ['id','name','template']) if (operation[key] !== undefined) shortText(operation[key], key === 'name' ? 60 : 128)
    await run.saving
    let output = await configuration(run, run.action.configuration_profile_command, operation)
    if (!live(run) || run.pending?.prompt.id !== request.id) throw new Error('Plugin prompt is unavailable')
    readConfiguration(run, output)
    for (let field of request.fields ?? []) {
      delete run.parameters[field.name]
      if (run.savedValues?.[field.name] === undefined && field.default !== undefined) run.parameters[field.name] = field.default
    }
    run.pending.prompt = { ...request, id: randomUUID(), savedValues: run.savedValues, values: Object.fromEntries(Object.entries(run.parameters).filter(([key]) => request.fields?.some(field => field.name === key))), profiles: run.profiles, summary: run.summary }
    options.changed()
    return { updated: true }
  }
  let saveSettings = (run: Run, values: unknown) => {
    let request = run.pending!.prompt, patch = record(values)
    if (request.kind !== 'form' || !run.action.configuration_save_command) throw new Error('Settings saving is unavailable')
    for (let [name, value] of Object.entries(patch)) {
      let field = request.fields?.find(field => field.name === name && !field.hidden && field.kind !== 'password')
      if (!field || value === undefined) throw new Error('Unknown saved setting')
      validateParameter(field, value)
    }
    let save = async () => {
      if (!live(run) || run.pending?.prompt.id !== request.id) throw new Error('Plugin prompt is unavailable')
      await configuration(run, run.action.configuration_save_command!, patch)
      run.savedValues = { ...run.savedValues, ...patch } as Record<string, string | boolean>
      if (run.action.configuration_profile_command && run.action.configuration_command) {
        readConfiguration(run, await configuration(run, run.action.configuration_command))
        if (live(run) && run.pending?.prompt.id === request.id) {
          run.pending.prompt = { ...run.pending.prompt, summary: run.summary }
          options.changed()
        }
      }
      return { saved: true }
    }
    let saving = (run.saving ?? Promise.resolve()).catch(() => undefined).then(save)
    run.saving = saving
    return saving
  }
  let applyAllSettings = async (run: Run, raw: unknown) => {
    if (!run.sharedSettings) throw new Error('Shared settings are unavailable')
    let values = record(raw)
    for (let [name, value] of Object.entries(values)) {
      let field = run.action.parameters.find(field => field.name === name && sharedSocialField(field))
      if (!field) throw new Error('Unknown shared setting')
      validateParameter(field, value)
    }
    await run.saving
    let profile = run.profiles?.items.find(item => item.id === run.profiles?.active)
    let applied = new Set<string>()
    for (let definition of definitions.values()) {
      if (definition.manifest.category !== 'Social Media') continue
      for (let action of definition.manifest.actions) {
        if (!action.configuration_command || !action.configuration_save_command) continue
        let key = JSON.stringify([definition.directory, action.configuration_save_command])
        if (applied.has(key)) continue
        let target: Run = { ...run, definition, action, savedValues: undefined, profiles: undefined }
        let patch = Object.fromEntries(Object.entries(values).filter(([name, value]) => {
          let field = action.parameters.find(field => field.name === name && sharedSocialField(field))
          if (!field) return false
          validateParameter(field, value); return true
        }))
        if (!Object.keys(patch).length) continue
        if (profile && action.configuration_profile_command) {
          readConfiguration(target, await configuration(target, action.configuration_command))
          let match = target.profiles?.items.find(item => item.name === profile.name)
          await configuration(target, action.configuration_profile_command, match ? { action: 'select', id: match.id } : { action: 'create', name: profile.name })
        }
        await configuration(target, action.configuration_save_command, patch)
        applied.add(key)
      }
    }
    return { applied: applied.size }
  }
  let respond = (clientId: string, args: Record<string, unknown>) => {
    let run = [...runs.values()].find(run => run.pending?.prompt.id === args.id)
    if (!run?.pending || run.context.clientId !== clientId || !options.interactive(run.context)) throw new Error('Plugin prompt is unavailable')
    if (args.applyAll === true) return applyAllSettings(run, args.value)
    if (args.profile !== undefined) return changeProfile(run, args.profile)
    if (args.save === true) return saveSettings(run, args.value)
    if (args.cancel === true) { finish(run, 'cancelled'); return null }
    let { prompt: request, resolve } = run.pending, value = args.value
    if (request.kind === 'form') {
      if (run.sharedSettings) throw new Error('Use Apply all to save shared settings')
      if (request.launch) {
        if (args.destination !== 'current' && args.destination !== 'window') throw new Error('Choose Current pane or New window')
        run.destination = args.destination === 'current' ? 'current' : 'window'
      }
      let values = record(value)
      if (Object.keys(values).some(key => !request.fields?.some(field => field.name === key))) throw new Error('Unknown form field')
      for (let field of request.fields ?? []) validateParameter(field, values[field.name])
    } else if (request.kind === 'confirm') { if (typeof value !== 'boolean') throw new Error('Expected a boolean') }
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
      if (run.pending && !(options.selected ?? options.interactive)(run.context)) finish(run, 'cancelled')
    }
  }
  let host = async (request: Record<string, unknown>) => {
    let run = runs.get(String(request.runId))
    if (!run || !live(run) || !run.token || request.token !== run.token) throw new Error('Invalid plugin invocation')
    let method = String(request.method), args = record(request.args ?? {})
    if (method === 'history.status' || method === 'history.record') {
      if (!run.action.capabilities.includes('browser.read') || run.definition.manifest.category !== 'Social Media') throw new Error('Social browsing capability required')
      return options.browseHistory?.({ ...run.context, runId: run.public.id }, method, args)
    }
    let policyCall = <T>(operation: () => T): T => { try { return operation() } catch (error) { run.policyError = error instanceof Error ? error.message : 'Automation policy failed'; throw error } }
      if (method === 'context') {
      if (args.refresh === true) run.context = { ...options.context(run.context), ...(run.context.launchApproved ? { launchApproved: true, launchUrl: run.context.launchUrl } : {}) }
      return { ...run.context, browseRecording: await options.browseHistory?.(run.context, 'history.status', {}), scrolling: options.context(run.context).scrolling, interactive: run.interactive && options.interactive(run.context), runId: run.public.id, pluginId: run.public.pluginId, actionId: run.public.actionId, parameters: run.parameters }
    }
    if (method === 'overlay.update' || method === 'overlay.events') {
      if (!run.action.capabilities.includes('ui') || run.public.hook || !run.context.paneId) throw new Error('Manual ui capability required for overlay')
      if (method === 'overlay.update') { run.overlay = parsePluginOverlay(args); (options.overlayChanged ?? options.changed)(); return { updated: true, copyPayloads: true } }
      return run.overlayInputs?.splice(0) ?? []
    }
    if (method === 'decisions.usage' || method === 'decisions.create' || method === 'decisions.memory') {
      if (!run.action.capabilities.includes('ai.decisions') || run.public.hook || !options.decisions) throw new Error('AI decisions capability unavailable')
      if (method === 'decisions.create' && (JSON.stringify(args).length > 255000 || typeof args.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(args.requestId))) throw new Error('Invalid decision request')
      if (method === 'decisions.memory' && JSON.stringify(args).length > 2048) throw new Error('Invalid feed memory request')
      return options.decisions(method === 'decisions.usage' ? 'usage' : method === 'decisions.memory' ? 'memory' : 'create', args)
    }
    if (method === 'progress') {
      if (typeof args.percent !== 'number' || !Number.isFinite(args.percent) || args.percent < 0 || args.percent > 100) throw new Error('Invalid progress')
      run.public.progress = { percent: args.percent, message: shortText(args.message) }; options.changed(); return null
    }
    if (method === 'result') {
      if (JSON.stringify(args).length > 65536) throw new Error('Result too large')
      if (run.automationToken && run.context.profileId && run.context.paneId && run.context.url) policyCall(() => options.automation?.authorize({ profileId: run.context.profileId!, tabId: run.context.paneId!, url: run.context.url!, token: run.automationToken }))
      run.public.result = args; options.changed(); return null
    }
    if (method === 'automation.acquire') {
      if (!run.context.profileId || !run.context.paneId || run.automationToken) throw new Error('Automation lease unavailable')
      let lease = policyCall(() => options.automation?.acquire({ profileId: run.context.profileId!, tabId: run.context.paneId!, url: shortText(args.url), pluginId: run.public.pluginId }))
      if (!lease) throw new Error('Automation policy unavailable')
      run.automationToken = lease.token
      return { group: lease.group }
    }
    if (method === 'automation.status') return options.automation?.status() ?? []
    if (method === 'automation.like' || method === 'automation.follow') {
      if (!run.context.profileId || !run.context.paneId || !run.automationToken) throw new Error('Automation lease unavailable')
      return policyCall(() => options.automation?.[method === 'automation.follow' ? 'follow' : 'like']({ profileId: run.context.profileId!, tabId: run.context.paneId!, url: shortText(args.url), token: run.automationToken! }))
    }
    if (method === 'ui') { if (!run.action.capabilities.includes('ui')) throw new Error('Capability ui required'); return requestUI(run, args) }
    let capability = methods[method]
    if (!capability || !run.action.capabilities.includes(capability)) throw new Error('Browser capability required or unknown method')
    if (method === 'wait' && args.expression !== undefined && !run.action.capabilities.includes('browser.write')) throw new Error('JavaScript waits require browser.write')
    if (capability !== 'browser.manage' && ((args.pane !== undefined && args.pane !== run.context.paneId) || (args.tab !== undefined && args.tab !== run.context.paneId))) throw new Error('Invocation is bound to its original pane')
    if (run.public.hook && ['select-pane', 'select-window', 'activate-client'].includes(method)) throw new Error('Hooks cannot change selection')
    let url = method === 'navigate' ? String(args.url) : run.context.url
    if (url && run.context.profileId && run.context.paneId) policyCall(() => options.automation?.authorize({ profileId: run.context.profileId!, tabId: run.context.paneId!, url, token: run.automationToken, kind: method === 'navigate' ? 'navigation' : ['click', 'type', 'key'].includes(method) || method === 'cdp' && String(args.method).startsWith('Input.') ? 'activity' : undefined, record: method !== 'navigate' }))
    try { return await options.browser(method, { ...args, _automationLease: run.automationToken }, { ...run.context, runId: run.public.id, pacing: run.action.pacing }, run.controller.signal) }
    catch (error) {
      if (isAutomationSafetyError(error)) { run.policyError = error.message; finish(run, 'failed'); throw error }
      if (error instanceof AgentScrollError) throw error
      throw new Error('Browser operation failed or target document changed')
    }
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
  let ready = listenSocket(server, socketPath)
  void ready.catch(() => undefined)
  let launch = async (run: Run) => {
    let finishActivity: ((outcome?: 'success' | 'error') => void) | undefined
    try {
      finishActivity = options.activity?.(run.context, `plugin:${run.public.pluginId}/${run.public.actionId}`)
      await ready
      let fields = run.action.parameters.filter(field => !field.hidden)
      let form = run.interactive && (run.sharedSettings || fields.length > 1 || !!run.action.launch_url)
      if (form && run.action.configuration_command) {
        let output = await configuration(run, run.action.configuration_command)
        readConfiguration(run, output)
      }
      if (form) {
        for (let field of fields) if (run.parameters[field.name] === undefined && run.savedValues?.[field.name] === undefined && field.default !== undefined) run.parameters[field.name] = field.default
        let values = record(await requestUI(run, { kind: 'form', title: run.action.title }))
        for (let field of fields) delete run.parameters[field.name]
        Object.assign(run.parameters, values)
      }
      for (let parameter of run.action.parameters) {
        let value = run.parameters[parameter.name]
        if (!form && value === undefined && !parameter.hidden && (run.interactive || parameter.required)) {
          value = await requestUI(run, { kind: parameter.kind === 'choice' ? 'pick' : parameter.kind === 'boolean' ? 'confirm' : parameter.kind, title: parameter.title, required: parameter.required, items: parameter.choices?.map(value => ({ id: value, label: value })) })
        }
        validateParameter(parameter, value)
        run.parameters[parameter.name] = value
      }
      run.restartParameters = Object.fromEntries(Object.entries(run.parameters).filter(([key]) => run.action.parameters.find(parameter => parameter.name === key)?.kind !== 'password'))
      if (!live(run)) return
      if (form && run.action.launch_url) {
        if (!options.prepare) throw new Error('Window launch unavailable')
        run.context = { ...await options.prepare(run.context, run.definition.manifest.name, run.controller.signal, run.destination), launchUrl: run.action.launch_url, launchApproved: true }
      }
      if (!live(run)) return
      let env: NodeJS.ProcessEnv = { ...process.env, BMUX_DATA_DIR: options.dataDirectory, BMUX_PLUGIN_SOCKET: socketPath, BMUX_PLUGIN_RUN_ID: run.public.id, BMUX_PLUGIN_TOKEN: run.token, BMUX_CLI: options.cli }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.BW_SESSION; delete env.BMUX_VAULT_PASSWORD
      let [command, ...args] = run.action.command
      let executable = command.startsWith('.') ? path.resolve(run.definition.directory, command) : command
      if (run.definition.bundled && command === 'node') { executable = process.execPath; env.ELECTRON_RUN_AS_NODE = '1' }
      let child = spawn(executable, args, { cwd: run.definition.directory, env, detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' })
      run.child = child
      await new Promise<void>(resolve => {
        child.once('error', () => { finish(run, 'failed', 'Could not start plugin command'); resolve() })
        child.once('exit', code => { finish(run, code === 0 ? 'completed' : 'failed', code === 0 ? undefined : 'Plugin command failed'); resolve() })
      })
    } catch { finish(run, 'failed', 'Plugin parameters or startup failed') }
    finally { finishActivity?.(run.public.status === 'completed' ? 'success' : 'error'); active--; pump() }
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
  let enqueue = (definition: Definition, action: PluginAction, context: PluginContext, parameters: Record<string, unknown>, hook: boolean, interactive: boolean, sharedSettings = false) => {
    if (closed) throw new Error('Plugin host is closed')
    if (hook) for (let prior of runs.values()) if (prior.public.hook && prior.public.status === 'queued' && prior.public.pluginId === definition.manifest.id && prior.public.actionId === action.id && prior.context.paneId === context.paneId) finish(prior, 'cancelled')
    if ([...runs.values()].filter(run => live(run)).length >= 256) throw new Error('Plugin queue is full')
    for (let [id, run] of runs) if (!live(run) && runs.size >= 200) runs.delete(id)
    let id = randomUUID()
    let run: Run = { sharedSettings, public: { id, pluginId: definition.manifest.id, actionId: action.id, title: action.title, hook, status: 'queued' }, definition, action, context: { ...context, agentId: `plugin:${definition.manifest.id}`, agentName: definition.manifest.name, agentPurpose: action.description ?? action.title, agentContext: definition.manifest.id, agentData: { runId: id, action: action.id } }, parameters: { ...parameters }, restartParameters: Object.fromEntries(Object.entries(parameters).filter(([key]) => action.parameters.find(parameter => parameter.name === key)?.kind !== 'password')), interactive, token: randomBytes(32).toString('hex'), controller: new AbortController() }
    runs.set(id, run); options.changed(); pump(); return { id }
  }
  let runAction = (target: string, context: PluginContext, parameters: Record<string, unknown> = {}, interactive = false, sharedSettings = false) => {
    let [pluginId, actionId, extra] = target.split('/'), definition = definitions.get(pluginId)
    let action = definition?.manifest.actions.find(action => action.id === actionId)
    if (extra || !definition || !action || !settings[pluginId]?.enabled) throw new Error('Plugin action unavailable; check plugin configuration')
    if (Object.keys(parameters).some(key => !action.parameters.some(parameter => parameter.name === key))) throw new Error('Unknown plugin parameter')
    if (sharedSettings && (!interactive || definition.manifest.category !== 'Social Media' || !action.configuration_save_command)) throw new Error('Shared social settings unavailable')
    return enqueue(definition, action, options.context(context), parameters, false, interactive, sharedSettings)
  }
  let overlays = (paneId: string) => {
    let seen = new Set<string>()
    return [...runs.values()].reverse().flatMap(run => {
      let pluginId = run.public.pluginId
      if (run.context.paneId !== paneId || !run.overlay || seen.has(pluginId)) return []
      seen.add(pluginId)
      return [{ runId: run.public.id, pluginId, paneId, content: { ...run.overlay, copies: run.overlay.copies?.map(({ id, label }) => ({ id, label })) }, ended: !live(run), error: run.public.error }]
    })
  }
  let overlay = (paneId: string) => overlays(paneId)[0]
  let copyOverlay = (id: string, copyId: string) => {
    let copy = runs.get(id)?.overlay?.copies?.find(copy => copy.id === copyId)
    if (!copy?.text) throw new Error('Payload is unavailable for this post')
    return copy.text
  }
  let overlayInput = (id: string, controlId: string, value: unknown) => {
    let run = runs.get(id), control = run?.overlay?.controls.find(control => control.id === controlId)
    if (!run || !live(run) || !control) throw new Error('Overlay control unavailable')
    validatePluginOverlayInput(control, value)
    let pending = run.overlayInputs ??= []
    if (pending.length >= 32) throw new Error('Wait for the current controls to finish')
    pending.push({ id: controlId, value: value as string | boolean | undefined })
    return { accepted: true }
  }
  let restartOverlay = (id: string) => {
    let run = runs.get(id)
    if (!run?.overlay || live(run) || !run.context.paneId) throw new Error('Stop the current session before restarting')
    let context = options.context(run.context)
    if (context.profileId !== run.context.profileId) throw new Error('The original profile is unavailable')
    return runAction(run.public.pluginId + '/' + run.public.actionId, context, run.restartParameters ?? {}, false)
  }
  let configureOverlay = (id: string) => {
    let run = runs.get(id)
    if (!run?.overlay || live(run)) throw new Error('Stop the current session before choosing settings')
    let context = options.context(run.context)
    if (context.profileId !== run.context.profileId || !options.interactive(context)) throw new Error('Select the original profile to choose settings')
    return runAction(run.public.pluginId + '/' + run.public.actionId, context, {}, true)
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
  let invalidate = (paneId: string) => {
    let removedOverlay = false
    for (let run of runs.values()) if (run.context.paneId === paneId && run.overlay && !live(run)) {
      run.overlay = undefined; run.overlayInputs = undefined; removedOverlay = true
    }
    if (removedOverlay) (options.overlayChanged ?? options.changed)()
    for (let run of runs.values()) if (run.context.paneId === paneId && (run.public.hook || run.pending && !(run.action.launch_url && run.pending.prompt.kind === 'form'))) finish(run, 'cancelled')
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
          else discoveryErrors.push({ bundled: entry.bundled, id: entry.name, name: entry.name, version: '', enabled: false, hooks: false, actions: [], proxyProviders: [], error: 'Invalid or duplicate plugin manifest' })
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
    server.close(() => { if (socketDirectory) fs.rmSync(socketDirectory, { recursive: true, force: true }) })
  }
  reload()
  let bookmarks = () => [...definitions.values()].filter(definition => definition.manifest.bookmark).map(definition => {
    let contribution = definition.manifest.bookmark!
    if (!settings[definition.manifest.id]?.enabled) return { id: definition.manifest.id, name: definition.manifest.name, contribution, source: '', error: 'Plugin disabled' }
    try {
      let script = fs.realpathSync(path.resolve(definition.directory, contribution.script)), root = fs.realpathSync(definition.directory)
      if (!script.startsWith(`${root}${path.sep}`) || fs.statSync(script).size > 262144) throw new Error('Invalid bookmark script path')
      return { id: definition.manifest.id, name: definition.manifest.name, contribution, source: fs.readFileSync(script, 'utf8') }
    } catch { return { id: definition.manifest.id, name: definition.manifest.name, contribution, source: '', error: 'Bookmark script unavailable' } }
  })
  return { browsingPane: (id: string) => [...runs.values()].some(run => live(run) && run.context.paneId === id && run.definition.manifest.category === 'Social Media' && !run.pending), ready, list, bookmarks, runs: publicRuns, overlay, overlays, copyOverlay, overlayInput, restartOverlay, configureOverlay, prompt, respond, reconcile, run: runAction, cancel, reload, hook, invalidate, close }
}
