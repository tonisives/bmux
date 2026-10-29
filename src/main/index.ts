import { app, ipcMain, Menu } from 'electron'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRecordings } from './recordings'
import { createRuntime } from './runtime'
import type { Command } from '../shared/types'
import { runtimeDataDirectory } from '../../bin/runtime-paths.mjs'
import { controlSocketPath, prepareControlSocket, listenSocket, removeSocket } from '../../bin/ipc.mjs'
import { startRemoteHost } from './remote-host'
import { createLocalRemote } from './remote-client'
import { installUpdateMenu } from './update-menu'
import { socketAgent } from './socket-agent'
import { randomUUID } from 'node:crypto'

let defaultDataDirectory = runtimeDataDirectory(process.platform, os.homedir(), {})
let legacyDataDirectory = process.platform === 'darwin' && [path.join(os.homedir(), 'Library', 'Application Support', 'Browmux'), path.join(os.homedir(), 'Library', 'Application Support', 'Bmux')].find(directory => fs.existsSync(directory))
let configuredDataDirectory = process.env.BMUX_DATA_DIR ?? process.env.BROWMUX_DATA_DIR
if (!configuredDataDirectory && !fs.existsSync(defaultDataDirectory) && legacyDataDirectory) fs.renameSync(legacyDataDirectory, defaultDataDirectory)
let dataDirectory = runtimeDataDirectory(process.platform, os.homedir(), process.env)
let background = process.env.BMUX_BACKGROUND === '1' || process.env.BROWMUX_BACKGROUND === '1' || process.argv.includes('--background')
app.setName('bmux')
for (let signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => app.quit())
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp')
if (process.platform === 'linux' && process.env.BMUX_DISK_SHARED_MEMORY === '1') app.commandLine.appendSwitch('disable-dev-shm-usage')
app.setPath('userData', dataDirectory)
fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
let socketPath = controlSocketPath(dataDirectory)
let runtime: ReturnType<typeof createRuntime> | undefined
let server: net.Server | undefined
let remoteHost: ReturnType<typeof startRemoteHost> | undefined
let recordings: ReturnType<typeof createRecordings> | undefined
let localRemote: ReturnType<typeof createLocalRemote> | undefined
let enrollmentFile = path.join(dataDirectory, 'remote-enrollment.json')
let enrolling = false

let recordingCommand = async (command: Command) => {
  let args=command.args??{}
  if(command.method==='record.start'){let target=typeof args.pane==='string'&&!args.host?runtime!.recordingTarget(args.pane):{};return recordings!.start({...args,...target,sourcePane:typeof args.pane === 'string' ? args.pane : undefined})}
  if(command.method==='record.event') {
    let event=args.event as {test?:boolean;episodeId?:string;type?:string;hostId?:string;generation?:string;target?:{paneId?:string;sessionId?:string}} | undefined
    if(event?.test === true)return {tested:true}
    if(!event || !/^[a-f0-9-]{36}$/.test(event.episodeId ?? ''))throw new Error('Invalid activity episode')
    if(event.type==='agent.session.end')return recordings!.skip(event.episodeId!)
    if(event.type!=='agent.session.start')return {ignored:true}
    if(!/^[a-f0-9-]{36}$/.test(event.hostId ?? '') || !/^[a-f0-9-]{36}$/.test(event.generation ?? '') || !event.target?.paneId || !event.target.sessionId)throw new Error('Invalid recording target')
    return recordings!.start({id:event.episodeId,episode:event.episodeId,host:event.hostId,generation:event.generation,pane:event.target.paneId,session:event.target.sessionId})
  }
  if(command.method==='record.play')return recordings!.play(String(args.id))
  if(command.method==='record.stop')return recordings!.stop(String(args.id))
  if(command.method==='record.reveal')return recordings!.reveal(String(args.id))
  if(['record.list','record.status'].includes(command.method))return recordings!.list()
  throw new Error('Unknown recording command')
}
let hookCommand = (command: Command) => {
  let args=command.args??{}, method=command.method.slice(6), id=typeof args.id==='string'?args.id:undefined
  if(id && !/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid hook ID')
  if(method==='list')return localRemote!.account('/api/hooks')
  if(method==='create')return localRemote!.account('/api/hooks',args.config??{})
  if(!id)throw new Error('Hook ID required')
  if(method==='update')return localRemote!.account(`/api/hooks/${id}`,args.config??{})
  if(method==='delete')return localRemote!.account(`/api/hooks/${id}`,undefined,'DELETE')
  if(method==='enable'||method==='disable')return localRemote!.account(`/api/hooks/${id}`,{enabled:method==='enable'})
  if(method==='deliveries')return localRemote!.account(`/api/hooks/${id}/deliveries`)
  if(method==='test')return localRemote!.account(`/api/hooks/${id}/test`,{})
  throw new Error('Unknown hooks command')
}
let updateMenu: ReturnType<typeof installUpdateMenu>

let readyForLinks = false
let pendingLinks: { url: string; allowFile: boolean }[] = []
let pendingActivation = false
let linkQueue = Promise.resolve()
let existingClient = async () => runtime!.preferredClient() ?? await runtime!.createClient(runtime!.model.sessions[0].id)
let activateExistingClient = () => {
  if (!readyForLinks) { pendingActivation = true; return }
  linkQueue = linkQueue.then(async () => {
    let client = await existingClient()
    await runtime!.execute({ method: 'activate-client', args: { client: client.id } })
  }).catch(() => { console.error('Could not activate browser window') })
}
let receiveLink = (url: string, allowFile = false) => {
  try { if (!['http:', 'https:', ...(allowFile ? ['file:'] : [])].includes(new URL(url).protocol)) return } catch { return }
  if (!readyForLinks) { pendingLinks.push({ url, allowFile }); return }
  linkQueue = linkQueue.then(async () => {
    let browser = runtime!
    let client = await existingClient()
    // OS-opened links are human navigation, like entering a URL in this client.
    await browser.openExternalLink(client.id, url)
    await browser.execute({ method: 'activate-client', args: { client: client.id } })
  }).catch(() => { console.error('Could not open external browser link') })
}
app.on('open-url', (event, url) => { event.preventDefault(); receiveLink(url) })
app.on('open-file', (event, filePath) => { event.preventDefault(); receiveLink(pathToFileURL(filePath).href, true) })

// macOS delivers launch documents before ready. Let a second process receive
// them before it hands its pending links to the existing process and exits.
void app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock({ links: pendingLinks })) { app.quit(); return }
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    let forwarded = additionalData as { links?: typeof pendingLinks } | undefined
    if (Array.isArray(forwarded?.links) && forwarded.links.length) {
      for (let link of forwarded.links) if (typeof link?.url === 'string') receiveLink(link.url, link.allowFile === true)
      return
    }
    let links = argv.filter(value => /^https?:\/\//i.test(value))
    if (links.length) { links.forEach(link => receiveLink(link)); return }
    if (!argv.includes('--background')) activateExistingClient()
  })
  app.on('window-all-closed', () => { /* Clients detach; the server owns browser lifetime. */ })
  app.on('activate', () => { if (runtime && !runtime.model.clients.length) activateExistingClient() })
  let quitting = false, flushing: Promise<void> | undefined
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    if (flushing) return
    updateMenu?.close()
    remoteHost?.close()
    flushing = (async () => { await recordings?.close(); localRemote?.close(); await Promise.all([runtime?.shutdown(),localRemote?.flush()]) })()
    server?.close()
    removeSocket(socketPath)
    void flushing.finally(() => { quitting = true; app.quit() })
  })
  if (background) app.dock?.hide()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'bmux', submenu: [{ role: 'about' }, { id: 'check-for-updates', label: 'Check for Updates...', visible: false }, { id: 'automatic-updates', label: 'Automatically Check for Updates', type: 'checkbox', visible: false }, { type: 'separator' }, { label: 'New Client', accelerator: 'CmdOrCtrl+Shift+N', click: () => { if (runtime) void runtime.createClient(runtime.model.sessions[0].id) } }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]))
  runtime = createRuntime(dataDirectory, () => { updateMenu?.refresh(); void localRemote?.refreshPreviewSettings().catch(() => undefined) })
  localRemote = createLocalRemote(dataDirectory, () => runtime!.state().remotePreviews!)
  recordings = createRecordings(dataDirectory,runtime,localRemote)
  localRemote.useProfiles(() => runtime!.model.profiles.map(profile => profile.id))
  ipcMain.handle('clipboard', (event, text?: string) => {
    if (!runtime!.sourceClient(event.sender.id)) throw new Error('Untrusted renderer')
    if (text !== undefined && typeof text !== 'string') throw new Error('Invalid clipboard text')
    return runtime!.clipboard(text)
  })
  ipcMain.handle('state', event => {
    let clientId = runtime!.sourceClient(event.sender.id)
    if (!clientId) throw new Error('Untrusted renderer')
    return runtime!.state(clientId)
  })
  ipcMain.handle('command', (event, command: Command) => {
    let clientId = runtime!.sourceClient(event.sender.id)
    if (!clientId) throw new Error('Untrusted renderer')
    if(command.method.startsWith('record.'))return recordingCommand(command)
    return runtime!.execute(command, clientId)
  })
  ipcMain.handle('remote-sessions', event => {
    if (!runtime!.sourceClient(event.sender.id)) throw new Error('Untrusted renderer')
    return localRemote!.list()
  })
  ipcMain.handle('remote-account', async (event, endpoint: string, body?: unknown, method?: string) => {
    if (!runtime!.sourceClient(event.sender.id)) throw new Error('Untrusted renderer')
    if (typeof endpoint !== 'string') throw new Error('Invalid account endpoint')
    if (endpoint === '/local/state') return { enabled: !!remoteHost, name: os.hostname(), ...remoteHost?.status() }
    if (endpoint === '/local/connect' || endpoint === '/local/disconnect') {
      if (enrolling) throw new Error('Connection update in progress')
      enrolling = true
      try {
        if (endpoint === '/local/connect') {
          if (remoteHost) return remoteHost.status()
          let requested = (body as { name?: unknown } | undefined)?.name
          if (requested !== undefined && (typeof requested !== 'string' || !requested.trim() || requested.length > 64 || /[\x00-\x1f\x7f]/.test(requested))) throw new Error('Enter a computer name')
          let name = (typeof requested === 'string' ? requested : os.hostname()).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0,40).replace(/^-+|-+$/g,'') || 'computer'
          let service = `${name}-${randomUUID().slice(0,8)}`
          let created = await localRemote!.account('/api/services', { service }) as { service: string; key: string }
          let saved = false
          try {
            fs.writeFileSync(enrollmentFile, JSON.stringify({ url: localRemote!.origin, token: created.key, service }), { mode: 0o600, flag: 'wx' })
            saved = true
            remoteHost = startRemoteHost(runtime!, dataDirectory, enrollmentFile)
          } catch (error) { await localRemote!.account('/api/services/revoke', { service }); if (saved) fs.unlinkSync(enrollmentFile); throw error }
        } else {
          if (process.env.BMUX_REMOTE_CONFIG) throw new Error('This host uses a remote configuration file. Manage its enrollment there.')
          if (fs.existsSync(enrollmentFile)) {
            let { service } = JSON.parse(fs.readFileSync(enrollmentFile,'utf8')) as { service: string }
            await localRemote!.account('/api/services/revoke', { service })
            remoteHost?.close(); remoteHost = undefined; fs.unlinkSync(enrollmentFile)
          }
        }
        return { enabled: !!remoteHost, name: os.hostname(), ...remoteHost?.status() }
      } finally { enrolling = false }
    }
    return localRemote!.account(endpoint,body,method)
  })
  ipcMain.handle('remote-billing-open', (event, value: string) => {
    let clientId = runtime!.sourceClient(event.sender.id)
    if (!clientId || typeof value !== 'string') throw new Error('Untrusted renderer')
    let url = new URL(value)
    if (url.protocol !== 'https:' || !['checkout.stripe.com','billing.stripe.com'].includes(url.hostname) || url.username || url.password) throw new Error('Invalid billing URL')
    return runtime!.openRemotePage(clientId, { key: 'billing', title: 'Billing', url: url.href })
  })
  ipcMain.handle('remote-session-previews', (event, host: string, session: string, request: 'cache' | 'missing' | 'refresh' = 'missing') => {
    if (!['cache', 'missing', 'refresh'].includes(request)) throw new Error('Invalid preview request')
    if (!runtime!.sourceClient(event.sender.id)) throw new Error('Untrusted renderer')
    if (typeof host !== 'string' || typeof session !== 'string') throw new Error('Invalid remote session')
    return localRemote!.sessionPreviews(host, session, request)
  })
  ipcMain.handle('remote-close-session', (event, host: string, session: string) => {
    if (!runtime!.sourceClient(event.sender.id)) throw new Error('Untrusted renderer')
    if (typeof host !== 'string' || typeof session !== 'string') throw new Error('Invalid remote session')
    return localRemote!.closeSession(host, session)
  })
  ipcMain.handle('remote-close-page', (event, host: string, session: string, pane: string) => {
    if (!runtime!.sourceClient(event.sender.id)) throw new Error('Untrusted renderer')
    if (typeof host !== 'string' || typeof session !== 'string' || typeof pane !== 'string') throw new Error('Invalid remote page')
    return localRemote!.closePage(host, session, pane)
  })
  ipcMain.handle('remote-open', async (event, host?: string, session?: string, pane?: string) => {
    let clientId = runtime!.sourceClient(event.sender.id)
    if (!clientId) throw new Error('Untrusted renderer')
    if (pane !== undefined && typeof pane !== 'string') throw new Error('Invalid remote pane')
    if ((host !== undefined && typeof host !== 'string') || (session !== undefined && typeof session !== 'string')) throw new Error('Invalid remote session')
    if (!host && !session) {
      let client = runtime!.model.clients.find(item => item.id === clientId)!
      let workspace = runtime!.model.sessions.find(item => item.id === client.sessionId)!
      let pane = workspace.windows.flatMap(window => window.panes).find(item => item.id === client.paneId)
      let profileId = pane?.profileId ?? workspace.defaultProfileId
      localRemote!.preferProfile(profileId)
      await runtime!.openRemotePage(clientId, { key: 'sign-in', title: 'Sign in to remote', url: localRemote!.origin })
      return
    }
    return localRemote!.open(host, session, page => runtime!.openRemotePage(clientId, page), pane, clientId)
  })
  ipcMain.on('bounds', (event, bounds) => runtime!.setBounds(event.sender.id, bounds))
  await runtime.start(background)
  updateMenu = installUpdateMenu({ showMessageDialog: options => runtime!.showMessageDialog(options), enabled: () => runtime!.automaticUpdates, setEnabled: enabled => runtime!.setAutomaticUpdates(enabled), beforeRestart: () => runtime?.shutdown() })
  let remoteConfig = process.env.BMUX_REMOTE_CONFIG ?? (fs.existsSync(enrollmentFile) ? enrollmentFile : undefined)
  if (remoteConfig) remoteHost = startRemoteHost(runtime, dataDirectory, remoteConfig)
  readyForLinks = true
  pendingLinks.splice(0).forEach(link => receiveLink(link.url, link.allowFile))
  if (pendingActivation) activateExistingClient()
  prepareControlSocket(socketPath)
  server = net.createServer(connection => {
    let buffer = ''
    connection.setEncoding('utf8')
    connection.on('error', () => undefined)
    connection.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 1_048_576) { connection.end(`${JSON.stringify({ ok: false, error: 'Request exceeds 1MB' })}\n`); return }
      let newline = buffer.indexOf('\n')
      if (newline < 0) return
      let request = buffer.slice(0, newline)
      buffer = ''
      void (async () => {
        try {
          let command = JSON.parse(request) as Command
          if (!command || typeof command.method !== 'string' || (command.args !== undefined && (typeof command.args !== 'object' || command.args === null || Array.isArray(command.args)))) throw new Error('Invalid request')
          if (process.env.BMUX_INTERACTIVE_ONLY === 'true' && command.method !== 'status') throw new Error('This browser supports interactive access only')
          command = socketAgent(command, process.env.BMUX_DEFAULT_AGENT_ID)
          let result = command.method.startsWith('record.') ? await recordingCommand(command) : command.method.startsWith('hooks.') ? await hookCommand(command) : command.method === 'remote.status' ? remoteHost?.status() ?? { enabled: false }
            : command.method === 'remote.job' ? (() => {
              if (!remoteHost) throw new Error('Remote reporting is not enabled')
              let args = command.args ?? {}
              if (typeof args.id !== 'string' || typeof args.attempt !== 'string' || args.result !== undefined && !['succeeded', 'failed'].includes(String(args.result))) throw new Error('Invalid job event')
              return remoteHost.job(args.id, args.attempt, args.result as 'succeeded' | 'failed' | undefined)
            })() : await runtime!.execute(command)
          connection.end(`${JSON.stringify({ ok: true, result })}\n`)
        } catch (error) {
          connection.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
        }
      })()
    })
  })
  await listenSocket(server, socketPath)
  server.on('error', error => { console.error(`bmux control socket: ${error.message}`); app.quit() })
}).catch(error => { console.error(`bmux startup failed: ${error instanceof Error ? error.message : String(error)}`); app.exit(1) })
