import { app, BaseWindow, WebContentsView, session as electronSession, shell, dialog } from 'electron'
import type { WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Bounds, Client, Command, Download, Model, Permission, PublicState, Snapshot } from '../shared/types'
import { cloneWindow, id, mapLayout, newPane, newSession, newTab, newWindow, paneById, removePane, resolve, splitLayout, tabById, walkPanes } from './model'
import { readModel, writeModel } from './store'

type LiveTab = { view: WebContentsView; parent: BaseWindow; disposed: boolean }
type LiveClient = { window: BaseWindow; chrome: WebContentsView; bounds: Bounds[] }
type PendingPermission = Permission & { reply: (allowed: boolean) => void }
let sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
let errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
let required = (args: Record<string, unknown>, name: string) => {
  let value = args[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}
export let normalizeUrl = (value: string) => {
  if (value === 'about:blank') return value
  if (/^(https?:|file:)/i.test(value)) return new URL(value).href
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^localhost:\d+/.test(value)) throw new Error('Only http, https, file and about:blank URLs are supported')
  if (/^localhost(?::\d+)?(?:\/|$)/.test(value) || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value)) return new URL(`http://${value}`).href
  if (!/\s/.test(value) && value.includes('.')) return new URL(`https://${value}`).href
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

export let createRuntime = (dataDirectory: string) => {
  let model: Model = readModel(dataDirectory)
  let clients = new Map<string, LiveClient>()
  let tabs = new Map<string, LiveTab>()
  let hosts = new Map<string, BaseWindow>()
  let configuredProfiles = new Set<string>()
  let snapshots: Record<string, Snapshot> = {}
  let crashes: Record<string, string> = {}
  let permissions = new Map<string, PendingPermission>()
  let permissionGrants = new Map<string, boolean>()
  let downloads: Download[] = []
  let focusedClientId: string | null = null
  let overlays = new Set<string>()
  let automatedContents = new Set<number>()
  let visualQueue: Promise<void> = Promise.resolve()
  let tabQueues = new Map<string, Promise<unknown>>()
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let publishTimer: ReturnType<typeof setTimeout> | undefined
  let shuttingDown = false
  let prefixUntil = 0
  let prefixKey = 'b'
  let settingsFile = path.join(dataDirectory, 'settings.json')
  let grantFile = path.join(dataDirectory, 'permissions.json')
  let readSettings = async () => {
    try { let settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); if (typeof settings.prefixKey === 'string') prefixKey = settings.prefixKey.toLowerCase() } catch { /* Defaults on first launch. */ }
    try { permissionGrants = new Map(JSON.parse(await fs.readFile(grantFile, 'utf8'))) } catch { /* Default deny until requested. */ }
  }
  let settingsReady = readSettings()

  let state = (clientId = ''): PublicState => ({ model, clientId, focusedClientId, snapshots, crashes, permissions: [...permissions.values()].map(({ reply: _reply, ...request }) => request), downloads })
  let publish = () => {
    if (publishTimer || shuttingDown) return
    publishTimer = setTimeout(() => {
      publishTimer = undefined
      for (let [clientId, live] of clients) if (!live.chrome.webContents.isDestroyed()) live.chrome.webContents.send('state', state(clientId))
    }, 30)
  }
  let save = () => {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => { if (!shuttingDown) writeModel(dataDirectory, model) }, 150)
    publish()
  }
  let serializeTab = <T>(tabId: string, operation: () => Promise<T>): Promise<T> => {
    let prior = tabQueues.get(tabId) ?? Promise.resolve()
    let next = prior.catch(() => undefined).then(operation)
    tabQueues.set(tabId, next)
    void next.finally(() => { if (tabQueues.get(tabId) === next) tabQueues.delete(tabId) }).catch(() => undefined)
    return next
  }
  let parkHost = (profileId: string) => {
    let host = hosts.get(profileId)
    if (host && !host.isDestroyed()) return host
    host = new BaseWindow({ show: false, focusable: false, width: 1280, height: 900, hiddenInMissionControl: true })
    hosts.set(profileId, host)
    return host
  }
  let browserSession = (profileId: string) => {
    let profile = resolve(model.profiles, profileId, 'Profile')
    let session = electronSession.fromPartition(`persist:${profile.id}`)
    if (configuredProfiles.has(profileId)) return session
    configuredProfiles.add(profileId)
    session.setPermissionCheckHandler((_contents, permission, origin) => permissionGrants.get(`${profileId}|${origin}|${permission}`) === true)
    session.setPermissionRequestHandler((contents, permission, reply, details) => {
      let origin = details.requestingUrl ? new URL(details.requestingUrl).origin : new URL(contents.getURL()).origin
      let key = `${profileId}|${origin}|${permission}`
      let known = permissionGrants.get(key)
      if (known !== undefined) { reply(known); return }
      let tabId = [...tabs].find(([, live]) => live.view.webContents.id === contents.id)?.[0] ?? ''
      let request = { id: id('permission'), profileId, origin, permission, tabId, reply }
      permissions.set(request.id, request)
      publish()
    })
    session.on('will-download', (_event, item) => {
      let record: Download = { id: id('download'), profileId, name: item.getFilename(), path: '', state: 'progressing', received: 0, total: item.getTotalBytes() }
      // Avoid a Save As dialog activating the application during bot work.
      let target = path.join(app.getPath('downloads'), `${record.id}-${path.basename(record.name)}`)
      item.setSavePath(target)
      record.path = target
      downloads.unshift(record)
      downloads = downloads.slice(0, 100)
      item.on('updated', (_event, status) => { record.state = status; record.received = item.getReceivedBytes(); record.total = item.getTotalBytes(); publish() })
      item.once('done', (_event, status) => { record.state = status; publish() })
      publish()
    })
    return session
  }
  let cdp = async (tabId: string, method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    let live = tabs.get(tabId)
    if (!live || live.view.webContents.isDestroyed()) throw new Error(`Tab ${tabId} is closed`)
    let debuggerApi = live.view.webContents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    return debuggerApi.sendCommand(method, params, sessionId)
  }
  let installKeys = (contents: WebContents) => {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !focusedClientId) return
      if (automatedContents.has(contents.id)) return
      let focused = clients.get(focusedClientId)
      if (!focused || (focused.chrome.webContents !== contents && ![...tabs.values()].some(tab => tab.view.webContents === contents && tab.parent === focused.window))) return
      let client = model.clients.find(client => client.id === focusedClientId)
      if (!client) return
      if (input.control && input.key.toLowerCase() === prefixKey) { prefixUntil = Date.now() + 1600; event.preventDefault(); return }
      if (Date.now() < prefixUntil) {
        prefixUntil = 0
        let key = input.key.toLowerCase()
        let command: Command | null = null
        if (key === 'c') command = { method: 'new-window', args: { session: client.sessionId, client: client.id } }
        if (key === '%' || key === '"') command = { method: 'split-window', args: { pane: client.paneId, axis: key === '%' ? 'horizontal' : 'vertical', client: client.id } }
        if (key === 'n' || key === 'p') command = { method: 'cycle-window', args: { client: client.id, direction: key === 'n' ? 1 : -1 } }
        if (key === 'o') command = { method: 'cycle-pane', args: { client: client.id } }
        if (key === 'd') command = { method: 'detach-client', args: { client: client.id } }
        if (key === 's') clients.get(client.id)?.chrome.webContents.send('focus-control', 'session')
        if (command) void execute(command).catch(reportError)
        event.preventDefault()
        return
      }
      if (!input.meta) return
      let key = input.key.toLowerCase()
      if (key === 'l' || key === 'f') {
        event.preventDefault()
        let chrome = clients.get(client.id)?.chrome.webContents
        chrome?.focus()
        chrome?.send('focus-control', key === 'l' ? 'address' : 'find')
      }
      if (key === 't' && client.paneId) { event.preventDefault(); void execute({ method: 'tab.create', args: { pane: client.paneId, client: client.id } }).catch(reportError) }
      if (key === 'w' && client.paneId) { event.preventDefault(); void execute({ method: 'tab.close', args: { tab: paneById(model, client.paneId).pane.activeTabId } }).catch(reportError) }
      if (key === 'r' && client.paneId) { event.preventDefault(); let { pane } = paneById(model, client.paneId); tabs.get(pane.activeTabId)?.view.webContents.reload() }
    })
  }
  let reportError = (error: unknown) => { console.error(`Browmux: ${errorText(error)}`) }
  let createLiveTab = (tabId: string, load = true, popupOptions?: Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }) => {
    let { tab, pane } = tabById(model, tabId)
    let profile = resolve(model.profiles, pane.profileId, 'Profile')
    let view = new WebContentsView({ ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}), webPreferences: { ...popupOptions?.webPreferences, session: browserSession(pane.profileId), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !profile.background, disableDialogs: true } })
    let parent = parkHost(pane.profileId)
    parent.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
    let live: LiveTab = { view, parent, disposed: false }
    tabs.set(tabId, live)
    let contents = view.webContents
    contents.setZoomFactor(tab.zoom || 1)
    installKeys(contents)
    let update = () => {
      if (live.disposed || contents.isDestroyed()) return
      tab.url = contents.getURL() || tab.url
      tab.title = contents.getTitle() || (tab.url === 'about:blank' ? 'New tab' : tab.url)
      save()
      void scheduleVisuals()
    }
    contents.on('page-title-updated', update)
    contents.on('focus', () => {
      let client = model.clients.find(client => client.id === focusedClientId)
      if (client && visiblePaneIds(client).includes(pane.id) && client.paneId !== pane.id) { client.paneId = pane.id; save() }
    })
    contents.on('did-navigate', update)
    contents.on('did-navigate-in-page', update)
    contents.on('did-finish-load', () => { delete crashes[tabId]; update() })
    contents.on('render-process-gone', (_event, details) => { crashes[tabId] = `Page process ${details.reason}. Reload to recover.`; publish(); void scheduleVisuals() })
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { crashes[tabId] = description; publish(); void scheduleVisuals() } })
    contents.setWindowOpenHandler(details => ({
      action: 'allow', outlivesOpener: true,
      createWindow: options => {
        let added = newTab()
        pane.tabs.push(added)
        // Preserve Electron's opener relationship by returning the actual new WebContents.
        let popupOptions = options as Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }
        let popup = createLiveTab(added.id, false, popupOptions)
        if (!popupOptions.webContents) void popup.view.webContents.loadURL(details.url, { httpReferrer: details.referrer, ...(details.postBody ? { postData: details.postBody.data, extraHeaders: `content-type: ${details.postBody.contentType}` } : {}) }).catch(reportError)
        let owner = model.clients.find(client => client.id === focusedClientId)
        if (owner && visiblePaneIds(owner).includes(pane.id) && details.disposition !== 'background-tab') pane.activeTabId = added.id
        changed()
        return popup.view.webContents
      },
    }))
    if (load) void contents.loadURL(tab.url).catch(error => { if (!live.disposed) { crashes[tabId] = errorText(error); publish() } })
    return live
  }
  let disposeTab = (tabId: string) => {
    let live = tabs.get(tabId)
    if (live) {
      live.disposed = true
      if (!live.parent.isDestroyed()) live.parent.contentView.removeChildView(live.view)
      if (!live.view.webContents.isDestroyed()) live.view.webContents.close({ waitForBeforeUnload: false })
      tabs.delete(tabId)
    }
    for (let [requestId, request] of permissions) if (request.tabId === tabId) { request.reply(false); permissions.delete(requestId) }
    delete snapshots[tabId]
    delete crashes[tabId]
  }
  let visiblePaneIds = (client: Client) => model.sessions.find(session => session.id === client.sessionId)?.windows.find(window => window.id === client.windowId)?.panes.map(pane => pane.id) ?? []
  let moveView = (live: LiveTab, parent: BaseWindow) => {
    if (live.parent === parent || live.disposed) return
    if (!live.parent.isDestroyed()) live.parent.contentView.removeChildView(live.view)
    parent.contentView.addChildView(live.view)
    live.parent = parent
  }
  let reconcile = async () => {
    if (shuttingDown) return
    let liveIds = new Set(walkPanes(model).flatMap(({ pane }) => pane.tabs.map(tab => tab.id)))
    for (let tabId of tabs.keys()) if (!liveIds.has(tabId)) disposeTab(tabId)
    for (let tabId of liveIds) if (!tabs.has(tabId)) createLiveTab(tabId)
    let client = model.clients.find(client => client.id === focusedClientId)
    let owner = client && !overlays.has(client.id) ? clients.get(client.id) : undefined
    let activeIds = new Set(client ? visiblePaneIds(client).map(paneId => paneById(model, paneId).pane.activeTabId) : [])
    for (let [tabId, live] of tabs) {
      let bounds = owner?.bounds.find(bounds => bounds.tabId === tabId)
      let target = owner && bounds && activeIds.has(tabId) && !crashes[tabId] && tabById(model, tabId).tab.url !== 'about:blank' ? owner.window : parkHost(tabById(model, tabId).pane.profileId)
      if (live.parent !== target && [...clients.values()].some(client => client.window === live.parent)) {
        await serializeTab(tabId, async () => {
          try {
            let result = await Promise.race([
              cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 65, fromSurface: true, captureBeyondViewport: false }),
              sleep(800).then(() => { throw new Error('Preview capture timed out') }),
            ])
            if (result.data) snapshots[tabId] = { image: `data:image/jpeg;base64,${result.data}`, capturedAt: Date.now() }
          } catch { /* Keep the last good preview if the page disappears during capture. */ }
        })
      }
      if (live.disposed) continue
      moveView(live, target)
      if (target === owner?.window && bounds) live.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) })
    }
    publish()
  }
  let scheduleVisuals = () => {
    visualQueue = visualQueue.catch(reportError).then(reconcile)
    return visualQueue
  }
  let repairClients = () => {
    for (let client of model.clients) {
      let session = model.sessions.find(session => session.id === client.sessionId) ?? model.sessions[0]
      if (!session) continue
      client.sessionId = session.id
      let window = session.windows.find(window => window.id === client.windowId) ?? session.windows[0]
      client.windowId = window.id
      if (!window.panes.some(pane => pane.id === client.paneId)) client.paneId = window.panes[0]?.id ?? null
    }
  }
  let changed = () => { repairClients(); save(); void scheduleVisuals() }
  let createClient = async (sessionId: string, restored?: Client, activate = true) => {
    let session = resolve(model.sessions, sessionId, 'Session')
    let client: Client = restored ?? { id: id('client'), sessionId, windowId: session.windows[0].id, paneId: session.windows[0].panes[0]?.id ?? null, width: 1280, height: 850 }
    if (!restored) model.clients.push(client)
    let window = new BaseWindow({ title: 'Browmux', width: client.width, height: client.height, minWidth: 640, minHeight: 400, show: false, backgroundColor: '#111318', titleBarStyle: 'hiddenInset' })
    let chrome = new WebContentsView({ webPreferences: { preload: path.join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
    window.contentView.addChildView(chrome)
    let resizeChrome = () => { let bounds = window.getContentBounds(); chrome.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }); client.width = bounds.width; client.height = bounds.height; save() }
    clients.set(client.id, { window, chrome, bounds: [] })
    resizeChrome()
    window.on('resize', resizeChrome)
    window.on('focus', () => { focusedClientId = client.id; void scheduleVisuals() })
    window.on('blur', () => { if (focusedClientId === client.id) { focusedClientId = null; void scheduleVisuals() } })
    window.on('close', () => {
      // Move browser views out before destroying the client so their native hosts survive.
      for (let [tabId, live] of tabs) if (live.parent === window) moveView(live, parkHost(tabById(model, tabId).pane.profileId))
    })
    window.on('closed', () => {
      clients.delete(client.id)
      if (!chrome.webContents.isDestroyed()) chrome.webContents.close()
      if (focusedClientId === client.id) focusedClientId = null
      if (!shuttingDown) { model.clients = model.clients.filter(item => item.id !== client.id); changed(); if (!clients.size) app.dock?.hide() }
    })
    installKeys(chrome.webContents)
    chrome.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    chrome.webContents.on('will-navigate', event => event.preventDefault())
    if (process.env.ELECTRON_RENDERER_URL) await chrome.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await chrome.webContents.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
    if (activate) { await app.dock?.show(); app.focus({ steal: true }); window.show(); window.focus() }
    else window.showInactive()
    save()
    return client
  }
  let sourceClient = (contentsId: number) => [...clients].find(([, live]) => live.chrome.webContents.id === contentsId)?.[0]
  let setBounds = (contentsId: number, bounds: Bounds[]) => {
    let clientId = sourceClient(contentsId)
    if (!clientId || !Array.isArray(bounds)) return
    let valid = bounds.filter(bound => ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bound[key as keyof Bounds])))
    clients.get(clientId)!.bounds = valid
    if (focusedClientId === clientId) void scheduleVisuals()
  }

  let execute = async ({ method, args = {} }: Command): Promise<unknown> => {
    if (method === 'state' || method === 'status') return state()
    if (method === 'client.overlay') {
      let client = resolve(model.clients, args.client, 'Client')
      if (args.visible) overlays.add(client.id)
      else overlays.delete(client.id)
      await scheduleVisuals(); return { visible: !!args.visible }
    }
    if (method === 'list-sessions') return model.sessions
    if (method === 'list-clients') return model.clients
    if (method === 'profile.list') return model.profiles
    if (method === 'profile.create') {
      let name = required(args, 'name')
      if (model.profiles.some(profile => profile.name === name)) throw new Error('Profile name already exists')
      let profile = { id: id('profile'), name, background: args.background === true }
      model.profiles.push(profile); save(); return profile
    }
    if (method === 'profile.rename') {
      let profile = resolve(model.profiles, args.profile, 'Profile')
      let name = required(args, 'name')
      if (model.profiles.some(item => item.id !== profile.id && item.name === name)) throw new Error('Profile name already exists')
      profile.name = name; save(); return profile
    }
    if (method === 'new-session') {
      let name = required(args, 'name')
      if (model.sessions.some(session => session.name === name)) throw new Error('Session name already exists')
      let profile = resolve(model.profiles, args.profile ?? 'default', 'Profile')
      let session = newSession(name, profile.id)
      model.sessions.push(session); changed(); await visualQueue; return session
    }
    if (method === 'rename-session') {
      let session = resolve(model.sessions, args.session, 'Session')
      let name = required(args, 'name')
      if (model.sessions.some(item => item.id !== session.id && item.name === name)) throw new Error('Session name already exists')
      session.name = name; save(); return session
    }
    if (method === 'attach-session') return createClient(resolve(model.sessions, args.session ?? model.sessions[0].id, 'Session').id)
    if (method === 'detach-client') { let client = resolve(model.clients, args.client, 'Client'); clients.get(client.id)?.window.close(); return { detached: client.id } }
    if (method === 'activate-client') { let client = resolve(model.clients, args.client, 'Client'); await app.dock?.show(); app.focus({ steal: true }); clients.get(client.id)?.window.show(); clients.get(client.id)?.window.focus(); return client }
    if (method === 'diagnostics') return { pid: process.pid, tabs: tabs.size, visibleClients: clients.size, focusedClientId, windows: [...clients].map(([id, live]) => ({ id, nativeId: live.window.id, focused: live.window.isFocused(), visible: live.window.isVisible() })), processes: app.getAppMetrics() }
    if (method === 'switch-client') {
      let client = resolve(model.clients, args.client, 'Client')
      let session = resolve(model.sessions, args.session, 'Session')
      client.sessionId = session.id; client.windowId = session.windows[0].id; client.paneId = session.windows[0].panes[0]?.id ?? null
      changed(); await visualQueue; return client
    }
    if (method === 'list-windows') return resolve(model.sessions, args.session, 'Session').windows
    if (method === 'list-panes') return resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window').panes
    if (method === 'new-window') {
      let session = resolve(model.sessions, args.session, 'Session')
      let window = newWindow(String(args.name ?? `window-${session.windows.length + 1}`), resolve(model.profiles, args.profile ?? session.defaultProfileId, 'Profile').id)
      session.windows.push(window)
      if (args.client) { let client = resolve(model.clients, args.client, 'Client'); client.sessionId = session.id; client.windowId = window.id; client.paneId = window.panes[0].id }
      changed(); await visualQueue; return window
    }
    if (method === 'rename-window') { let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window'); window.name = required(args, 'name'); save(); return window }
    if (method === 'select-window' || method === 'cycle-window') {
      let client = resolve(model.clients, args.client, 'Client')
      let session = resolve(model.sessions, client.sessionId, 'Session')
      let index = session.windows.findIndex(window => window.id === client.windowId)
      let window = method === 'select-window' ? resolve(session.windows, args.window, 'Window') : session.windows[(index + Number(args.direction ?? 1) + session.windows.length) % session.windows.length]
      client.windowId = window.id; client.paneId = window.panes[0]?.id ?? null
      changed(); await visualQueue; return client
    }
    if (method === 'select-pane' || method === 'cycle-pane') {
      let client = resolve(model.clients, args.client, 'Client')
      let window = resolve(resolve(model.sessions, client.sessionId, 'Session').windows, client.windowId, 'Window')
      let index = window.panes.findIndex(pane => pane.id === client.paneId)
      client.paneId = method === 'select-pane' ? resolve(window.panes, args.pane, 'Pane').id : window.panes[(index + 1) % window.panes.length]?.id ?? null
      if (method === 'cycle-pane' && client.id === focusedClientId && client.paneId) {
        let pane = paneById(model, client.paneId).pane
        tabs.get(pane.activeTabId)?.view.webContents.focus()
      }
      save(); return client
    }
    if (method === 'split-window') {
      let parent = args.pane ? paneById(model, args.pane) : undefined
      let window = parent?.window ?? resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      let session = parent?.session ?? model.sessions.find(session => session.windows.includes(window))!
      let pane = newPane(resolve(model.profiles, args.profile ?? parent?.pane.profileId ?? session.defaultProfileId, 'Profile').id, args.url ? normalizeUrl(String(args.url)) : undefined)
      window.layout = splitLayout(window.layout, parent?.pane.id ?? window.panes[0]?.id, pane.id, args.axis === 'vertical' ? 'vertical' : 'horizontal')
      window.panes.push(pane)
      if (args.client) resolve(model.clients, args.client, 'Client').paneId = pane.id
      changed(); await visualQueue; return pane
    }
    if (method === 'resize-pane') {
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      let ratio = Number(args.ratio)
      if (!Number.isFinite(ratio)) throw new Error('ratio must be numeric')
      window.layout = mapLayout(window.layout, node => node.kind === 'split' && node.id === args.split ? { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) } : node)
      save(); return window.layout
    }
    if (method === 'move-pane') {
      let { window: from, pane } = paneById(model, args.pane)
      let to = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      if (to === from) throw new Error('Choose another internal window')
      from.layout = removePane(from.layout, pane.id); from.panes = from.panes.filter(item => item.id !== pane.id)
      to.layout = splitLayout(to.layout, to.panes[0]?.id, pane.id, 'horizontal'); to.panes.push(pane)
      changed(); await visualQueue; return pane
    }
    if (method === 'kill-pane') {
      let { window, pane } = paneById(model, args.pane)
      if (pane.tabs.length > 1 && args.confirm !== true) throw new Error('Pane contains multiple tabs; pass --confirm')
      window.layout = removePane(window.layout, pane.id); window.panes = window.panes.filter(item => item.id !== pane.id)
      changed(); await visualQueue; return { closed: pane.id }
    }
    if (method === 'kill-window') {
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      if (window.panes.reduce((count, pane) => count + pane.tabs.length, 0) > 1 && args.confirm !== true) throw new Error('Window contains multiple tabs; pass --confirm')
      let session = model.sessions.find(session => session.windows.includes(window))!
      session.windows = session.windows.filter(item => item !== window)
      if (!session.windows.length) session.windows.push(newWindow('main', session.defaultProfileId))
      changed(); await visualQueue; return { closed: window.id }
    }
    if (method === 'save-layout') {
      let name = required(args, 'name')
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      let saved = { name, window: structuredClone(window) }
      model.layouts = [...model.layouts.filter(layout => layout.name !== name), saved]; save(); return saved
    }
    if (method === 'list-layouts') return model.layouts.map(layout => ({ name: layout.name, panes: layout.window.panes.length }))
    if (method === 'restore-layout') {
      if (args.confirm !== true) throw new Error('Restoring replaces this window’s pages; pass --confirm')
      let saved = model.layouts.find(layout => layout.name === args.name)
      if (!saved) throw new Error('Saved layout not found')
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      let replacement = cloneWindow(saved.window)
      window.layout = replacement.layout; window.panes = replacement.panes
      changed(); await visualQueue; return window
    }
    if (method === 'tab.list') return walkPanes(model).filter(item => !args.pane || item.pane.id === args.pane).flatMap(({ session, window, pane }) => pane.tabs.map(tab => ({ ...tab, paneId: pane.id, windowId: window.id, sessionId: session.id, profileId: pane.profileId, active: tab.id === pane.activeTabId })))
    if (method === 'tab.create') {
      let { pane } = paneById(model, args.pane)
      let tab = newTab(args.url ? normalizeUrl(String(args.url)) : undefined)
      pane.tabs.push(tab)
      if (args.client) pane.activeTabId = tab.id
      changed(); await visualQueue; return tab
    }
    if (method === 'tab.select') { let { tab, pane } = tabById(model, args.tab); pane.activeTabId = tab.id; changed(); await visualQueue; return tab }
    if (method === 'tab.close') {
      let { tab, pane } = tabById(model, args.tab)
      pane.tabs = pane.tabs.filter(item => item.id !== tab.id)
      if (!pane.tabs.length) pane.tabs.push(newTab())
      if (pane.activeTabId === tab.id) pane.activeTabId = pane.tabs[0].id
      changed(); await visualQueue; return { closed: tab.id }
    }
    if (method === 'permission.list') return state().permissions
    if (method === 'permission.respond') {
      let request = permissions.get(required(args, 'id'))
      if (!request) throw new Error('Permission request no longer exists')
      let allowed = args.allow === true
      permissionGrants.set(`${request.profileId}|${request.origin}|${request.permission}`, allowed)
      request.reply(allowed); permissions.delete(request.id)
      await fs.writeFile(grantFile, JSON.stringify([...permissionGrants]), { mode: 0o600 }); publish(); return { allowed }
    }
    if (method === 'downloads') return downloads
    if (method === 'download.reveal') { let item = downloads.find(item => item.id === args.id); if (!item) throw new Error('Download not found'); shell.showItemInFolder(item.path); return { path: item.path } }
    if (method === 'settings.prefix') {
      let key = required(args, 'key').toLowerCase()
      if (!/^[a-z]$/.test(key)) throw new Error('Prefix key must be one letter (used with Control)')
      prefixKey = key; await fs.writeFile(settingsFile, JSON.stringify({ prefixKey }), { mode: 0o600 }); return { prefix: `Ctrl+${key.toUpperCase()}` }
    }
    if (method === 'dialog.confirm') {
      let client = resolve(model.clients, args.client, 'Client')
      let response = await dialog.showMessageBox(clients.get(client.id)!.window, { type: 'question', message: required(args, 'message'), buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0 })
      return response.response === 1
    }
    if (method === 'quit') { setTimeout(() => app.quit(), 100); return { quitting: true } }
    if (!['navigate', 'eval', 'dom', 'screenshot', 'click', 'type', 'key', 'wait', 'cdp', 'back', 'forward', 'reload', 'find', 'zoom', 'devtools'].includes(method)) throw new Error(`Unknown command: ${method}`)
    let tabId = required(args, 'tab')
    tabById(model, tabId)
    await visualQueue
    return serializeTab(tabId, async () => {
      let { tab, pane } = tabById(model, tabId)
      let contents = tabs.get(tabId)!.view.webContents
      let background = resolve(model.profiles, pane.profileId, 'Profile').background
      contents.setBackgroundThrottling(false)
      automatedContents.add(contents.id)
      try {
        if (method === 'navigate') { await contents.loadURL(normalizeUrl(required(args, 'url'))); return { id: tab.id, url: contents.getURL() } }
        if (method === 'reload') { delete crashes[tabId]; contents.reload(); publish(); return { reloading: tabId } }
        if (method === 'back' || method === 'forward') { let history = contents.navigationHistory; if (method === 'back' && history.canGoBack()) history.goBack(); if (method === 'forward' && history.canGoForward()) history.goForward(); return { tab: tabId } }
        if (method === 'devtools') { contents.openDevTools({ mode: 'detach', activate: false }); return { opened: tabId } }
        if (method === 'find') { let text = String(args.text ?? ''); if (!text) contents.stopFindInPage('clearSelection'); else contents.findInPage(text, { findNext: args.next === true, forward: args.forward !== false }); return { text } }
        if (method === 'zoom') { tab.zoom = Math.max(0.25, Math.min(3, Number(args.factor) || 1)); contents.setZoomFactor(tab.zoom); save(); return { factor: tab.zoom } }
        if (method === 'eval') {
          let result = await cdp(tabId, 'Runtime.evaluate', { expression: required(args, 'expression'), awaitPromise: true, returnByValue: true, timeout: 15000 })
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
          return result.result.value ?? null
        }
        if (method === 'dom') {
          let result = await cdp(tabId, 'Runtime.evaluate', { expression: args.html === true ? 'document.documentElement.outerHTML' : 'document.body?.innerText ?? ""', returnByValue: true })
          return { tab: tabId, url: contents.getURL(), content: result.result.value }
        }
        if (method === 'cdp') return cdp(tabId, required(args, 'method'), (args.params ?? {}) as Record<string, unknown>, typeof args.sessionId === 'string' ? args.sessionId : undefined)
        if (method === 'screenshot') {
          let target = path.resolve(required(args, 'output'))
          let params: Record<string, unknown> = { format: 'png', fromSurface: true, captureBeyondViewport: args.fullPage !== false }
          if (args.fullPage !== false) {
            let metrics = await cdp(tabId, 'Page.getLayoutMetrics')
            let size = metrics.cssContentSize ?? metrics.contentSize
            if (size.width * size.height > 80_000_000) throw new Error('Page exceeds 80 megapixels; use --viewport or a CDP clip')
            params.clip = { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height), scale: 1 }
          }
          let result = await cdp(tabId, 'Page.captureScreenshot', params)
          await fs.mkdir(path.dirname(target), { recursive: true })
          await fs.writeFile(target, Buffer.from(result.data, 'base64'), { mode: 0o600 })
          return { tab: tabId, path: target, fullPage: args.fullPage !== false }
        }
        if (method === 'wait') {
          let timeout = Math.min(60000, Math.max(1, Number(args.timeout ?? 15000)))
          let started = Date.now()
          if (args.ms !== undefined) { await sleep(Math.min(timeout, Math.max(0, Number(args.ms)))); return { waited: Date.now() - started } }
          let expression = args.expression ? String(args.expression) : `!!document.querySelector(${JSON.stringify(required(args, 'selector'))})`
          while (Date.now() - started < timeout) {
            let result = await cdp(tabId, 'Runtime.evaluate', { expression, returnByValue: true })
            if (result.result.value) return { matched: true }
            await sleep(100)
          }
          throw new Error(`Wait timed out after ${timeout}ms`)
        }
        if (method === 'click' || method === 'type') {
          if (args.selector) {
            let result = await cdp(tabId, 'Runtime.evaluate', { expression: `(() => { let e = document.querySelector(${JSON.stringify(args.selector)}); if (!e) throw new Error('Selector not found'); e.scrollIntoView({block:'center'}); e.focus(); let r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`, returnByValue: true })
            if (result.exceptionDetails) throw new Error('Selector not found or not interactable')
            if (method === 'click') { let point = result.result.value; await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }); await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }) }
          } else if (method === 'click') {
            if (!Number.isFinite(Number(args.x)) || !Number.isFinite(Number(args.y))) throw new Error('Provide selector or x and y')
            for (let type of ['mousePressed', 'mouseReleased']) await cdp(tabId, 'Input.dispatchMouseEvent', { type, x: Number(args.x), y: Number(args.y), button: 'left', clickCount: 1 })
          }
          if (method === 'type') await cdp(tabId, 'Input.insertText', { text: String(args.text ?? '') })
          return { tab: tabId }
        }
        if (method === 'key') {
          let parts = required(args, 'key').split('+')
          let key = parts.pop()!
          let modifierFlags: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Cmd: 4, Shift: 8 }
          let modifiers = parts.reduce((value, part) => { if (!modifierFlags[part]) throw new Error(`Unknown modifier ${part}`); return value | modifierFlags[part] }, 0)
          let codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 }
          // CDP bypasses AppKit's key binding translation on macOS.
          let editing: Record<string, string> = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo' }
          let command = modifiers === 4 ? editing[key.toLowerCase()] : modifiers === 12 && key.toLowerCase() === 'z' ? 'redo' : undefined
          let code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key
          for (let type of ['keyDown', 'keyUp']) await cdp(tabId, 'Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: codes[key] ?? key.toUpperCase().charCodeAt(0), ...(type === 'keyDown' && command ? { commands: [command] } : {}), ...(type === 'keyDown' && key === 'Enter' && !modifiers ? { text: '\r' } : {}) })
          return { tab: tabId }
        }
      } finally { automatedContents.delete(contents.id); if (!contents.isDestroyed()) contents.setBackgroundThrottling(!background) }
      return null
    })
  }
  let start = async (background: boolean) => {
    await settingsReady
    await scheduleVisuals()
    if (background) { model.clients = []; save(); return }
    let restore = [...model.clients]
    if (!restore.length) { await createClient(model.sessions[0].id); return }
    repairClients()
    for (let client of restore) await createClient(client.sessionId, client, false)
    let last = clients.get(restore[restore.length - 1].id)
    await app.dock?.show(); last?.window.show(); last?.window.focus()
  }
  let shutdown = () => {
    shuttingDown = true
    clearTimeout(persistTimer); clearTimeout(publishTimer)
    writeModel(dataDirectory, model)
    for (let tabId of tabs.keys()) disposeTab(tabId)
    for (let host of hosts.values()) if (!host.isDestroyed()) host.destroy()
  }
  return { execute, state, start, shutdown, sourceClient, setBounds, createClient, get model() { return model }, get tabCount() { return tabs.size } }
}
