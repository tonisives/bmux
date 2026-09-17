import { app, BaseWindow, BrowserWindow, WebContentsView, session as electronSession, shell, dialog, Menu, webContents, safeStorage, screen, clipboard } from 'electron'
import type { DownloadItem, WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Bounds, Client, Command, Download, FindResult, Model, Permission, PublicState, Snapshot } from '../shared/types'
import { cloneWindow, id, mapLayout, newPane, newSession, newTab, newWindow, paneById, paneInDirection, removePane, removeSession, repairClientSelections, resolve, splitLayout, tabById, updateAutomaticWindowName, walkPanes } from './model'
import { readModel, writeModel } from './store'
import { importBrave, braveDirectory } from './brave'
import fsSync from 'node:fs'
import { parseCommandLine } from '../shared/command-line'
import { createConfig, configPath } from './config'
import type { Shortcut } from '../shared/keyboard'
import { DEFAULT_KEYBOARD, isModifierKeyBinding, matchesBinding, shortcutAction, shortcutWhen, shortcutMatchesContext } from '../shared/keyboard'
import { createPlugins } from './plugins'
import { createPluginBrowser } from './plugin-browser'
import { movePointer } from './pointer'
import type { PluginContext } from '../shared/plugins'
import { createRequestFilters } from './request-filters'
import { createSavedForms } from './saved-forms'
import { createPageTools } from './page-tools'
import { waitOptions } from './wait'
import { DEFAULT_BROWSER, pageOrigin, siteSettings } from '../shared/browser-tools'
import type { BrowserToolsState } from '../shared/browser-tools'
import { windowCloseBehavior } from '../shared/window-close'
import { createExtensions } from './extensions'
import { installBitwardenExtension } from './bitwarden-extension'
import { parseSearchSuggestions } from '../shared/address-suggestions'
import { createBookmarkFolder, saveBookmark } from './bookmarks'

type LiveTab = { view: WebContentsView; contents: Electron.WebContents; parent: BaseWindow; disposed: boolean; pendingNavigation?: symbol; pendingUrl?: string }
type LiveClient = { window: BaseWindow; chrome: WebContentsView; permissionPopup: WebContentsView; linkPreview: WebContentsView; linkUrl: string; linkTabId?: string; dismissedPermissions: Set<string>; bounds: Bounds[]; pageFocused: boolean }
type PendingPermission = Permission & { reply: (allowed: boolean) => void }
let sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
let focusWindow = async (window: BaseWindow) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    window.focus()
    await sleep(attempt ? 80 : 200)
    if (window.isFocused()) return
  }
}
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
  let extensionWindows = new Set<BrowserWindow>()
  let extensions = createExtensions(dataDirectory, profileId => ({
    createTab: async details => {
      let client = model.clients.find(client => client.id === focusedClientId)
      let pane = client?.paneId ? paneById(model, client.paneId).pane : undefined
      if (!pane || pane.profileId !== profileId) throw new Error('Select a pane in the extension profile first')
      let tab = await execute({ method: 'tab.create', args: { pane: pane.id, url: details.url ?? 'about:blank', ...(details.active !== false ? { client: client!.id } : {}) } }) as { id: string }
      let live = tabs.get(tab.id)!
      return [live.contents, live.parent]
    },
    selectTab: contents => {
      let target = [...tabs].find(([, live]) => live.contents === contents)
      if (target) { let { pane } = tabById(model, target[0]); if (pane.activeTabId !== target[0]) void execute({ method: 'tab.select', args: { tab: target[0] } }).catch(() => undefined) }
    },
    removeTab: contents => {
      let target = [...tabs].find(([, live]) => live.contents === contents)
      if (target && !contents.isDestroyed()) void execute({ method: 'tab.close', args: { tab: target[0] } }).catch(() => undefined)
      if (!target) { let window = [...extensionWindows].find(window => !window.isDestroyed() && window.webContents === contents); window?.close() }
    },
    createWindow: async details => {
      let url = Array.isArray(details.url) ? details.url[0] : details.url
      if (!url) throw new Error('Extension window URL is required')
      let parsed = new URL(url)
      let session = browserSession(profileId)
      if (parsed.protocol !== 'chrome-extension:' || !session.extensions.getExtension(parsed.hostname)) throw new Error('Only installed extension pages can open extension windows')
      let window = new BrowserWindow({ show: false, width: Math.max(320, Math.min(1200, details.width ?? 420)), height: Math.max(240, Math.min(1000, details.height ?? 640)), webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      extensionWindows.add(window)
      window.on('closed', () => extensionWindows.delete(window))
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, target) => { let next = new URL(target); if (next.protocol !== parsed.protocol || next.hostname !== parsed.hostname) event.preventDefault() })
      extensions.track(profileId, window.webContents, window, true)
      try { await window.loadURL(url) } catch (error) { window.destroy(); throw error }
      let client = model.clients.find(client => client.id === focusedClientId)
      let active = client?.paneId && paneById(model, client.paneId).pane.profileId === profileId && clients.get(client.id)?.window.isFocused()
      if (active && details.focused !== false) window.show(); else window.showInactive()
      return window
    },
    removeWindow: window => { if (extensionWindows.has(window as BrowserWindow)) window.close() },
    requestPermissions: async () => false,
  }))
  let snapshots: Record<string, Snapshot> = {}
  let crashes: Record<string, string> = {}
  let loading: Record<string, boolean> = {}
  let favicons: Record<string, string> = {}
  let faviconRevisions = new Map<string, number>()
  let findResults: Record<string, FindResult> = {}
  let permissions = new Map<string, PendingPermission>()
  let permissionGrants = new Map<string, boolean>()
  let downloads: Download[] = []
  let downloadItems = new Map<string, DownloadItem>()
  let downloadPaths = new Set<string>()
  let focusedClientId: string | null = null
  let pointerTarget: { clientId: string; paneId: string; expires: number; origin: { x: number; y: number } } | undefined
  let overlays = new Set<string>()
  let automatedContents = new Set<number>()
  let visualQueue: Promise<void> = Promise.resolve()
  let tabQueues = new Map<string, Promise<unknown>>()
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let publishTimer: ReturnType<typeof setTimeout> | undefined
  let shuttingDown = false
  let prefixUntil = 0
  let pendingSequence: { key: string; clientId: string; contentsId: number; expires: number } | undefined
  let pendingModifierShortcut: { binding: Shortcut; clientId: string; code: string; contentsId: number } | undefined
  let legacyPrefix: string | undefined
  let configuration: ReturnType<typeof createConfig> | undefined
  let filters: ReturnType<typeof createRequestFilters> | undefined
  let savedForms: ReturnType<typeof createSavedForms> | undefined
  let pageTools: ReturnType<typeof createPageTools> | undefined
  let browserSettings = () => configuration?.browser ?? DEFAULT_BROWSER
  let toolsState = (): BrowserToolsState | undefined => filters ? {
    defaults: { adblock: browserSettings().adblock, darkMode: browserSettings().darkMode },
    filters: filters.status(), scripts: pageTools?.list() ?? [],
    tabs: Object.fromEntries([...tabs].map(([tabId, live]) => {
      let url = live.contents.isDestroyed() ? '' : live.contents.getURL()
      let { pane } = tabById(model, tabId)
      return [tabId, { origin: pageOrigin(url), error: pageTools?.error(tabId), profileDefaults: siteSettings(browserSettings(), pane.profileId, ''), ...siteSettings(browserSettings(), pane.profileId, url), ...filters!.counts(tabId) }]
    })),
  } : undefined
  let plugins: ReturnType<typeof createPlugins> | undefined
  let documents = new Map<string, number>()
  let pluginContext = (target: PluginContext): PluginContext => {
    let client = target.clientId ? model.clients.find(client => client.id === target.clientId) : undefined
    let tabId = target.tabId ?? (client?.paneId ? paneById(model, client.paneId).pane.activeTabId : undefined)
    if (!tabId) return { clientId: client?.id }
    let { tab, pane, window, session } = tabById(model, tabId)
    let contents = tabs.get(tabId)?.contents
    return { clientId: target.clientId, sessionId: session.id, windowId: window.id, paneId: pane.id, profileId: pane.profileId, tabId: tab.id, documentId: `${tabId}:${documents.get(tabId) ?? 0}`, url: contents?.isDestroyed() === false ? contents.getURL() : tab.url }
  }
  let pluginSelected = (context: PluginContext) => {
    let client = model.clients.find(client => client.id === context.clientId)
    if (!client || client.windowId !== context.windowId || client.paneId !== context.paneId) return false
    return !!client.paneId && paneById(model, client.paneId).pane.activeTabId === context.tabId
  }
  let pluginInteractive = (context: PluginContext) => pluginSelected(context) && context.clientId === focusedClientId && clients.get(context.clientId!)?.window.isFocused() === true
  let accessibilityPreference = false
  let visualScheduled = false
  let snapshotPending = new Set<string>()
  let settingsFile = path.join(dataDirectory, 'settings.json')
  let grantFile = path.join(dataDirectory, 'permissions.json')
  let readSettings = async () => {
    try { let settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); if (typeof settings.prefixKey === 'string') legacyPrefix = `Ctrl+${settings.prefixKey.toUpperCase()}` } catch { /* Defaults on first launch. */ }
    try { permissionGrants = new Map(JSON.parse(await fs.readFile(grantFile, 'utf8'))) } catch { /* Default deny until requested. */ }
  }
  let settingsReady = readSettings()

  let state = (clientId = ''): PublicState => ({ findResults, browserTools: toolsState(), plugins: plugins?.list(), pluginRuns: plugins?.runs(), pluginPrompt: clientId ? plugins?.prompt(clientId) : undefined, model, clientId, focusedClientId, snapshots, crashes, loading, favicons, pendingUrls: Object.fromEntries([...tabs].flatMap(([tabId, live]) => live.pendingUrl ? [[tabId, live.pendingUrl]] : [])), keyboard: configuration?.keyboard ?? DEFAULT_KEYBOARD, configPath: configuration?.path ?? configPath(dataDirectory), configError: configuration?.error ?? null, accessibility: configuration?.accessibility ?? false, statusBar: configuration?.statusBar ?? 'top', showTabCloseButtons: configuration?.showTabCloseButtons ?? false, permissions: [...permissions.values()].map(({ reply: _reply, ...request }) => request), downloads })
  let updatePermissionPopup = (clientId: string, live: LiveClient, current: PublicState) => {
    live.dismissedPermissions = new Set([...live.dismissedPermissions].filter(id => permissions.has(id)))
    let pending = current.permissions.filter(request => !live.dismissedPermissions.has(request.id))
    let visible = pending.length > 0 && focusedClientId === clientId && !overlays.has(clientId) && !current.pluginPrompt
    live.permissionPopup.webContents.send('state', { ...current, permissions: visible ? pending : [] })
    if (!visible) {
      if (live.permissionPopup.webContents.isFocused() && live.window.isFocused()) {
        let client = model.clients.find(client => client.id === clientId)
        let tab = client?.paneId ? tabs.get(paneById(model, client.paneId).pane.activeTabId) : undefined
        if (tab?.parent === live.window && !overlays.has(clientId)) tab.contents.focus()
        else live.chrome.webContents.focus()
      }
      live.permissionPopup.setVisible(false)
      return
    }
    let bounds = live.window.getContentBounds()
    let width = Math.min(340, bounds.width - 24), y = current.statusBar === 'bottom' ? 40 : 68
    live.permissionPopup.setBounds({ x: bounds.width - width - 12, y, width, height: Math.min(210, bounds.height - y - 40) })
    if (live.window.contentView.children.at(-1) !== live.permissionPopup) live.window.contentView.addChildView(live.permissionPopup)
    live.permissionPopup.setVisible(true)
  }
  let updateLinkPreview = (clientId: string, live: LiveClient) => {
    let client = model.clients.find(client => client.id === clientId)
    let target = live.linkTabId ? walkPanes(model).find(({ pane }) => pane.tabs.some(tab => tab.id === live.linkTabId)) : undefined
    let bounds = live.linkTabId ? live.bounds.find(bounds => bounds.tabId === live.linkTabId) : undefined
    let page = live.linkTabId ? tabs.get(live.linkTabId) : undefined
    let visible = !!live.linkUrl && !!client && !overlays.has(clientId) && page?.parent === live.window && target?.session.id === client.sessionId && target.window.id === client.windowId && target.pane.activeTabId === live.linkTabId && !!bounds
    if (!visible || !bounds) { live.linkPreview.setVisible(false); return }
    live.linkPreview.webContents.send('link-preview', live.linkUrl)
    live.linkPreview.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y + bounds.height - 26), width: Math.max(1, Math.min(520, Math.round(bounds.width))), height: 26 })
    if (live.window.contentView.children.at(-1) !== live.linkPreview) live.window.contentView.addChildView(live.linkPreview)
    live.linkPreview.setVisible(true)
  }
  let publish = () => {
    if (publishTimer || shuttingDown) return
    publishTimer = setTimeout(() => {
      publishTimer = undefined
      for (let [clientId, live] of clients) if (!live.chrome.webContents.isDestroyed()) {
        let current = state(clientId)
        live.chrome.webContents.send('state', current)
        updatePermissionPopup(clientId, live, current)
        updateLinkPreview(clientId, live)
      }
    }, 30)
  }
  let save = () => {
    for (let session of model.sessions) for (let window of session.windows) {
      let viewers = model.clients.filter(client => client.windowId === window.id)
      let viewer = viewers.find(client => client.id === focusedClientId) ?? viewers[0]
      updateAutomaticWindowName(window, viewer?.paneId ?? undefined)
    }
    plugins?.reconcile()
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
    void extensions.attach(profileId, session).catch(() => undefined)
    filters?.attach(session, profileId)
    session.setPermissionCheckHandler((_contents, permission, origin) => permissionGrants.get(`${profileId}|${origin}|${permission}`) === true)
    session.setPermissionRequestHandler((contents, permission, reply, details) => {
      let origin = details.requestingUrl ? new URL(details.requestingUrl).origin : new URL(contents.getURL()).origin
      let key = `${profileId}|${origin}|${permission}`
      let known = permissionGrants.get(key)
      if (known !== undefined) { reply(known); return }
      let tabId = [...tabs].find(([, live]) => live.contents.id === contents.id)?.[0] ?? ''
      let request = { id: id('permission'), profileId, origin, permission, tabId, reply }
      permissions.set(request.id, request)
      publish()
    })
    session.on('will-download', (_event, item) => {
      let requestedName = path.basename(item.getFilename())
      let extension = path.extname(requestedName)
      let stem = requestedName.slice(0, requestedName.length - extension.length)
      let directory = app.getPath('downloads')
      let target = path.join(directory, requestedName)
      for (let index = 1; fsSync.existsSync(target) || downloadPaths.has(target); index++) target = path.join(directory, `${stem} (${index})${extension}`)
      let record: Download = { id: id('download'), profileId, name: path.basename(target), path: target, state: 'progressing', received: 0, total: item.getTotalBytes(), paused: false, canResume: false, active: true }
      // Avoid a Save As dialog activating the application during bot work.
      item.setSavePath(target)
      downloadPaths.add(target)
      downloads.unshift(record)
      downloadItems.set(record.id, item)
      downloads = downloads.filter((entry, index) => entry.active || index < 100)
      let update = () => {
        record.received = item.getReceivedBytes(); record.total = item.getTotalBytes()
        record.paused = record.active && item.isPaused(); record.canResume = record.active && item.canResume()
      }
      item.on('updated', (_event, status) => { record.state = status; update(); publish() })
      item.once('done', (_event, status) => {
        record.state = status; record.active = false; update()
        downloadItems.delete(record.id); downloadPaths.delete(target); publish()
      })
      publish()
    })
    return session
  }
  let cdp = async (tabId: string, method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    let live = tabs.get(tabId)
    if (!live || live.contents.isDestroyed()) throw new Error(`Tab ${tabId} is closed`)
    let debuggerApi = live.contents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    return debuggerApi.sendCommand(method, params, sessionId)
  }
  let scrollTab = (tabId: string, action: string) => {
    if (!['scroll-up', 'scroll-down', 'scroll-half-up', 'scroll-half-down', 'scroll-top', 'scroll-bottom'].includes(action)) throw new Error(`Unknown scroll action: ${action}`)
    let live = tabs.get(tabId)
    if (!live || live.contents.isDestroyed()) return
    if (action === 'scroll-top' || action === 'scroll-bottom') {
      let keyCode = action === 'scroll-top' ? 'Home' : 'End'
      live.contents.sendInputEvent({ type: 'keyDown', keyCode })
      live.contents.sendInputEvent({ type: 'keyUp', keyCode })
    } else {
      let bounds = live.view.getBounds()
      let amount = action.includes('half') ? Math.round(bounds.height / 2) : 100
      let deltaY = action.endsWith('down') ? -amount : amount
      live.contents.sendInputEvent({ type: 'mouseWheel', x: Math.round(bounds.width / 2), y: Math.round(bounds.height / 2), deltaY, hasPreciseScrollingDeltas: true, canScroll: true })
    }
  }
  let dispatchShortcut = (action: string) => {
    let client = model.clients.find(client => client.id === focusedClientId)
    if (!client || automatedContents.has(webContents.getFocusedWebContents()?.id ?? -1)) return
    let focused = clients.get(client.id)!
    let pane = client.paneId ? paneById(model, client.paneId).pane : undefined
    let tab = pane?.activeTabId
    let control = (name: string) => { pointerTarget = undefined; focused.chrome.webContents.focus(); focused.chrome.webContents.send('focus-control', name) }
    if (action === 'prefix') { prefixUntil = Date.now() + (configuration?.keyboard.prefixTimeoutMs ?? 1600); return }
    if ((action === 'toggle-dark' || action === 'toggle-adblock') && tab) { void execute({ method: 'browser.set', args: { tab, setting: action === 'toggle-dark' ? 'darkMode' : 'adblock', value: 'toggle' } }).catch(reportError); return }
    if (action.startsWith('plugin:')) { try { plugins?.run(action.slice(7), { clientId: client.id }, {}, true) } catch (error) { reportError(error) }; return }
    if (action === 'close-pane') {
      void execute({ method: pane ? 'kill-pane' : 'kill-window', args: { pane: pane?.id, window: client.windowId, confirm: true } }).catch(reportError); return
    }
    if (action === 'close-window') {
      let session = model.sessions.find(session => session.id === client.sessionId)!
      let window = session.windows.find(window => window.id === client.windowId)!
      let behavior = windowCloseBehavior(session, window)
      if (behavior === 'close-window') { void execute({ method: 'kill-window', args: { window: window.id, confirm: true } }).catch(reportError); return }
    }
    if (['browser-tools', 'plugins', 'address', 'command', 'find', 'help', 'sessions', 'bookmark', 'bookmarks', 'history', 'activity', 'downloads', 'profiles', 'settings', 'rename-window', 'rename-session', 'close-pane', 'close-window'].includes(action)) { control(action); return }
    if (action === 'new-client') { void createClient(client.sessionId).catch(reportError); return }
    if (['reload', 'hard-reload', 'stop', 'back', 'forward'].includes(action) && tab) { void execute({ method: action, args: { tab } }).catch(reportError); return }
    if (action.startsWith('scroll-') && tab) { scrollTab(tab, action); return }
    if (action.startsWith('zoom-') && tab) {
      let current = tabById(model, tab).tab.zoom
      void execute({ method: 'zoom', args: { tab, factor: action === 'zoom-reset' ? 1 : current + (action === 'zoom-in' ? .1 : -.1) } }).catch(reportError); return
    }
    let windowNumber = action.match(/^select-window-([1-9])$/)?.[1]
    let line = action === 'split-right' ? 'split-window -h' : action === 'split-down' ? 'split-window -v' : windowNumber ? `select-window -t ${windowNumber}` : action
    let command = parseCommandLine(line, state(client.id))
    if (command.method === 'select-pane-direction' || command.method === 'cycle-pane') command.args = { ...command.args, movePointer: true }
    void execute(command).catch(reportError)
  }
  let closeFocusedWindow = () => {
    let focused = [...clients.values()].find(client => client.window.isFocused()) ?? (focusedClientId ? clients.get(focusedClientId) : undefined)
    focused?.window.close()
  }
  let refreshMenu = () => {
    let keyboard = configuration?.keyboard ?? DEFAULT_KEYBOARD
    let items = Object.entries(keyboard.shortcuts).filter(([key]) => key !== 'Escape' && !isModifierKeyBinding(key)).map(([key, binding]) => ({ label: shortcutAction(binding), accelerator: shortcutWhen(binding) === 'always' ? key : undefined, click: () => dispatchShortcut(shortcutAction(binding)) }))
    let nativeWindowItems = process.platform === 'darwin' ? [{ id: 'close-system-window', label: 'Close System Window', click: closeFocusedWindow }, { type: 'separator' as const }] : []
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'bmux', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Browser', submenu: [...nativeWindowItems, { label: 'Command prefix', accelerator: keyboard.prefix, click: () => dispatchShortcut('prefix') }, ...items] },
      // Only unconditional accelerators take precedence over native menu defaults.
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]))
  }
  let refreshSettings = () => {
    pendingSequence = undefined
    filters?.refresh()
    pageTools?.reload()
    plugins?.reload()
    refreshMenu()
    if (configuration && configuration.accessibility !== accessibilityPreference) {
      accessibilityPreference = configuration.accessibility
      app.setAccessibilitySupportEnabled(accessibilityPreference)
    }
    publish()
  }
  let matchesContext = (binding: Shortcut, contents: WebContents) => {
    let client = model.clients.find(client => client.id === focusedClientId)
    let owner = client ? clients.get(client.id) : undefined
    let pane = client?.paneId ? paneById(model, client.paneId).pane : undefined
    let live = pane?.activeTabId ? tabs.get(pane.activeTabId) : undefined
    let paneFocused = !!owner?.window.isFocused() && contents.isFocused() && live?.contents === contents && live?.parent === owner.window && !overlays.has(client!.id)
    return shortcutMatchesContext(binding, paneFocused, paneFocused ? pageTools?.editing(pane!.activeTabId!) : undefined)
  }
  let installKeys = (contents: WebContents) => {
    contents.on('before-input-event', (event, input) => {
      if (!focusedClientId) return
      if (automatedContents.has(contents.id)) { contents.setIgnoreMenuShortcuts(true); return }
      contents.setIgnoreMenuShortcuts(false)
      let focused = clients.get(focusedClientId)
      if (!focused || (focused.chrome.webContents !== contents && focused.permissionPopup.webContents !== contents && ![...tabs.values()].some(tab => tab.contents === contents && tab.parent === focused.window))) return
      if (pendingModifierShortcut && (pendingModifierShortcut.clientId !== focusedClientId || pendingModifierShortcut.contentsId !== contents.id)) pendingModifierShortcut = undefined
      let keyboard = configuration?.keyboard ?? DEFAULT_KEYBOARD
      let modifierKey = ['ShiftLeft', 'ShiftRight'].includes(input.code)
      if (modifierKey && input.type === 'keyDown') {
        let entry = Object.entries(keyboard.shortcuts).find(([key]) => isModifierKeyBinding(key) && matchesBinding(key, input))
        pendingModifierShortcut = entry && matchesContext(entry[1], contents) ? { binding: entry[1], clientId: focusedClientId, code: input.code, contentsId: contents.id } : undefined
        return
      }
      if (modifierKey && input.type === 'keyUp') {
        let binding = pendingModifierShortcut?.code === input.code ? pendingModifierShortcut.binding : undefined
        pendingModifierShortcut = undefined
        if (binding && matchesContext(binding, contents)) dispatchShortcut(shortcutAction(binding))
        return
      }
      if (pendingModifierShortcut && input.type === 'keyDown') pendingModifierShortcut = undefined
      if (input.type !== 'keyDown' || ['Shift', 'Control', 'Meta', 'Alt', 'CapsLock'].includes(input.key)) return
      // The page can regain focus while a renderer control remains open. Let the
      // website receive Escape, but also give the renderer a chance to dismiss it.
      if (input.key === 'Escape' && contents !== focused.chrome.webContents) focused.chrome.webContents.send('focus-control', 'dismiss')
      if (matchesBinding(keyboard.prefix, input)) { event.preventDefault(); dispatchShortcut('prefix'); return }
      if (Date.now() < prefixUntil) {
        prefixUntil = 0
        let action = keyboard.prefixBindings[input.key]
        if (action) dispatchShortcut(action)
        event.preventDefault(); return
      }
      let sequenceKey = !input.meta && !input.control && !input.alt && !input.shift && /^[a-z]$/i.test(input.key) ? input.key.toLowerCase() : ''
      if (pendingSequence) {
        let pending = pendingSequence
        pendingSequence = undefined
        if (pending.clientId === focusedClientId && pending.contentsId === contents.id && pending.expires > Date.now()) {
          let binding = keyboard.sequences[pending.key + sequenceKey]
          if (binding && matchesContext(binding, contents)) { event.preventDefault(); dispatchShortcut(shortcutAction(binding)); return }
        }
      }
      if (sequenceKey && Object.entries(keyboard.sequences).some(([key, binding]) => key.startsWith(sequenceKey) && matchesContext(binding, contents))) {
        pendingSequence = { key: sequenceKey, clientId: focusedClientId, contentsId: contents.id, expires: Date.now() + keyboard.prefixTimeoutMs }
        event.preventDefault(); return
      }
      let entry = Object.entries(keyboard.shortcuts).find(([key]) => matchesBinding(key, input))
      if (!entry || !matchesContext(entry[1], contents) || (shortcutAction(entry[1]) === 'stop' && contents === focused.chrome.webContents)) return
      // Escape must also reach websites so they can dismiss dialogs and overlays.
      if (input.key !== 'Escape' || shortcutAction(entry[1]) !== 'stop') event.preventDefault()
      dispatchShortcut(shortcutAction(entry[1]))
    })
    contents.on('before-mouse-event', (event, mouse) => {
      if (!automatedContents.has(contents.id) && mouse.type === 'mouseDown') pointerTarget = undefined
      // Electron emits back/forward here, although its input types only list three buttons.
      let button = String(mouse.button)
      if (!['back', 'forward'].includes(button) || automatedContents.has(contents.id)) return
      let owner = [...clients.values()].find(client => client.window.isFocused() && (client.chrome.webContents === contents || [...tabs.values()].some(tab => tab.contents === contents && tab.parent === client.window)))
      if (!owner) return
      let tabId = [...tabs].find(([, tab]) => tab.contents === contents)?.[0]
      if (!tabId) {
        let client = model.clients.find(client => clients.get(client.id) === owner)
        tabId = client?.paneId ? paneById(model, client.paneId).pane.activeTabId : undefined
      }
      if (!tabId) return
      event.preventDefault()
      if (mouse.type === 'mouseUp') void execute({ method: button, args: { tab: tabId } }).catch(reportError)
    })
  }
  let reportError = (error: unknown) => { console.error(`bmux: ${errorText(error)}`) }
  let createLiveTab = (tabId: string, load = true, popupOptions?: Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }) => {
    let { tab, pane, session } = tabById(model, tabId)
    let initialUrl = tab.url
    let profile = resolve(model.profiles, pane.profileId, 'Profile')
    let view = new WebContentsView({ ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}), webPreferences: { ...popupOptions?.webPreferences, session: browserSession(pane.profileId), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !profile.background, disableDialogs: true } })
    let parent = parkHost(pane.profileId)
    parent.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
    let contents = view.webContents
    let live: LiveTab = { view, contents, parent, disposed: false }
    tabs.set(tabId, live)
    faviconRevisions.set(tabId, 0)
    extensions.track(pane.profileId, contents, parent)
    let bootstrapping = !popupOptions
    let ready = Promise.all([extensions.attach(pane.profileId, contents.session), pageTools?.attach(tabId, pane.profileId, contents, !popupOptions)]).finally(() => { bootstrapping = false })
    let internalBootstrap = () => bootstrapping && initialUrl !== 'about:blank' && contents.getURL() === 'about:blank'
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { filters?.reset(tabId); delete findResults[tabId]; delete favicons[tabId]; faviconRevisions.set(tabId, (faviconRevisions.get(tabId) ?? 0) + 1); publish() } })
    contents.on('found-in-page', (_event, result) => {
      let current = findResults[tabId]
      if (live.disposed || current?.requestId !== result.requestId) return
      findResults[tabId] = { ...current, matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal, finalUpdate: result.finalUpdate }
      publish()
    })
    contents.on('render-process-gone', () => { delete findResults[tabId] })
    let invalidate = () => { documents.set(tabId, (documents.get(tabId) ?? 0) + 1); plugins?.invalidate(tabId) }
    contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) invalidate() })
    contents.on('dom-ready', () => { if (!live.disposed && !internalBootstrap()) plugins?.hook('page-ready', pluginContext({ tabId })) })
    contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame && !live.disposed) plugins?.hook('url-change', pluginContext({ tabId })) })
    contents.once('destroyed', () => {
      if (live.disposed || shuttingDown || tabs.get(tabId) !== live) return
      let { tab, pane, window } = tabById(model, tabId)
      if (tab.openerTabId && pane.tabs.length === 1 && window.panes.length === 1) void execute({ method: 'kill-window', args: { window: window.id, confirm: true } }).catch(reportError)
      else void execute({ method: 'tab.close', args: { tab: tab.id } }).catch(reportError)
    })
    contents.on('render-process-gone', () => { invalidate() })
    contents.setZoomFactor(tab.zoom || 1)
    installKeys(contents)
    let update = () => {
      if (live.disposed || contents.isDestroyed() || internalBootstrap()) return
      tab.url = contents.getURL() || tab.url
      tab.title = contents.getTitle() || (tab.url === 'about:blank' ? 'New tab' : tab.url)
      if (/^https?:\/\//.test(tab.url)) {
        let profile = model.profiles.find(profile => profile.id === pane.profileId)!
        profile.history = [{ url: tab.url, title: tab.title, visitedAt: Date.now() }, ...(profile.history ?? []).filter(entry => entry.url !== tab.url)].slice(0, 1000)
      }
      save()
      void scheduleVisuals()
    }
    contents.on('did-start-loading', () => { loading[tabId] = true; publish() })
    contents.on('did-stop-loading', () => { delete loading[tabId]; publish() })
    contents.on('page-favicon-updated', (_event, urls) => {
      let iconUrl = urls.find(url => /^https?:\/\//i.test(url) || /^data:image\//i.test(url))
      if (!iconUrl) return
      let revision = faviconRevisions.get(tabId)
      void (async () => {
        let icon: string
        if (iconUrl.startsWith('data:')) {
          if (iconUrl.length > 180000) return
          icon = iconUrl
        } else {
          let response = await contents.session.fetch(iconUrl)
          let mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
          if (!response.ok || !mime || !/^image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(mime)) return
          if (Number(response.headers.get('content-length') ?? 0) > 128 * 1024) return
          let reader = response.body?.getReader()
          if (!reader) return
          let chunks: Buffer[] = [], size = 0
          while (true) {
            let part = await reader.read()
            if (part.done) break
            size += part.value.byteLength
            if (size > 128 * 1024) { await reader.cancel(); return }
            chunks.push(Buffer.from(part.value))
          }
          if (!size) return
          icon = `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`
        }
        if (live.disposed || faviconRevisions.get(tabId) !== revision) return
        favicons[tabId] = icon
        publish()
      })().catch(() => undefined)
    })
    contents.on('page-title-updated', update)
    contents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type === 'mouseDown') {
        let owner = [...clients.values()].find(client => client.window === live.parent)
        if (owner) { owner.chrome.webContents.send('focus-control', 'dismiss') }
      }
    })
    contents.on('focus', () => {
      let client = model.clients.find(client => client.id === focusedClientId)
      if (client && live.parent === clients.get(client.id)?.window && visiblePaneIds(client).includes(pane.id)) {
        clients.get(client.id)!.pageFocused = true
        if (client.paneId !== pane.id) { client.paneId = pane.id; save() }
      }
    })
    contents.on('did-navigate', update)
    contents.on('did-navigate-in-page', update)
    contents.on('did-finish-load', () => { delete crashes[tabId]; update() })
    contents.on('render-process-gone', (_event, details) => { crashes[tabId] = `Page process ${details.reason}. Reload to recover.`; publish(); void scheduleVisuals() })
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { crashes[tabId] = description; publish(); void scheduleVisuals() } })
    let openLinkWindow = (url: string, activate: boolean, options?: Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }, loadOptions?: Electron.LoadURLOptions) => {
      let created = newWindow(`window-${session.windows.length + 1}`, pane.profileId, true)
      let added = created.panes[0].tabs[0]
      added.openerTabId = tabId
      if (!options) { added.url = url; added.title = url }
      session.windows.push(created)
      let owner = model.clients.find(client => client.id === focusedClientId && visiblePaneIds(client).includes(pane.id))
      if (activate && owner) { owner.sessionId = session.id; owner.windowId = created.id; owner.paneId = created.panes[0].id }
      if (!options) { changed(); return undefined }
      let popup = createLiveTab(added.id, false, options)
      if (!options.webContents) void popup.contents.loadURL(url, loadOptions).catch(reportError)
      changed()
      return popup.contents
    }
    contents.setWindowOpenHandler(details => ({
      action: 'allow', outlivesOpener: true,
      createWindow: options => openLinkWindow(details.url, details.disposition !== 'background-tab', options as Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }, { httpReferrer: details.referrer, ...(details.postBody ? { postData: details.postBody.data, extraHeaders: `content-type: ${details.postBody.contentType}` } : {}) })!,
    }))
    contents.on('update-target-url', (_event, url) => {
      let owner = [...clients.values()].find(client => client.window === live.parent)
      if (!owner) return
      owner.linkUrl = url
      owner.linkTabId = url ? tabId : undefined
      owner.linkPreview.webContents.send('link-preview', url)
      publish()
    })
    contents.on('context-menu', (event, params) => {
      event.preventDefault()
      let owner = [...clients.values()].find(client => client.window === live.parent)
      if (!owner) return
      if (params.linkURL && params.frame && !params.frame.isDestroyed()) {
        void params.frame.executeJavaScript('globalThis.getSelection()?.removeAllRanges()').catch(reportError)
      }
      let navigation = contents.navigationHistory
      let template: Electron.MenuItemConstructorOptions[] = []
      if (params.linkURL) template.push(
        { label: 'Open Link in New bmux Window', click: () => { openLinkWindow(params.linkURL, true) } },
        { label: 'Open Link in Background bmux Window', click: () => { openLinkWindow(params.linkURL, false) } },
        { label: 'Open Link in This Tab', click: () => { void contents.loadURL(params.linkURL).catch(reportError) } },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      )
      template.push(
        { label: 'Back', enabled: navigation.canGoBack(), click: () => navigation.goBack() },
        { label: 'Forward', enabled: navigation.canGoForward(), click: () => navigation.goForward() },
        { label: 'Reload', click: () => contents.reload() },
      )
      if (params.selectionText || params.isEditable) template.push(
        { type: 'separator' },
        ...(params.isEditable ? [{ role: 'cut' as const }, { role: 'paste' as const }] : []),
        { role: 'copy' },
        { role: 'selectAll' },
      )
      Menu.buildFromTemplate(template).popup({ window: owner.window })
    })
    if (load && initialUrl !== 'about:blank') void ready.then(() => { if (!live.disposed) return contents.loadURL(initialUrl) }).catch(error => { if (!live.disposed && error?.code !== 'ERR_ABORTED' && error?.errno !== -3) { crashes[tabId] = errorText(error); publish() } })
    return live
  }
  let keepClientFocus = (live: LiveTab) => {
    if (!live.parent.isDestroyed() && live.parent.isFocused() && !live.contents.isDestroyed() && live.contents.isFocused()) {
      let client = [...clients.values()].find(client => client.window === live.parent)
      client?.chrome.webContents.focus()
    }
  }
  let disposeTab = (tabId: string) => {
    pageTools?.dispose(tabId)
    filters?.reset(tabId)
    documents.set(tabId, (documents.get(tabId) ?? 0) + 1); plugins?.invalidate(tabId)
    let live = tabs.get(tabId)
    if (live) {
      keepClientFocus(live)
      live.disposed = true
      let destroyed = live.contents.isDestroyed()
      if (!destroyed && !live.parent.isDestroyed()) live.parent.contentView.removeChildView(live.view)
      if (!destroyed) live.contents.close({ waitForBeforeUnload: false })
      tabs.delete(tabId)
    }
    for (let [requestId, request] of permissions) if (request.tabId === tabId) { request.reply(false); permissions.delete(requestId) }
    delete snapshots[tabId]
    delete crashes[tabId]
    delete loading[tabId]
    delete favicons[tabId]
    faviconRevisions.delete(tabId)
    delete findResults[tabId]
  }
  let visiblePaneIds = (client: Client) => model.sessions.find(session => session.id === client.sessionId)?.windows.find(window => window.id === client.windowId)?.panes.map(pane => pane.id) ?? []
  let moveView = (live: LiveTab, parent: BaseWindow) => {
    if (live.parent === parent || live.disposed) return
    // Keep the native client's first responder valid when parking its focused page.
    // Reparenting a focused view directly into a hidden host can resign the client.
    keepClientFocus(live)
    if (!live.parent.isDestroyed()) live.parent.contentView.removeChildView(live.view)
    parent.contentView.addChildView(live.view)
    live.parent = parent
  }
  let requestPreview = (tabId: string, live: LiveTab) => {
    // Preview work must never hold up detaching or attaching native views.
    if (loading[tabId] || tabQueues.has(tabId) || snapshotPending.has(tabId)) return
    snapshotPending.add(tabId)
    let url = live.contents.getURL()
    void Promise.race([
      cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 65, fromSurface: true, captureBeyondViewport: false }),
      sleep(800).then(() => { throw new Error('Preview capture timed out') }),
    ]).then(result => {
      if (result.data && tabs.get(tabId) === live && !live.contents.isDestroyed() && live.contents.getURL() === url) {
        snapshots[tabId] = { image: `data:image/jpeg;base64,${result.data}`, capturedAt: Date.now() }; publish()
      }
    }).catch(() => undefined).finally(() => snapshotPending.delete(tabId))
  }
  let reconcile = () => {
    if (shuttingDown) return
    let liveIds = new Set(walkPanes(model).flatMap(({ pane }) => pane.tabs.map(tab => tab.id)))
    for (let tabId of tabs.keys()) if (!liveIds.has(tabId)) disposeTab(tabId)
    for (let tabId of liveIds) if (!tabs.has(tabId)) createLiveTab(tabId)
    let client = model.clients.find(client => client.id === focusedClientId)
    let owner = client && !overlays.has(client.id) ? clients.get(client.id) : undefined
    let viewers = new Map<string, { id: string; live: LiveClient; bounds: Bounds }[]>()
    for (let candidate of model.clients) {
      let live = clients.get(candidate.id)
      if (!live || !live.window.isVisible() || live.window.isMinimized() || overlays.has(candidate.id)) continue
      for (let paneId of visiblePaneIds(candidate)) {
        let tabId = paneById(model, paneId).pane.activeTabId
        let bounds = live.bounds.find(bounds => bounds.tabId === tabId)
        if (!bounds) continue
        let entries = viewers.get(tabId) ?? []
        entries.push({ id: candidate.id, live, bounds }); viewers.set(tabId, entries)
      }
    }
    for (let [tabId, live] of tabs) {
      let candidates = viewers.get(tabId) ?? []
      // Focus chooses between competing viewers; losing focus alone keeps the
      // native page in its current visible window, including other sessions.
      let viewer = candidates.find(candidate => candidate.id === focusedClientId)
        ?? candidates.find(candidate => candidate.live.window === live.parent)
        ?? candidates[0]
      let bounds = viewer?.bounds
      // The first navigation needs a native focus target before its URL commits.
      let target = viewer && !crashes[tabId] && (tabById(model, tabId).tab.url !== 'about:blank' || live.pendingNavigation) ? viewer.live.window : parkHost(tabById(model, tabId).pane.profileId)
      if (live.parent !== target && [...clients.values()].some(client => client.window === live.parent)) requestPreview(tabId, live)
      if (live.disposed) continue
      moveView(live, target)
      extensions.track(tabById(model, tabId).pane.profileId, live.contents, live.parent, client?.paneId === tabById(model, tabId).pane.id && tabById(model, tabId).pane.activeTabId === tabId)
      if (target === viewer?.live.window && bounds) live.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) })
    }
    if (pointerTarget) {
      let cursor = screen.getCursorScreenPoint()
      if (!client || client.id !== pointerTarget.clientId || client.paneId !== pointerTarget.paneId || Date.now() > pointerTarget.expires || cursor.x !== pointerTarget.origin.x || cursor.y !== pointerTarget.origin.y) pointerTarget = undefined
      else if (owner?.window.isFocused()) {
        let pane = paneById(model, client.paneId).pane
        let bounds = owner.bounds.find(bounds => bounds.tabId === pane.activeTabId)
        // A zoomed pane's new content bounds arrive from the renderer after selection.
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          pointerTarget = undefined
          let live = tabs.get(pane.activeTabId)
          if (live?.parent === owner.window) live.contents.focus()
          let content = owner.window.getContentBounds()
          try { movePointer({ x: Math.round(content.x + bounds.x + bounds.width / 2), y: Math.round(content.y + bounds.y + bounds.height / 2) }) }
          catch (error) { reportError(error) }
        }
      }
    }
    publish()
  }
  let scheduleVisuals = () => {
    if (!visualScheduled) {
      visualScheduled = true
      visualQueue = Promise.resolve().then(() => { visualScheduled = false; reconcile() }).catch(reportError)
    }
    return visualQueue
  }
  let repairClients = () => repairClientSelections(model)
  let changed = () => { repairClients(); save(); void scheduleVisuals() }
  let createClient = async (sessionId: string, restored?: Client, activate = true) => {
    let session = resolve(model.sessions, sessionId, 'Session')
    let client: Client = restored ?? { id: id('client'), sessionId, windowId: session.windows[0].id, paneId: session.windows[0].panes[0]?.id ?? null, width: 1280, height: 850 }
    if (!restored) model.clients.push(client)
    repairClients()
    let window = new BaseWindow({ title: process.env.BMUX_DEBUG === '1' || process.env.BROWMUX_DEBUG === '1' ? 'bmux Debug' : 'bmux', width: client.width, height: client.height, minWidth: 640, minHeight: 400, show: false, backgroundColor: '#111318', titleBarStyle: 'hidden' })
    window.setWindowButtonVisibility(false)
    let chrome = new WebContentsView({ webPreferences: { preload: path.join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
    window.contentView.addChildView(chrome)
    let permissionPopup = new WebContentsView({ webPreferences: { preload: path.join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
    permissionPopup.setVisible(false)
    window.contentView.addChildView(permissionPopup)
    let linkPreview = new WebContentsView({ webPreferences: { preload: path.join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
    linkPreview.setVisible(false)
    window.contentView.addChildView(linkPreview)
    let resizeChrome = () => { let bounds = window.getContentBounds(); chrome.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }); client.width = bounds.width; client.height = bounds.height; save() }
    let owner: LiveClient = { window, chrome, permissionPopup, linkPreview, linkUrl: '', dismissedPermissions: new Set(), bounds: [], pageFocused: false }
    clients.set(client.id, owner)
    chrome.webContents.on('focus', () => { owner.pageFocused = false })
    resizeChrome()
    window.on('resize', resizeChrome)
    window.on('focus', () => {
      focusedClientId = client.id
      save()
      void scheduleVisuals().then(() => {
        // Reattaching views after a blur can leave AppKit with no web first responder.
        if (window.isDestroyed() || !window.isFocused()) return
        if (webContents.getFocusedWebContents()) return
        let live = client.paneId ? tabs.get(paneById(model, client.paneId).pane.activeTabId) : undefined
        if (owner.pageFocused && live?.parent === window) live.contents.focus()
        else chrome.webContents.focus()
      }).catch(reportError)
    })
    window.on('show', () => { void scheduleVisuals() })
    window.on('hide', () => { void scheduleVisuals() })
    window.on('minimize', () => { void scheduleVisuals() })
    window.on('restore', () => { void scheduleVisuals() })
    window.on('blur', () => { if (focusedClientId === client.id) { focusedClientId = null; pointerTarget = undefined; void scheduleVisuals() } })
    window.on('close', () => {
      // Move browser views out before destroying the client so their native hosts survive.
      for (let [tabId, live] of tabs) if (live.parent === window) moveView(live, parkHost(tabById(model, tabId).pane.profileId))
    })
    window.on('closed', () => {
      clients.delete(client.id)
      if (!chrome.webContents.isDestroyed()) chrome.webContents.close()
      if (!permissionPopup.webContents.isDestroyed()) permissionPopup.webContents.close()
      if (!linkPreview.webContents.isDestroyed()) linkPreview.webContents.close()
      if (focusedClientId === client.id) focusedClientId = null
      if (!shuttingDown) { model.clients = model.clients.filter(item => item.id !== client.id); changed(); if (!clients.size) app.dock?.hide() }
    })
    installKeys(chrome.webContents)
    installKeys(permissionPopup.webContents)
    permissionPopup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    permissionPopup.webContents.on('will-navigate', event => event.preventDefault())
    linkPreview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    linkPreview.webContents.on('will-navigate', event => event.preventDefault())
    chrome.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    chrome.webContents.on('will-navigate', event => event.preventDefault())
    if (process.env.ELECTRON_RENDERER_URL) await Promise.all([chrome.webContents.loadURL(process.env.ELECTRON_RENDERER_URL), permissionPopup.webContents.loadURL(process.env.ELECTRON_RENDERER_URL + '#permissions'), linkPreview.webContents.loadURL(process.env.ELECTRON_RENDERER_URL + '#link-preview')])
    else await Promise.all([chrome.webContents.loadFile(path.join(import.meta.dirname, '../renderer/index.html')), permissionPopup.webContents.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), { hash: 'permissions' }), linkPreview.webContents.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), { hash: 'link-preview' })])
    if (activate) { await app.dock?.show(); app.focus({ steal: true }); window.show(); await focusWindow(window); chrome.webContents.focus() }
    else window.showInactive()
    save()
    return client
  }
  let sourceClient = (contentsId: number) => [...clients].find(([, live]) => (live.chrome.webContents.id === contentsId || live.permissionPopup.webContents.id === contentsId))?.[0]
  let setBounds = (contentsId: number, bounds: Bounds[]) => {
    let clientId = [...clients].find(([, live]) => live.chrome.webContents.id === contentsId)?.[0]
    if (!clientId || !Array.isArray(bounds)) return
    let valid = bounds.filter(bound => ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bound[key as keyof Bounds])))
    clients.get(clientId)!.bounds = valid
    void scheduleVisuals()
  }

  let execute = async ({ method, args = {} }: Command, sourceClientId?: string): Promise<unknown> => {
    if (method === 'search-suggestions') {
      let query = required(args, 'query').slice(0, 200)
      try {
        let response = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(2500) })
        if (!response.ok) return []
        return parseSearchSuggestions(await response.json(), query)
      } catch {
        return []
      }
    }
    if (method.startsWith('extension.')) {
      let tab = typeof args.tab === 'string' ? tabById(model, args.tab) : undefined
      let profile = resolve(model.profiles, args.profile ?? tab?.pane.profileId, 'Profile')
      browserSession(profile.id)
      if (method === 'extension.list') return extensions.list(profile.id)
      if (method === 'extension.load') return extensions.load(profile.id, required(args, 'path'))
      if (method === 'extension.install-bitwarden') {
        let before = await extensions.list(profile.id)
        let installed = await extensions.load(profile.id, await installBitwardenExtension(dataDirectory))
        for (let extension of before.extensions) if (extension.name === installed.name && extension.id !== installed.id) await extensions.remove(profile.id, extension.id)
        return installed
      }
      if (method === 'extension.remove') return extensions.remove(profile.id, required(args, 'id'))
      if (method === 'extension.open') {
        let client = sourceClientId ? model.clients.find(client => client.id === sourceClientId) : undefined
        let pane = client?.paneId ? paneById(model, client.paneId).pane : undefined
        let activeTab = pane?.profileId === profile.id ? tabs.get(pane.activeTabId) : undefined
        return extensions.open(profile.id, required(args, 'id'), !!sourceClientId && sourceClientId === focusedClientId, activeTab && { contents: activeTab.contents, parent: activeTab.parent })
      }
      throw new Error('Unknown extension command')
    }
    if (method.startsWith('forms.')) {
      if (!savedForms) throw new Error('Saved forms are not ready')
      let context = (args._formsContext as PluginContext | undefined) ?? pluginContext({ tabId: required(args, 'tab') })
      return savedForms(method, args, context, (args._formsSignal as AbortSignal | undefined) ?? new AbortController().signal)
    }
    if (method === 'plugin.enable') {
      let id = required(args, 'id')
      if (!configuration || !plugins?.list().some(plugin => plugin.id === id) || typeof args.enabled !== 'boolean') throw new Error('Plugin and enabled flag required')
      configuration.update(['plugins', id, 'enabled'], args.enabled); return plugins.list()
    }
    if (method === 'browser.status') return toolsState()
    if (method === 'bookmark.add') {
      let { tab, pane } = tabById(model, required(args, 'tab'))
      let profile = resolve(model.profiles, pane.profileId, 'Profile')
      let url = tabs.get(tab.id)?.contents.getURL() || tab.url
      if (!/^(https?:|file:)/i.test(url)) throw new Error('Open a web page before bookmarking it')
      let title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : tabs.get(tab.id)?.contents.getTitle().trim() || tab.title || url
      let result = saveBookmark(profile, { url, title, folderId: typeof args.folder === 'string' && args.folder ? args.folder : undefined }, () => id('bookmark'))
      save()
      return result
    }
    if (method === 'bookmark.folder.add') {
      let { pane } = tabById(model, required(args, 'tab'))
      let profile = resolve(model.profiles, pane.profileId, 'Profile')
      let title = required(args, 'title').trim()
      if (!title || title.length > 200) throw new Error('Folder name must be between 1 and 200 characters')
      let result = createBookmarkFolder(profile, { title, parentId: typeof args.parent === 'string' && args.parent ? args.parent : undefined }, () => id('bookmark-folder'))
      save()
      return result
    }
    if (method === 'browser.update-filters') { void filters?.update(); return { updating: true } }
    if (method === 'browser.reload-scripts') { pageTools?.reload(); return pageTools?.list() }
    if (method === 'browser.set') {
      if (!configuration) throw new Error('Configuration is not ready')
      let tabId = required(args, 'tab'), { pane } = tabById(model, tabId)
      let url = tabs.get(tabId)?.contents.getURL() ?? '', origin = pageOrigin(url)
      let setting = required(args, 'setting'), scope = args.scope ?? 'site'
      if (!['adblock', 'darkMode'].includes(setting) || !['site', 'profile', 'global'].includes(String(scope))) throw new Error('Use adblock or darkMode with site, profile, or global scope')
      if (scope === 'site' && !origin) throw new Error('Open an http(s) page first')
      let current = scope === 'global' ? browserSettings() : siteSettings(browserSettings(), pane.profileId, scope === 'profile' ? '' : url)
      let value = args.value === 'toggle' ? setting === 'adblock' ? !current.adblock : current.darkMode === 'dark' ? 'off' : 'dark' : args.value
      let keys = ['browser', ...(scope === 'global' ? [] : ['profiles', pane.profileId]), ...(scope === 'site' ? ['sites', origin] : []), setting]
      configuration.update(keys, value === 'inherit' ? undefined : value)
      return toolsState()
    }
    if (method === 'browser.script') {
      if (!configuration || typeof args.enabled !== 'boolean') throw new Error('Script enabled flag required')
      let index = configuration.browser.userscripts.findIndex(script => script.id === args.id)
      if (index < 0) throw new Error('Userscript not found')
      configuration.update(['browser', 'userscripts', String(index), 'enabled'], args.enabled)
      return pageTools?.list()
    }
    if (method === 'plugin.list') return plugins?.list() ?? []
    if (method === 'plugin.runs') return plugins?.runs() ?? []
    if (method === 'plugin.reload') { plugins?.reload(); return plugins?.list() ?? [] }
    if (method === 'plugin.cancel') return plugins?.cancel(required(args, 'id'))
    if (method === 'plugin.respond') { if (!sourceClientId) throw new Error('Trusted UI required'); return plugins?.respond(sourceClientId, args) }
    if (method === 'plugin.run') {
      if (!plugins) throw new Error('Plugin host unavailable')
      return plugins.run(required(args, 'action'), { clientId: sourceClientId, tabId: typeof args.tab === 'string' ? args.tab : undefined }, (args.parameters ?? {}) as Record<string, unknown>, !!sourceClientId)
    }
    if (method === 'command-line') {
      let command = parseCommandLine(required(args, 'line'), state(required(args, 'client')))
      if (command.method === 'navigate') command.args = { ...command.args, waitUntil: 'none' }
      return execute(command, sourceClientId)
    }
    if (method === 'settings.default-browser') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      if (!app.isPackaged) throw new Error('Use the installed bmux app to set the default browser')
      let http = app.setAsDefaultProtocolClient('http')
      let https = app.setAsDefaultProtocolClient('https')
      if (!http || !https) throw new Error('Could not set bmux as default. Choose bmux in System Settings > Desktop & Dock > Default web browser.')
      return { requested: true }
    }
    if (method === 'settings.reload') { configuration?.reload(); if (configuration?.error) throw new Error(configuration.error); return { path: configuration?.path } }
    if (method === 'scroll') { let tabId = required(args, 'tab'); tabById(model, tabId); scrollTab(tabId, required(args, 'action')); return { tab: tabId } }
    if (method === 'settings.open') { if (!configuration) throw new Error('Configuration is not ready'); let error = await shell.openPath(configuration.path); if (error) throw new Error(error); return { path: configuration.path } }
    if (method === 'focus-ui') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let owner = clients.get(sourceClientId)
      if (sourceClientId === focusedClientId && owner?.window.isFocused()) owner.chrome.webContents.focus()
      return null
    }
    if (method === 'focus-page') {
      let client = resolve(model.clients, args.client, 'Client')
      await visualQueue
      let live = client.paneId ? tabs.get(paneById(model, client.paneId).pane.activeTabId) : undefined
      if (client.id === focusedClientId) {
        let owner = clients.get(client.id)!
        if (live?.parent === owner.window) live.contents.focus()
        else owner.chrome.webContents.focus()
      }
      return null
    }
    if (method === 'state' || method === 'status') return state()
    if (method === 'client.overlay') {
      let client = resolve(model.clients, args.client, 'Client')
      if (args.visible) { overlays.add(client.id) }
      else overlays.delete(client.id)
      await scheduleVisuals(); return { visible: !!args.visible }
    }
    if (method === 'list-sessions') return model.sessions
    if (method === 'list-clients') return model.clients
    if (method === 'import-brave') {
      let imported = importBrave(model, args.source ? required(args, 'source') : braveDirectory())
      let stateFile = path.join(dataDirectory, 'state.json')
      if (fsSync.existsSync(stateFile)) fsSync.copyFileSync(stateFile, path.join(dataDirectory, `state.before-brave-${Date.now()}.json`), fsSync.constants.COPYFILE_EXCL)
      writeModel(dataDirectory, imported.model)
      // Live WebContents callbacks retain these objects. Preserve their identity.
      for (let importedProfile of imported.model.profiles) {
        let existing = model.profiles.find(profile => profile.id === importedProfile.id)
        if (existing) Object.assign(existing, importedProfile)
        else model.profiles.push(importedProfile)
      }
      for (let importedSession of imported.model.sessions) if (!model.sessions.some(session => session.id === importedSession.id)) model.sessions.push(importedSession)
      changed(); await visualQueue
      return { profiles: imported.profiles, bookmarks: imported.profiles.reduce((sum, profile) => sum + profile.bookmarks, 0) }
    }
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
      model.sessions.push(session)
      if (args.client) { let client = resolve(model.clients, args.client, 'Client'); client.sessionId = session.id; client.windowId = session.windows[0].id; client.paneId = session.windows[0].panes[0].id }
      changed(); await visualQueue; return session
    }
    if (method === 'rename-session') {
      let session = resolve(model.sessions, args.session, 'Session')
      let name = required(args, 'name')
      if (model.sessions.some(item => item.id !== session.id && item.name === name)) throw new Error('Session name already exists')
      session.name = name; save(); return session
    }
    if (method === 'kill-session') {
      let session = resolve(model.sessions, args.session, 'Session')
      if (args.confirm !== true) throw new Error('Closing a session requires confirmation; pass --confirm')
      let next = removeSession(model, session)
      changed(); await visualQueue; return { closed: session.id, selected: next.id }
    }
    if (method === 'attach-session') return createClient(resolve(model.sessions, args.session ?? model.sessions[0].id, 'Session').id)
    if (method === 'detach-client') { let client = resolve(model.clients, args.client, 'Client'); clients.get(client.id)?.window.close(); return { detached: client.id } }
    if (method === 'activate-client') {
      let client = resolve(model.clients, args.client, 'Client'), owner = clients.get(client.id)!
      // Re-activating a focused macOS window briefly resigns it and can drop input
      // or cancel a guarded plugin prompt. Preserve its current first responder.
      if (focusedClientId === client.id && owner.window.isFocused()) return client
      await app.dock?.show()
      // Reactivating an already-active app can restore its previous key window
      // after the requested client takes focus. Only activate from outside bmux.
      if (!BaseWindow.getFocusedWindow()) app.focus({ steal: true })
      owner.window.show()
      // AppKit can briefly make the requested window key and then restore the
      // previous key window, especially after another native window closes.
      // Wait for that restoration and retry so the RPC resolves on the window
      // the caller requested rather than during the transient focus event.
      await focusWindow(owner.window)
      owner.chrome.webContents.focus()
      return client
    }
    if (method === 'diagnostics') return { pid: process.pid, accessibilityFeatures: app.getAccessibilitySupportFeatures(), tabs: tabs.size, visibleClients: clients.size, focusedClientId, windows: [...clients].map(([id, live]) => ({ id, nativeId: live.window.id, focused: live.window.isFocused(), visible: live.window.isVisible() })), processes: app.getAppMetrics() }
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
      let automaticName = args.name === undefined
      let window = newWindow(String(args.name ?? `window-${session.windows.length + 1}`), resolve(model.profiles, args.profile ?? session.defaultProfileId, 'Profile').id, automaticName)
      if (args.url) {
        let tab = window.panes[0].tabs[0]
        tab.url = normalizeUrl(String(args.url))
        tab.title = tab.url
      }
      session.windows.push(window)
      if (args.client) { let client = resolve(model.clients, args.client, 'Client'); client.sessionId = session.id; client.windowId = window.id; client.paneId = window.panes[0].id }
      changed(); await visualQueue; return window
    }
    if (method === 'rename-window') { let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window'); window.name = required(args, 'name'); window.automaticName = false; save(); return window }
    if (method === 'move-window') {
      let client = resolve(model.clients, args.client, 'Client')
      let session = resolve(model.sessions, client.sessionId, 'Session')
      let index = session.windows.findIndex(window => window.id === client.windowId)
      let position = args.position
      if (position !== 'first' && position !== 'last') throw new Error('Window position must be first or last')
      let destination = position === 'first' ? 0 : session.windows.length - 1
      if (index === destination) return session.windows[index]
      let [window] = session.windows.splice(index, 1)
      session.windows.splice(destination, 0, window)
      changed(); await visualQueue; return window
    }
    if (method === 'swap-window') {
      let client = resolve(model.clients, args.client, 'Client')
      let session = resolve(model.sessions, client.sessionId, 'Session')
      let index = session.windows.findIndex(window => window.id === client.windowId)
      let direction = Number(args.direction)
      if (![-1, 1].includes(direction)) throw new Error('Window direction must be -1 or 1')
      let destination = (index + direction + session.windows.length) % session.windows.length
      if (destination === index) return session.windows[index]
      let [window] = session.windows.splice(index, 1)
      session.windows.splice(destination, 0, window)
      changed(); await visualQueue; return window
    }
    if (method === 'select-window' || method === 'cycle-window') {
      let client = resolve(model.clients, args.client, 'Client')
      let session = resolve(model.sessions, client.sessionId, 'Session')
      let index = session.windows.findIndex(window => window.id === client.windowId)
      let window = method === 'select-window' ? resolve(session.windows, args.window, 'Window') : session.windows[(index + Number(args.direction ?? 1) + session.windows.length) % session.windows.length]
      client.windowId = window.id; client.paneId = window.panes[0]?.id ?? null
      changed(); await visualQueue; return client
    }
    if (method === 'select-pane' || method === 'cycle-pane' || method === 'select-pane-direction') {
      let client = resolve(model.clients, args.client, 'Client')
      let previousPaneId = client.paneId
      let window = resolve(resolve(model.sessions, client.sessionId, 'Session').windows, client.windowId, 'Window')
      let index = window.panes.findIndex(pane => pane.id === client.paneId)
      if (method === 'select-pane') client.paneId = resolve(window.panes, args.pane, 'Pane').id
      else if (method === 'cycle-pane') client.paneId = window.panes[(index + 1) % window.panes.length]?.id ?? null
      else {
        let direction = required(args, 'direction')
        if (!['left', 'right', 'up', 'down'].includes(direction)) throw new Error(`Unknown pane direction: ${direction}`)
        client.paneId = paneInDirection(window.layout, client.paneId ?? '', direction as 'left' | 'right' | 'up' | 'down') ?? client.paneId
      }
      // A repeated shortcut at a layout edge must not cancel a pending move.
      if (client.paneId !== previousPaneId && pointerTarget?.clientId === client.id) pointerTarget = undefined
      if (client.zoomedPaneId) client.zoomedPaneId = client.paneId
      if (client.id === focusedClientId && client.paneId && args.focus !== false) {
        let pane = paneById(model, client.paneId).pane
        let live = tabs.get(pane.activeTabId), owner = clients.get(client.id)!
        if (live?.parent === owner.window) live.contents.focus()
        else owner.chrome.webContents.focus()
        if (args.movePointer === true && client.paneId !== previousPaneId) pointerTarget = { clientId: client.id, paneId: client.paneId, expires: Date.now() + 1000, origin: screen.getCursorScreenPoint() }
      }
      save(); void scheduleVisuals(); return client
    }
    if (method === 'toggle-pane-zoom') {
      let client = resolve(model.clients, args.client, 'Client')
      client.zoomedPaneId = client.zoomedPaneId ? null : client.paneId
      changed(); await visualQueue; return client
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
      if (!window.panes.length) {
        await execute({ method: 'kill-window', args: { window: window.id, confirm: true } })
        return { closed: pane.id }
      }
      changed(); await visualQueue; return { closed: pane.id }
    }
    if (method === 'kill-window') {
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      if (window.panes.reduce((count, pane) => count + pane.tabs.length, 0) > 1 && args.confirm !== true) throw new Error('Window contains multiple tabs; pass --confirm')
      let session = model.sessions.find(session => session.windows.includes(window))!
      session.windows = session.windows.filter(item => item !== window)
      if (!session.windows.length) removeSession(model, session)
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
    if (method === 'permission.dismiss') {
      let owner = sourceClientId ? clients.get(sourceClientId) : undefined
      if (!owner) throw new Error('Trusted permission UI required')
      if (!Array.isArray(args.ids)) throw new Error('Permission IDs required')
      for (let requestId of args.ids) if (typeof requestId === 'string' && permissions.has(requestId)) owner.dismissedPermissions.add(requestId)
      publish(); return null
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
    if (method === 'downloads') return args.profile ? downloads.filter(item => item.profileId === required(args, 'profile')) : downloads
    if (['download.pause', 'download.resume', 'download.cancel', 'download.reveal'].includes(method)) {
      let record = downloads.find(item => item.id === required(args, 'id'))
      if (!record) throw new Error('Download not found')
      if (required(args, 'profile') !== record.profileId) throw new Error('Download belongs to another profile')
      if (method === 'download.reveal') {
        if (record.state !== 'completed') throw new Error('Download has not completed')
        if (!(await fs.stat(record.path).catch(() => null))?.isFile()) throw new Error('Downloaded file no longer exists')
        shell.showItemInFolder(record.path); return { path: record.path }
      }
      let item = downloadItems.get(record.id)
      if (!item || !record.active) throw new Error('Download is no longer active')
      if (method === 'download.pause') {
        if (record.state !== 'progressing' || item.isPaused()) throw new Error('Download cannot be paused')
        item.pause()
      }
      if (method === 'download.resume') {
        if (!item.canResume() || (!item.isPaused() && record.state !== 'interrupted')) throw new Error('Download cannot be resumed')
        item.resume()
      }
      if (method === 'download.cancel') item.cancel()
      if (downloadItems.has(record.id)) {
        record.paused = item.isPaused(); record.canResume = item.canResume()
      }
      publish(); return { id: record.id, state: record.state }
    }
    if (method === 'settings.prefix') {
      let key = required(args, 'key').toLowerCase()
      if (!/^[a-z]$/.test(key)) throw new Error('Prefix key must be one letter (used with Control)')
      configuration!.setPrefix(`Ctrl+${key.toUpperCase()}`); return { prefix: `Ctrl+${key.toUpperCase()}` }
    }
    if (method === 'dialog.confirm') {
      let client = resolve(model.clients, args.client, 'Client')
      let response = await dialog.showMessageBox(clients.get(client.id)!.window, { type: 'question', message: required(args, 'message'), buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0 })
      return response.response === 1
    }
    if (method === 'quit') { setTimeout(() => app.quit(), 100); return { quitting: true } }
    if (method === 'find') {
      let tabId = required(args, 'tab'); tabById(model, tabId)
      let contents = tabs.get(tabId)?.contents
      if (!contents || contents.isDestroyed()) throw new Error('Tab is closed')
      let text = String(args.text ?? '')
      if (!text) { contents.stopFindInPage('clearSelection'); delete findResults[tabId]; publish(); return { text } }
      let current = findResults[tabId], repeat = args.next === true && current?.text === text
      // Electron's findNext option starts a new session when true.
      let requestId = contents.findInPage(text, { findNext: !repeat, forward: args.forward !== false })
      findResults[tabId] = { requestId, text, matches: repeat ? current.matches : 0, activeMatchOrdinal: repeat ? current.activeMatchOrdinal : 0, finalUpdate: false }
      publish(); return { text, requestId }
    }
    if (['stop', 'reload', 'hard-reload', 'back', 'forward'].includes(method)) {
      let tabId = required(args, 'tab'); tabById(model, tabId)
      let contents = tabs.get(tabId)?.contents
      if (!contents || contents.isDestroyed()) throw new Error('Tab is closed')
      delete crashes[tabId]
      if (method === 'stop') { contents.stop(); delete loading[tabId] }
      if (method === 'reload') contents.reload()
      if (method === 'hard-reload') contents.reloadIgnoringCache()
      if (method === 'back') {
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
        else {
          let { tab, pane } = tabById(model, tabId)
          let openerTabId = tab.openerTabId
          if (openerTabId && pane.tabs.some(tab => tab.id === openerTabId)) {
            pane.tabs = pane.tabs.filter(tab => tab.id !== tabId)
            pane.activeTabId = openerTabId
            changed(); await visualQueue
            return { closed: tabId, tab: openerTabId }
          }
        }
      }
      if (method === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
      publish(); return { tab: tabId }
    }
    if (method === 'navigate' && args.waitUntil === 'none') {
      let tabId = required(args, 'tab'), url = normalizeUrl(required(args, 'url'))
      let { tab } = tabById(model, tabId)
      let live = tabs.get(tabId) ?? createLiveTab(tabId, false)
      let navigation = Symbol()
      live.pendingNavigation = navigation
      live.pendingUrl = url
      delete crashes[tabId]; delete snapshots[tabId]; loading[tabId] = true
      save(); void scheduleVisuals()
      // did-navigate owns the committed URL; do not overwrite it with a pending request.
      // did-fail-load reports failures, including failures before a navigation commits.
      void (pageTools?.ready(tabId) ?? Promise.resolve()).then(() => { if (!live.disposed) return live.contents.loadURL(url) }).catch(() => undefined).finally(() => {
        if (live.pendingNavigation !== navigation) return
        live.pendingNavigation = undefined
        live.pendingUrl = undefined
        publish()
        if (!live.disposed) void scheduleVisuals()
      })
      return { id: tabId, url, loading: true }
    }
    if (!['navigate', 'eval', 'dom', 'screenshot', 'click', 'type', 'key', 'wait', 'cdp', 'back', 'forward', 'reload', 'find', 'zoom', 'devtools'].includes(method)) throw new Error(`Unknown command: ${method}`)
    let tabId = required(args, 'tab')
    tabById(model, tabId)
    await visualQueue
    return serializeTab(tabId, async () => {
      if (typeof args._pluginGuard === 'function') args._pluginGuard()
      let { tab, pane } = tabById(model, tabId)
      let contents = tabs.get(tabId)!.contents
      let background = resolve(model.profiles, pane.profileId, 'Profile').background
      contents.setBackgroundThrottling(false)
      let syntheticInput = ['click', 'type', 'key'].includes(method) || (method === 'cdp' && String(args.method).startsWith('Input.'))
      if (syntheticInput) { automatedContents.add(contents.id); contents.setIgnoreMenuShortcuts(true) }
      try {
        if (method === 'navigate') { await pageTools?.ready(tabId); await contents.loadURL(normalizeUrl(required(args, 'url'))); return { id: tab.id, url: contents.getURL() } }
        if (method === 'reload') { delete crashes[tabId]; contents.reload(); publish(); return { reloading: tabId } }
        if (method === 'back' || method === 'forward') { let history = contents.navigationHistory; if (method === 'back' && history.canGoBack()) history.goBack(); if (method === 'forward' && history.canGoForward()) history.goForward(); return { tab: tabId } }
        if (method === 'devtools') { contents.openDevTools({ mode: 'detach', activate: false }); return { opened: tabId } }
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
          let { timeout, ms, expression } = waitOptions(args)
          let started = Date.now()
          if (ms !== undefined) { await sleep(ms); return { waited: Date.now() - started } }
          while (Date.now() - started < timeout) {
            let result = await cdp(tabId, 'Runtime.evaluate', { expression, returnByValue: true })
            if (result.exceptionDetails) throw new Error(args.selector !== undefined ? 'Invalid wait selector' : 'Wait expression threw an error')
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
      } finally { if (syntheticInput) automatedContents.delete(contents.id); if (!contents.isDestroyed()) { if (syntheticInput) contents.setIgnoreMenuShortcuts(false); contents.setBackgroundThrottling(!background) } }
      return null
    })
  }
  let start = async (background: boolean) => {
    await settingsReady
    configuration = createConfig(configPath(dataDirectory), refreshSettings, legacyPrefix)
    filters = createRequestFilters({ resources: path.join(app.getAppPath(), 'resources'), directory: path.join(dataDirectory, 'filters'), settings: browserSettings, changed: publish, context: contentsId => {
      let entry = [...tabs].find(([, live]) => live.contents.id === contentsId)
      return entry && !entry[1].contents.isDestroyed() ? { tabId: entry[0], url: entry[1].contents.getURL() } : undefined
    } })
    pageTools = createPageTools({ visible: contentsId => [...tabs.values()].some(live => !live.contents.isDestroyed() && live.contents.id === contentsId && !live.parent.isDestroyed() && live.parent.isVisible()), directory: path.dirname(configuration.path), settings: browserSettings, changed: publish, styles: (url, ids, classes) => filters!.styles(url, ids, classes) })
    savedForms = createSavedForms({ directory: path.join(dataDirectory, 'saved-forms'), available: () => safeStorage.isEncryptionAvailable(), encrypt: text => safeStorage.encryptString(text), decrypt: data => safeStorage.decryptString(data), browser: createPluginBrowser({ context: pluginContext, cdp, execute }) })
    plugins = createPlugins({ bundledDirectory: path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'bundled-plugins'), directory: path.join(path.dirname(configuration.path), 'plugins'), cli: path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'bin/bmux.mjs'), dataDirectory, settings: () => configuration!.plugins, changed: publish, context: pluginContext, interactive: pluginInteractive, selected: pluginSelected, show: clientId => { let chrome = clients.get(clientId)?.chrome.webContents; chrome?.focus(); chrome?.send('focus-control', 'plugin-dialog') }, browser: createPluginBrowser({ context: pluginContext, cdp, execute }) })
    await plugins.ready
    refreshSettings()
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
    extensions.close()
    for (let window of extensionWindows) if (!window.isDestroyed()) window.destroy()
    pageTools?.close()
    filters?.close()
    plugins?.close()
    configuration?.close()
    clearTimeout(persistTimer); clearTimeout(publishTimer)
    writeModel(dataDirectory, model)
    for (let tabId of tabs.keys()) disposeTab(tabId)
    for (let host of hosts.values()) if (!host.isDestroyed()) host.destroy()
  }
  return { execute, state, start, shutdown, sourceClient, setBounds, createClient, get model() { return model }, get tabCount() { return tabs.size } }
}
