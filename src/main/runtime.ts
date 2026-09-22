import { app, BaseWindow, BrowserWindow, WebContentsView, session as electronSession, shell, dialog, Menu, webContents, safeStorage, screen, clipboard, net } from 'electron'
import type { DownloadItem, View, WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Bounds, Client, Command, DevicePersona, Download, FindResult, InternalWindow, Model, Permission, PublicState, Snapshot, Tab } from '../shared/types'
import { cloneWindow, id, mapLayout, newPane, newSession, newTab, newWindow, paneById, paneInDirection, removeSession, repairClientSelections, resolve, splitLayout, tabById, updateAutomaticWindowName, walkPanes } from './model'
import { bookmarksPath, readModel, writeModel } from './store'
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
import { bookmarkById, createBookmarkFolder, saveBookmark } from './bookmarks'
import { bookmarkParametersPath, readBookmarkParameters, writeBookmarkParameters } from './bookmark-parameters'
import { editableBookmarkParameters } from '../shared/bookmark-parameters'
import { createProfileProxyRelays, createProxyCredentialStore, parseProfileProxy } from './profile-proxy'
import type { ProxyCredentials } from './profile-proxy'
import { deviceUserAgent, deviceUserAgentMetadata, deviceViewport, fittedDeviceBounds, parseDevicePersona } from './device-persona'
import { dockPane, forgetPlacement, layoutPaneIds, liftPane, raisePane, rememberPlacement } from './floating'
import { clampFloat, FLOAT_CONTENT_INSET, FLOAT_CONTENT_VERTICAL_INSET, FLOAT_HEADER, FLOAT_RADIUS } from '../shared/floating'
import { contextLinkExpression, resolvedContextLink } from './context-link'
import { createClickMode } from './click-mode'
import { createDoubleTapTracker, DEFAULT_CLICK_MODE } from '../shared/click-mode'
import { createSerialNavigationQueue, startNavigationCrashRecovery } from './crash-recovery'

type LiveTab = { view: WebContentsView; contents: Electron.WebContents; parent: BaseWindow; disposed: boolean; ready: Promise<void>; deviceScale?: number; pendingNavigation?: symbol; pendingUrl?: string }
type LiveClient = { window: BaseWindow; chrome: WebContentsView; floats: Map<string, WebContentsView>; permissionPopup: WebContentsView; linkPreview: WebContentsView; linkUrl: string; linkTabId?: string; dismissedPermissions: Set<string>; bounds: Bounds[]; pageFocused: boolean }
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
  let bookmarkFile = bookmarksPath(configPath(dataDirectory))
  let parameterFile = bookmarkParametersPath(configPath(dataDirectory))
  let model: Model = readModel(dataDirectory, bookmarkFile)
  let crashRecovery = startNavigationCrashRecovery(dataDirectory, model)
  let startupNotice = crashRecovery.startupNotice
  let proxyCredentials = createProxyCredentialStore({ directory: path.join(dataDirectory, 'proxy-credentials'), available: () => safeStorage.isEncryptionAvailable(), encrypt: text => safeStorage.encryptString(text), decrypt: data => safeStorage.decryptString(data) })
  let proxyRelays = createProfileProxyRelays(proxyCredentials)
  let profileNetworkReady = new Map<string, Promise<void>>()
  let blockedProfileNetworks = new Map<string, { wait: Promise<void>; continue: () => void }>()
  let appliedProfileProxies = new Set<string>()
  let proxyLogin = (event: Electron.Event, _contents: WebContents | null, _details: Electron.AuthenticationResponseDetails, auth: Electron.AuthInfo, callback: (username?: string, password?: string) => void) => {
    if (!auth.isProxy) return
    let relay = proxyRelays.authentication(auth.host, auth.port)
    if (!relay) return
    event.preventDefault()
    callback(relay.username, relay.password)
  }
  app.on('login', proxyLogin)
  if (startupNotice) writeModel(dataDirectory, model, bookmarkFile)
  let navigationCrashMarker = crashRecovery.marker
  let queueRestoredNavigation = createSerialNavigationQueue()
  let restoringTabs = crashRecovery.serializeRestores
  let closedTabs: ({ kind: 'window'; sessionId: string; index: number; window: InternalWindow } | { kind: 'tab'; paneId: string; index: number; tab: Tab; replacementTabId?: string })[] = []
  let bookmarkParameters = readBookmarkParameters(parameterFile)
  let clients = new Map<string, LiveClient>()
  let tabs = new Map<string, LiveTab>()
  let hosts = new Map<string, BaseWindow>()
  let configuredProfiles = new Set<string>()
  let defaultUserAgents = new Map<string, string>()
  let lastCacheChecks = new Map<string, number>()
  let profileCaches: PublicState['profileCaches'] = {}
  let profileProxyTests: PublicState['profileProxyTests'] = {}
  let profileProxyFailures: PublicState['profileProxyFailures'] = {}
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
      if (details.focused !== false) { window.show(); window.focus() } else window.showInactive()
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
  let lastFocusedClientId: string | null = null
  let preferredClient = () => model.clients.find(client => client.id === (focusedClientId ?? lastFocusedClientId)) ?? model.clients[0]
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
  let doubleTap = createDoubleTapTracker()
  let publishClickMode = () => {}
  let clickMode = createClickMode({
    frames: (tabId, expression) => pageTools?.frameContexts(tabId, expression) ?? Promise.resolve([]),
    valid: (clientId, tabId, contents) => {
      let client = model.clients.find(client => client.id === clientId), owner = clients.get(clientId)
      if (!client || !owner || client.id !== focusedClientId || !owner.window.isFocused() || overlays.has(clientId) || !client.paneId) return false
      let pane = paneById(model, client.paneId).pane
      return pane.activeTabId === tabId && tabs.get(tabId)?.contents === contents && tabs.get(tabId)?.parent === owner.window
    },
    openLink: async (clientId, tabId, url, action) => {
      let pane = tabById(model, tabId).pane
      if (action === 'float') await execute({ method: 'new-pane', args: { pane: pane.id, client: clientId, url } })
      else await execute({ method: 'split-window', args: { pane: pane.id, client: clientId, url, axis: 'horizontal', before: action === 'split-left' } })
    },
    error: error => reportError(error),
    changed: () => publishClickMode(),
  })
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

  let state = (clientId = ''): PublicState => ({ findResults, browserTools: toolsState(), plugins: plugins?.list(), pluginRuns: plugins?.runs(), pluginPrompt: clientId ? plugins?.prompt(clientId) : undefined, bookmarkParameters, model, clientId, focusedClientId, snapshots, crashes, loading, favicons, pendingUrls: Object.fromEntries([...tabs].flatMap(([tabId, live]) => live.pendingUrl ? [[tabId, live.pendingUrl]] : [])), navigation: Object.fromEntries([...tabs].flatMap(([tabId, live]) => live.contents.isDestroyed() ? [] : [[tabId, { activeIndex: live.contents.navigationHistory.getActiveIndex(), entries: live.contents.navigationHistory.getAllEntries().map(({ title, url }) => ({ title, url })) }]])), keyboard: configuration?.keyboard ?? DEFAULT_KEYBOARD, clickMode: configuration?.clickMode ?? DEFAULT_CLICK_MODE, clickModeState: clickMode.status(clientId), configPath: configuration?.path ?? configPath(dataDirectory), configError: configuration?.error ?? null, startupNotice, accessibility: configuration?.accessibility ?? false, statusBar: configuration?.statusBar ?? 'top', showTabCloseButtons: configuration?.showTabCloseButtons ?? false, permissions: [...permissions.values()].map(({ reply: _reply, ...request }) => request), downloads, profileCaches, profileProxyTests, profileProxyFailures })
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
    let bounds = live.linkTabId ? (client && target ? floatBounds(client, target.pane.id) : undefined) ?? live.bounds.find(bounds => bounds.tabId === live.linkTabId) : undefined
    let page = live.linkTabId ? tabs.get(live.linkTabId) : undefined
    let visible = !!live.linkUrl && !!client && !overlays.has(clientId) && page?.parent === live.window && target?.session.id === client.sessionId && target.window.id === client.windowId && target.pane.activeTabId === live.linkTabId && !!bounds
    if (!visible || !bounds) { live.linkPreview.setVisible(false); return }
    live.linkPreview.webContents.send('link-preview', live.linkUrl)
    let inset = client && target && floatBounds(client, target.pane.id) ? FLOAT_CONTENT_INSET : 0
    live.linkPreview.setBounds({ x: Math.round(bounds.x + inset), y: Math.round(bounds.y + bounds.height - 26 - inset), width: Math.max(1, Math.min(520, Math.round(bounds.width - inset * 2))), height: 26 })
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
        for (let frame of live.floats.values()) if (!frame.webContents.isDestroyed()) frame.webContents.send('state', current)
        updatePermissionPopup(clientId, live, current)
        updateLinkPreview(clientId, live)
      }
    }, 30)
  }
  publishClickMode = publish
  let save = () => {
    for (let session of model.sessions) for (let window of session.windows) {
      let viewers = model.clients.filter(client => client.windowId === window.id)
      let viewer = viewers.find(client => client.id === focusedClientId) ?? viewers[0]
      updateAutomaticWindowName(window, viewer?.paneId ?? undefined)
    }
    plugins?.reconcile()
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => { if (!shuttingDown) writeModel(dataDirectory, model, bookmarkFile) }, 150)
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
  let configureSessionIdentity = (profileId: string, persona?: DevicePersona) => {
    let browser = electronSession.fromPartition(`persist:${profileId}`)
    if (!defaultUserAgents.has(profileId)) defaultUserAgents.set(profileId, browser.getUserAgent())
    browser.setUserAgent(persona ? deviceUserAgent(persona) : defaultUserAgents.get(profileId)!, persona?.locale)
    return browser
  }
  let maintainCache = async (profileId: string, force = false) => {
    let last = lastCacheChecks.get(profileId) ?? 0
    if (!force && Date.now() - last < 30 * 60 * 1000) return
    lastCacheChecks.set(profileId, Date.now())
    let browser = electronSession.fromPartition(`persist:${profileId}`)
    let limit = 256 * 1024 * 1024, bytes = await browser.getCacheSize()
    if (bytes > limit) { await browser.clearCache(); bytes = 0 }
    profileCaches = { ...profileCaches, [profileId]: { bytes, limit, checkedAt: Date.now() } }
    publish()
  }
  let applyProfileNetwork = async (profileId: string, override?: ReturnType<typeof parseProfileProxy> | null, replacement?: ProxyCredentials) => {
    let proxy = override === undefined ? resolve(model.profiles, profileId, 'Profile').proxy : override ?? undefined
    let browser = electronSession.fromPartition(`persist:${profileId}`)
    if (proxy) {
      let relay = await proxyRelays.create(profileId, proxy, replacement)
      await browser.setProxy({ mode: 'fixed_servers', proxyRules: `http://${relay.host}:${relay.port}`, proxyBypassRules: '<-loopback>' })
      appliedProfileProxies.add(profileId)
    } else {
      await browser.setProxy({ mode: 'system' })
      await proxyRelays.close(profileId)
      appliedProfileProxies.delete(profileId)
    }
    await browser.clearAuthCache()
    await browser.closeAllConnections()
  }
  let testProfileProxy = async (profileId: string) => {
    let browser = electronSession.fromPartition(`persist:${profileId}`)
    let response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      let request = net.request({ url: process.env.BMUX_PROXY_TEST_URL ?? 'https://ipwho.is/', session: browser, credentials: 'include' })
      let timer = setTimeout(() => { request.abort(); reject(new Error('Proxy test timed out')) }, 10000)
      request.on('login', (auth, callback) => {
        let relay = proxyRelays.authentication(auth.host, auth.port)
        if (relay) callback(relay.username, relay.password)
        else callback()
      })
      request.on('response', incoming => {
        let chunks: Buffer[] = []
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
        incoming.on('end', () => { clearTimeout(timer); resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString('utf8') }) })
        incoming.on('error', error => { clearTimeout(timer); reject(error) })
      })
      request.on('error', error => { clearTimeout(timer); reject(error) })
      request.end()
    })
    if (response.status < 200 || response.status >= 300) throw new Error(`Proxy test failed with HTTP ${response.status}`)
    let value = JSON.parse(response.body) as { ip?: unknown; city?: unknown; region?: unknown; country?: unknown }
    if (typeof value.ip !== 'string' || !value.ip || value.ip.length > 80) throw new Error('Proxy test returned an invalid address')
    let locations = [value.city, value.region, value.country].filter((item): item is string => typeof item === 'string' && !!item.trim() && item.length <= 120)
    let region = [...new Set(locations.map(item => item.trim()))].join(', ')
    return { ip: value.ip, ...(region ? { region } : {}), checkedAt: Date.now() }
  }
  let releaseProfileNetwork = (profileId: string) => {
    let blocked = blockedProfileNetworks.get(profileId)
    blockedProfileNetworks.delete(profileId)
    blocked?.continue()
  }
  let waitForProfileProxyRecovery = (profileId: string, error: unknown) => {
    let blocked = blockedProfileNetworks.get(profileId)
    if (!blocked) {
      let proceed!: () => void
      let wait = new Promise<void>(resolve => { proceed = resolve })
      blocked = { wait, continue: proceed }
      blockedProfileNetworks.set(profileId, blocked)
    }
    delete profileProxyTests[profileId]
    profileProxyFailures = { ...profileProxyFailures, [profileId]: { error: errorText(error), failedAt: Date.now() } }
    publish()
    return blocked.wait
  }
  let verifyProfileProxy = async (profileId: string) => {
    let result = await testProfileProxy(profileId)
    profileProxyTests = { ...profileProxyTests, [profileId]: result }
    if (profileProxyFailures[profileId]) { let next = { ...profileProxyFailures }; delete next[profileId]; profileProxyFailures = next }
    releaseProfileNetwork(profileId)
    publish()
    return result
  }
  let browserSession = (profileId: string) => {
    let profile = resolve(model.profiles, profileId, 'Profile')
    let session = configureSessionIdentity(profile.id, profile.device)
    if (configuredProfiles.has(profileId)) return session
    configuredProfiles.add(profileId)
    let networkReady = (async () => {
      try {
        await applyProfileNetwork(profileId)
        if (profile.proxy) await verifyProfileProxy(profileId)
      } catch (error) {
        if (!profile.proxy) throw error
        await waitForProfileProxyRecovery(profileId, error)
      }
    })()
    let ready = Promise.all([networkReady, maintainCache(profileId, true)]).then(() => extensions.attach(profileId, session))
    profileNetworkReady.set(profileId, ready)
    void ready.catch(() => undefined)
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
  let reloadProfileTabs = (profileId: string) => {
    for (let [tabId, live] of tabs) {
      if (live.contents.isDestroyed() || tabById(model, tabId).pane.profileId !== profileId) continue
      delete crashes[tabId]
      live.contents.reloadIgnoringCache()
    }
  }
  let recreateProfileTabs = async (profileId: string) => {
    let tabIds = [...tabs].filter(([tabId]) => tabById(model, tabId).pane.profileId === profileId).map(([tabId]) => tabId)
    for (let tabId of tabIds) disposeTab(tabId)
    await scheduleVisuals()
    await Promise.all(tabIds.map(tabId => tabs.get(tabId)?.ready))
  }
  let updateProfileNetwork = async (profileId: string, proxy?: ReturnType<typeof parseProfileProxy>, replacement?: ProxyCredentials) => {
    browserSession(profileId)
    let applying = applyProfileNetwork(profileId, proxy ?? null, replacement)
    profileNetworkReady.set(profileId, applying)
    await applying
  }
  let cdp = async (tabId: string, method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    let live = tabs.get(tabId)
    if (!live || live.contents.isDestroyed()) throw new Error(`Tab ${tabId} is closed`)
    let debuggerApi = live.contents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    return debuggerApi.sendCommand(method, params, sessionId)
  }
  let applyDeviceMetrics = async (contents: Electron.WebContents, persona: DevicePersona, scale = 1) => {
    let debuggerApi = contents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    let viewport = deviceViewport(persona)
    await debuggerApi.sendCommand('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: persona.deviceScaleFactor, mobile: true, screenWidth: viewport.width, screenHeight: viewport.height, screenOrientation: { angle: viewport.angle, type: viewport.type }, scale })
  }
  let applyDevicePersona = async (contents: Electron.WebContents, persona: DevicePersona, scale = 1) => {
    let debuggerApi = contents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    let viewport = deviceViewport(persona)
    let metadata = deviceUserAgentMetadata(persona)
    let deviceMemoryScript = persona.platform === 'android'
      ? "Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => 8 })"
      : "delete Navigator.prototype.deviceMemory"
    await Promise.all([
      debuggerApi.sendCommand('Emulation.setUserAgentOverride', { userAgent: deviceUserAgent(persona), acceptLanguage: persona.locale, platform: persona.platform === 'android' ? 'Linux armv81' : 'iPhone', ...(metadata ? { userAgentMetadata: metadata } : {}) }),
      debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: deviceMemoryScript }),
      debuggerApi.sendCommand('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: persona.deviceScaleFactor, mobile: true, screenWidth: viewport.width, screenHeight: viewport.height, screenOrientation: { angle: viewport.angle, type: viewport.type }, scale }),
      debuggerApi.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }),
      debuggerApi.sendCommand('Emulation.setLocaleOverride', { locale: persona.locale }),
      debuggerApi.sendCommand('Emulation.setTimezoneOverride', { timezoneId: persona.timezone }),
      persona.geolocation ? debuggerApi.sendCommand('Emulation.setGeolocationOverride', persona.geolocation) : debuggerApi.sendCommand('Emulation.clearGeolocationOverride'),
      debuggerApi.sendCommand('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: persona.platform === 'android' ? 8 : 6 }),
    ])
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
  let activateClickMode = (clientId = focusedClientId) => {
    if (!clientId || overlays.has(clientId)) return Promise.resolve(false)
    let client = model.clients.find(client => client.id === clientId), owner = clients.get(clientId)
    let pane = client?.paneId ? paneById(model, client.paneId).pane : undefined
    let live = pane?.activeTabId ? tabs.get(pane.activeTabId) : undefined
    if (!client || !owner || client.id !== focusedClientId || !owner.window.isFocused() || !pane || !live || live.parent !== owner.window) return Promise.resolve(false)
    prefixUntil = 0; pendingSequence = undefined; pendingModifierShortcut = undefined
    return clickMode.activate(client.id, pane.activeTabId, live.contents, configuration?.clickMode ?? DEFAULT_CLICK_MODE)
  }
  let dispatchShortcut = (action: string) => {
    let client = model.clients.find(client => client.id === focusedClientId)
    if (!client || automatedContents.has(webContents.getFocusedWebContents()?.id ?? -1)) return
    let focused = clients.get(client.id)!
    let pane = client.paneId ? paneById(model, client.paneId).pane : undefined
    let tab = pane?.activeTabId
    let control = (name: string) => { pointerTarget = undefined; let chrome = name === 'address' && pane && !client.zoomedPaneId ? focused.floats.get(pane.id) ?? focused.chrome : focused.chrome; chrome.webContents.focus(); chrome.webContents.send('focus-control', name) }
    if (action === 'prefix') { prefixUntil = Date.now() + (configuration?.keyboard.prefixTimeoutMs ?? 1600); return }
    if (action === 'click-mode') { void activateClickMode().catch(reportError); return }
    if ((action === 'toggle-dark' || action === 'toggle-adblock') && tab) { void execute({ method: 'browser.set', args: { tab, setting: action === 'toggle-dark' ? 'darkMode' : 'adblock', value: 'toggle' } }).catch(reportError); return }
    if (action.startsWith('plugin:')) { try { plugins?.run(action.slice(7), { clientId: client.id }, {}, true) } catch (error) { reportError(error) }; return }
    let session = model.sessions.find(session => session.id === client.sessionId)!
    let window = session.windows.find(window => window.id === client.windowId)!
    if (action === 'close-pane' || (action === 'close-pane-or-window' && pane && window.floating?.some(item => item.paneId === pane.id))) {
      void execute({ method: pane ? 'kill-pane' : 'kill-window', args: { pane: pane?.id, window: client.windowId, confirm: true } }).catch(reportError); return
    }
    if (action === 'close-window' || action === 'close-pane-or-window') {
      let behavior = windowCloseBehavior(session, window)
      if (behavior === 'close-window') { void execute({ method: 'kill-window', args: { window: window.id, confirm: true } }).catch(reportError); return }
    }
    if (['browser-tools', 'plugins', 'address', 'command', 'find', 'help', 'sessions', 'bookmark', 'bookmarks', 'history', 'activity', 'downloads', 'profiles', 'settings', 'rename-window', 'rename-session', 'move-window', 'close-pane', 'close-window', 'close-pane-or-window'].includes(action)) { control(action === 'close-pane-or-window' ? 'close-window' : action); return }
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
    doubleTap.reset(); clickMode.cancel()
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
      if (!focused || (focused.chrome.webContents !== contents && focused.permissionPopup.webContents !== contents && ![...focused.floats.values()].some(frame => frame.webContents === contents) && ![...tabs.values()].some(tab => tab.contents === contents && tab.parent === focused.window))) return
      if (clickMode.handle(focusedClientId, input)) { event.preventDefault(); return }
      let clickSettings = configuration?.clickMode ?? DEFAULT_CLICK_MODE
      let selected = model.clients.find(client => client.id === focusedClientId)?.paneId
      let selectedContents = selected ? tabs.get(paneById(model, selected).pane.activeTabId)?.contents : undefined
      if (doubleTap.update(input, clickSettings.enabled && selectedContents === contents ? clickSettings.doubleTapModifier : null)) { event.preventDefault(); void activateClickMode().catch(reportError); return }
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
      if (mouse.type === 'mouseDown' || mouse.type === 'mouseWheel') {
        let client = [...clients].find(([, live]) => live.window.isFocused() && (live.chrome.webContents === contents || live.permissionPopup.webContents === contents || [...live.floats.values()].some(frame => frame.webContents === contents) || [...tabs.values()].some(tab => tab.contents === contents && tab.parent === live.window)))
        if (client) clickMode.cancelClient(client[0])
      }
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
    let live: LiveTab = { view, contents, parent, disposed: false, ready: Promise.resolve() }
    let serializedRestore = restoringTabs
    tabs.set(tabId, live)
    faviconRevisions.set(tabId, 0)
    extensions.track(pane.profileId, contents, parent)
    let bootstrapping = !popupOptions
    live.ready = Promise.all([
      profileNetworkReady.get(pane.profileId),
      (profile.device ? contents.loadURL('about:blank').then(() => applyDevicePersona(contents, profile.device!)) : Promise.resolve()).then(() => pageTools?.attach(tabId, pane.profileId, contents, !popupOptions)),
    ]).then(() => undefined).finally(() => { bootstrapping = false })
    void live.ready.catch(error => { if (!live.disposed) { crashes[tabId] = `Device identity failed: ${errorText(error)}`; publish(); void scheduleVisuals() } })
    let internalBootstrap = () => bootstrapping && initialUrl !== 'about:blank' && contents.getURL() === 'about:blank'
    contents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { navigationCrashMarker.mark(pane.id, tabId, url); live.pendingUrl = url; filters?.reset(tabId); delete findResults[tabId]; delete favicons[tabId]; faviconRevisions.set(tabId, (faviconRevisions.get(tabId) ?? 0) + 1); publish() } })
    contents.on('found-in-page', (_event, result) => {
      let current = findResults[tabId]
      if (live.disposed || current?.requestId !== result.requestId) return
      findResults[tabId] = { ...current, matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal, finalUpdate: result.finalUpdate }
      publish()
    })
    contents.on('render-process-gone', () => { delete findResults[tabId] })
    let invalidate = () => { clickMode.cancelTab(tabId); documents.set(tabId, (documents.get(tabId) ?? 0) + 1); plugins?.invalidate(tabId) }
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
    let update = (pageTitle?: string) => {
      if (live.disposed || contents.isDestroyed() || internalBootstrap()) return
      tab.url = contents.getURL() || tab.url
      tab.title = pageTitle || contents.getTitle() || (tab.url === 'about:blank' ? 'New tab' : tab.url)
      if (/^https?:\/\//.test(tab.url)) {
        let profile = model.profiles.find(profile => profile.id === pane.profileId)!
        profile.history = [{ url: tab.url, title: tab.title, visitedAt: Date.now() }, ...(profile.history ?? []).filter(entry => entry.url !== tab.url)].slice(0, 1000)
      }
      save()
      void scheduleVisuals()
    }
    contents.on('did-start-loading', () => { loading[tabId] = true; publish() })
    contents.on('did-stop-loading', () => { delete loading[tabId]; live.pendingUrl = undefined; publish() })
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
    contents.on('page-title-updated', (_event, title) => update(title))
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
        if (client.paneId !== pane.id) { client.paneId = pane.id; raisePane(paneById(model, pane.id).window, pane.id); save(); void scheduleVisuals() }
      }
    })
    contents.on('did-navigate', () => { live.pendingUrl = undefined; update() })
    contents.on('did-navigate-in-page', () => update())
    contents.on('did-finish-load', () => { navigationCrashMarker.clear(tabId); delete crashes[tabId]; update(); void maintainCache(pane.profileId).catch(reportError) })
    contents.on('render-process-gone', (_event, details) => { navigationCrashMarker.clear(tabId); crashes[tabId] = `Page process ${details.reason}. Reload to recover.`; publish(); void scheduleVisuals() })
    contents.on('did-fail-load', (_event, code, description, failedUrl, mainFrame) => { if (mainFrame) navigationCrashMarker.clear(tabId, failedUrl); if (mainFrame && code !== -3) { crashes[tabId] = description; publish(); void scheduleVisuals() } })
    let openLinkWindow = (url: string, activate: boolean, options?: Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }, loadOptions?: Electron.LoadURLOptions) => {
      let created = newWindow(`window-${session.windows.length + 1}`, pane.profileId, true)
      let added = created.panes[0].tabs[0]
      added.openerTabId = tabId
      if (!options) { added.url = url; added.title = url }
      session.windows.push(created)
      let owner = model.clients.find(client => client.id === focusedClientId && visiblePaneIds(client).includes(pane.id))
      if (activate && owner) { owner.sessionId = session.id; owner.windowId = created.id; owner.paneId = created.panes[0].id }
      if (!options) {
        if (profile.device) {
          let popup = createLiveTab(added.id, false)
          void popup.ready.then(() => { if (!popup.disposed) return popup.contents.loadURL(url) }).catch(reportError)
        }
        changed(); return undefined
      }
      let popup = createLiveTab(added.id, false, options)
      if (!options.webContents) void popup.ready.then(() => { if (!popup.disposed) return popup.contents.loadURL(url, loadOptions) }).catch(reportError)
      changed()
      return popup.contents
    }
    contents.setWindowOpenHandler(details => {
      if (profile.device) {
        setTimeout(() => { if (!live.disposed) openLinkWindow(details.url, false) }, 100)
        return { action: 'deny' }
      }
      return {
        action: 'allow', outlivesOpener: true,
        createWindow: options => openLinkWindow(details.url, details.disposition !== 'background-tab', options as Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }, { httpReferrer: details.referrer, ...(details.postBody ? { postData: details.postBody.data, extraHeaders: `content-type: ${details.postBody.contentType}` } : {}) })!,
      }
    })
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
      let show = async () => {
        let linkUrl = params.linkURL
        let frame = params.frame && !params.frame.isDestroyed() ? params.frame : contents.mainFrame
        if (!linkUrl && !frame.isDestroyed()) {
          let result = await frame.executeJavaScript(contextLinkExpression(params.x, params.y)).catch(() => undefined)
          linkUrl = resolvedContextLink(result)
        }
        if (linkUrl && params.frame && !params.frame.isDestroyed()) void params.frame.executeJavaScript('globalThis.getSelection()?.removeAllRanges()').catch(reportError)
        if (contents.isDestroyed() || owner.window.isDestroyed()) return
        let navigation = contents.navigationHistory
        let template: Electron.MenuItemConstructorOptions[] = []
        if (linkUrl) template.push(
          { label: 'Open Link in Floating Pane', click: () => { void execute({ method: 'new-pane', args: { pane: tabById(model, tabId).pane.id, client: [...clients].find(([, live]) => live === owner)?.[0], url: linkUrl } }).catch(reportError) } },
          { label: 'Open Link in New bmux Window', click: () => { openLinkWindow(linkUrl, true) } },
          { label: 'Open Link in Background bmux Window', click: () => { openLinkWindow(linkUrl, false) } },
          { label: 'Open Link in This Tab', click: () => { void contents.loadURL(linkUrl).catch(reportError) } },
          { label: 'Copy Link Address', click: () => clipboard.writeText(linkUrl) },
          { type: 'separator' },
        )
        template.push(
          ...paneMenu(tabById(model, tabId).pane.id, [...clients].find(([, live]) => live === owner)![0]),
          { type: 'separator' },
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
      }
      void show().catch(reportError)
    })
    if (load && initialUrl !== 'about:blank') {
      let navigate = async () => {
        await live.ready
        if (live.disposed) return
        navigationCrashMarker.mark(pane.id, tabId, initialUrl)
        await contents.loadURL(initialUrl)
      }
      let result = serializedRestore ? queueRestoredNavigation(navigate) : navigate()
      void result.catch(error => { navigationCrashMarker.clear(tabId, initialUrl); if (!live.disposed && error?.code !== 'ERR_ABORTED' && error?.errno !== -3) { crashes[tabId] = errorText(error); publish() } })
    }
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
  let visiblePaneIds = (client: Client) => client.zoomedPaneId ? [client.zoomedPaneId] : model.sessions.find(session => session.id === client.sessionId)?.windows.find(window => window.id === client.windowId)?.panes.map(pane => pane.id) ?? []
  let paneMenu = (paneId: string, clientId: string): Electron.MenuItemConstructorOptions[] => {
    let { window, pane } = paneById(model, paneId)
    let floating = window.floating?.some(item => item.paneId === paneId)
    let invoke = (method: string, args: Record<string, unknown> = {}) => { void execute({ method, args: { pane: paneId, client: clientId, ...args } }).catch(reportError) }
    return [
      { label: floating ? 'Return to Split' : 'Float Pane', click: () => invoke(floating ? 'join-pane' : 'break-pane', { floating: true }) },
      ...(floating ? [{ label: 'Move to Window', submenu: model.sessions.flatMap(session => session.windows.filter(candidate => candidate !== window).map(candidate => ({ label: `${session.name}: ${candidate.name}`, click: () => invoke('move-pane', { window: candidate.id }) }))) }] : []),
      { label: 'Close Pane', click: () => {
        if (pane.tabs.length > 1) {
          let owner = clients.get(clientId)
          if (owner) { void execute({ method: 'select-pane', args: { client: clientId, pane: paneId, focus: false } }).then(() => { owner.chrome.webContents.focus(); owner.chrome.webContents.send('focus-control', 'close-pane') }).catch(reportError) }
        } else invoke('kill-pane')
      } },
    ]
  }
  let floatRect = (client: Client, placement: NonNullable<InternalWindow['floating']>[number]) => {
    let rect = clampFloat(placement, client.width, client.height - 28)
    return { ...rect, y: rect.y + (configuration?.statusBar === 'bottom' ? 0 : 28) }
  }
  let floatBounds = (client: Client, paneId: string): Bounds | undefined => {
    if (client.zoomedPaneId) return
    let { window, pane } = paneById(model, paneId)
    let placement = window.floating?.find(item => item.paneId === paneId)
    if (!placement) return
    let rect = floatRect(client, placement)
    return { tabId: pane.activeTabId, x: rect.x + FLOAT_CONTENT_INSET, y: rect.y + FLOAT_HEADER + FLOAT_CONTENT_VERTICAL_INSET, width: Math.max(1, rect.width - FLOAT_CONTENT_INSET * 2), height: Math.max(1, rect.height - FLOAT_HEADER - FLOAT_CONTENT_VERTICAL_INSET * 2) }
  }
  let prepareFloats = (client: Client, live: LiveClient) => {
    let window = model.sessions.flatMap(session => session.windows).find(window => window.id === client.windowId)
    let visible = client.zoomedPaneId ? [] : window?.floating ?? []
    for (let [paneId, frame] of live.floats) if (!visible.some(item => item.paneId === paneId)) {
      live.window.contentView.removeChildView(frame); frame.webContents.close(); live.floats.delete(paneId)
    }
    for (let placement of visible) {
      let frame = live.floats.get(placement.paneId)
      if (!frame) {
        frame = new WebContentsView({ webPreferences: { preload: path.join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
        frame.setBorderRadius(FLOAT_RADIUS)
        live.floats.set(placement.paneId, frame)
        live.window.contentView.addChildView(frame)
        frame.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        frame.webContents.on('will-navigate', event => event.preventDefault())
        frame.webContents.on('focus', () => { live.pageFocused = false })
        installKeys(frame.webContents)
        let hash = `float=${placement.paneId}`
        let ready = process.env.ELECTRON_RENDERER_URL ? frame.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`) : frame.webContents.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), { hash })
        let contents = frame.webContents
        void ready.then(() => {
          publish()
          let pane = window?.panes.find(pane => pane.id === placement.paneId)
          if (!contents.isDestroyed() && pane?.tabs.find(tab => tab.id === pane.activeTabId)?.url === 'about:blank' && client.paneId === pane.id && focusedClientId === client.id && live.window.isFocused()) contents.focus()
        }).catch(reportError)
      }
      let { x, y, width, height } = floatRect(client, placement)
      frame.setBounds({ x, y, width, height })
      frame.setVisible(!overlays.has(client.id))
    }
  }
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
  let singlePaneBounds = (tabId: string, live: LiveClient, exact?: Bounds) => {
    // Popup and session changes can reconcile before the renderer publishes the
    // selected tab. A single tiled pane fills the chrome, so its last content
    // region is a safe fallback and split-sized horizontal insets are stale.
    let candidates = exact ? [exact] : live.bounds.filter(bounds => bounds.width > 0 && bounds.height > 0)
    if (!candidates.length) return
    let left = Math.min(...candidates.map(bounds => bounds.x))
    let top = Math.min(...candidates.map(bounds => bounds.y))
    let right = Math.max(...candidates.map(bounds => bounds.x + bounds.width))
    let bottom = Math.max(...candidates.map(bounds => bounds.y + bounds.height))
    let chrome = live.chrome.getBounds()
    let rightInset = chrome.width - right
    let staleHorizontal = left < 0 || left > 8 || rightInset < 0 || rightInset > 8
    let leftInset = staleHorizontal ? 1 : Math.round(left)
    if (staleHorizontal) rightInset = 1
    return { tabId, x: leftInset, y: Math.round(top), width: Math.max(1, chrome.width - leftInset - Math.round(rightInset)), height: Math.max(1, Math.round(bottom - top)) }
  }
  let reconcile = () => {
    if (shuttingDown) return
    let liveIds = new Set(walkPanes(model).flatMap(({ pane }) => pane.tabs.map(tab => tab.id)))
    for (let tabId of tabs.keys()) if (!liveIds.has(tabId)) disposeTab(tabId)
    for (let tabId of liveIds) if (!tabs.has(tabId)) createLiveTab(tabId)
    for (let candidate of model.clients) { let live = clients.get(candidate.id); if (live) prepareFloats(candidate, live) }
    let client = model.clients.find(client => client.id === focusedClientId)
    let owner = client && !overlays.has(client.id) ? clients.get(client.id) : undefined
    let viewers = new Map<string, { id: string; live: LiveClient; bounds: Bounds }[]>()
    for (let candidate of model.clients) {
      let live = clients.get(candidate.id)
      if (!live || !live.window.isVisible() || live.window.isMinimized() || overlays.has(candidate.id)) continue
      let paneIds = visiblePaneIds(candidate)
      for (let paneId of paneIds) {
        let tabId = paneById(model, paneId).pane.activeTabId
        let floatingBounds = floatBounds(candidate, paneId)
        let bounds = floatingBounds ?? live.bounds.find(bounds => bounds.tabId === tabId)
        if (!floatingBounds && paneIds.length === 1) bounds = singlePaneBounds(tabId, live, bounds)
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
      if (target === viewer?.live.window && bounds) {
        let persona = resolve(model.profiles, tabById(model, tabId).pane.profileId, 'Profile').device
        let fitted = persona ? fittedDeviceBounds(bounds, persona) : { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)), scale: undefined }
        live.view.setBounds({ x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height })
        if (persona && live.deviceScale !== fitted.scale) {
          live.deviceScale = fitted.scale
          void live.ready.then(() => applyDeviceMetrics(live.contents, persona, fitted.scale)).catch(error => { crashes[tabId] = `Device viewport failed: ${errorText(error)}`; publish() })
        }
      }
    }
    for (let candidate of model.clients) {
      let live = clients.get(candidate.id)
      if (!live || overlays.has(candidate.id)) continue
      let window = model.sessions.flatMap(session => session.windows).find(window => window.id === candidate.windowId)
      let ordered: View[] = []
      for (let paneId of visiblePaneIds(candidate)) {
        if (!candidate.zoomedPaneId && window?.floating?.some(item => item.paneId === paneId)) continue
        let page = tabs.get(paneById(model, paneId).pane.activeTabId)
        if (page?.parent === live.window) ordered.push(page.view)
      }
      for (let placement of candidate.zoomedPaneId ? [] : window?.floating ?? []) {
        let frame = live.floats.get(placement.paneId)
        if (frame) ordered.push(frame)
        let page = tabs.get(paneById(model, placement.paneId).pane.activeTabId)
        if (page?.parent === live.window) {
          ordered.push(page.view)
        }
      }
      let current = live.window.contentView.children.filter(view => ordered.includes(view))
      if (ordered.some((view, index) => current[index] !== view)) for (let view of ordered) live.window.contentView.addChildView(view)
    }
    if (pointerTarget) {
      let cursor = screen.getCursorScreenPoint()
      if (!client || client.id !== pointerTarget.clientId || client.paneId !== pointerTarget.paneId || Date.now() > pointerTarget.expires || cursor.x !== pointerTarget.origin.x || cursor.y !== pointerTarget.origin.y) pointerTarget = undefined
      else if (owner?.window.isFocused()) {
        let pane = paneById(model, client.paneId).pane
        let bounds = floatBounds(client, pane.id) ?? owner.bounds.find(bounds => bounds.tabId === pane.activeTabId)
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
  let changed = () => { clickMode.cancel(); doubleTap.reset(); repairClients(); save(); void scheduleVisuals() }
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
    let resizeChrome = () => { clickMode.cancelClient(client.id); let bounds = window.getContentBounds(); chrome.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }); client.width = bounds.width; client.height = bounds.height; save(); void scheduleVisuals() }
    let owner: LiveClient = { window, chrome, floats: new Map(), permissionPopup, linkPreview, linkUrl: '', dismissedPermissions: new Set(), bounds: [], pageFocused: false }
    clients.set(client.id, owner)
    chrome.webContents.on('focus', () => { owner.pageFocused = false })
    resizeChrome()
    window.on('resize', resizeChrome)
    window.on('focus', () => {
      focusedClientId = client.id
      lastFocusedClientId = client.id
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
    window.on('blur', () => { clickMode.cancelClient(client.id); doubleTap.reset(); if (focusedClientId === client.id) { focusedClientId = null; pointerTarget = undefined; void scheduleVisuals() } })
    window.on('close', () => {
      // Move browser views out before destroying the client so their native hosts survive.
      for (let [tabId, live] of tabs) if (live.parent === window) moveView(live, parkHost(tabById(model, tabId).pane.profileId))
    })
    window.on('closed', () => {
      clients.delete(client.id)
      if (!chrome.webContents.isDestroyed()) chrome.webContents.close()
      if (!permissionPopup.webContents.isDestroyed()) permissionPopup.webContents.close()
      if (!linkPreview.webContents.isDestroyed()) linkPreview.webContents.close()
      for (let frame of owner.floats.values()) if (!frame.webContents.isDestroyed()) frame.webContents.close()
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
  let sourceClient = (contentsId: number) => [...clients].find(([, live]) => (live.chrome.webContents.id === contentsId || live.permissionPopup.webContents.id === contentsId || [...live.floats.values()].some(frame => frame.webContents.id === contentsId)))?.[0]
  let setBounds = (contentsId: number, bounds: Bounds[]) => {
    let clientId = [...clients].find(([, live]) => live.chrome.webContents.id === contentsId)?.[0]
    if (!clientId || !Array.isArray(bounds)) return
    let valid = bounds.filter(bound => ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bound[key as keyof Bounds])))
    clients.get(clientId)!.bounds = valid
    void scheduleVisuals()
  }

  let paneTargetedMethods = new Set(['navigate', 'wait', 'dom', 'eval', 'click', 'type', 'key', 'screenshot', 'cdp', 'back', 'forward', 'reload', 'hard-reload', 'stop', 'devtools', 'zoom', 'scroll', 'browser.set', 'plugin.run'])
  let execute = async ({ method, args = {} }: Command, sourceClientId?: string): Promise<unknown> => {
    if (paneTargetedMethods.has(method) && typeof args.pane === 'string' && args.tab === undefined) args = { ...args, tab: paneById(model, args.pane).pane.activeTabId }
    if (method === 'pane.menu' || method === 'pane.close' || method === 'float.bounds') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let client = resolve(model.clients, sourceClientId, 'Client')
      let { window, pane } = paneById(model, args.pane)
      if (client.windowId !== window.id) throw new Error('Pane is not in this client window')
      if (method === 'pane.menu') { Menu.buildFromTemplate(paneMenu(pane.id, client.id)).popup({ window: clients.get(client.id)!.window }); return null }
      if (method === 'pane.close') {
        if (pane.tabs.length <= 1) return execute({ method: 'kill-pane', args: { pane: pane.id } })
        await execute({ method: 'select-pane', args: { pane: pane.id, client: client.id, focus: false } })
        let chrome = clients.get(client.id)!.chrome.webContents
        chrome.focus(); chrome.send('focus-control', 'close-pane'); return null
      }
      let placement = window.floating?.find(item => item.paneId === pane.id)
      if (!placement || client.zoomedPaneId) throw new Error('Pane is not floating')
      let values = { x: Number(args.x), y: Number(args.y), width: Number(args.width), height: Number(args.height) }
      if (!Object.values(values).every(Number.isFinite)) throw new Error('Invalid floating bounds')
      Object.assign(placement, clampFloat({ ...placement, ...values }, client.width, client.height - 28))
      if (args.commit === true) rememberPlacement(window, placement, client.width, client.height - 28)
      await scheduleVisuals()
      if (args.commit === true) save()
      return placement
    }
    if (method.startsWith('extension.')) {
      let tab = typeof args.tab === 'string' ? tabById(model, args.tab) : undefined
      let profile = resolve(model.profiles, args.profile ?? tab?.pane.profileId, 'Profile')
      browserSession(profile.id)
      await profileNetworkReady.get(profile.id)
      if (method === 'extension.list') return extensions.list(profile.id)
      if (method === 'extension.load') return extensions.load(profile.id, required(args, 'path'))
      if (method === 'extension.install-bitwarden') {
        let before = await extensions.list(profile.id)
        let current = before.extensions.find(extension => extension.name === 'Bitwarden Password Manager')
        let installed = await extensions.load(profile.id, await installBitwardenExtension(dataDirectory, current?.path))
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
    if (method === 'bookmark.parameters.update') {
      let profile = resolve(model.profiles, required(args, 'profile'), 'Profile')
      let bookmark = bookmarkById(profile.bookmarks ?? [], required(args, 'bookmark'))
      if (!bookmark?.url) throw new Error('Bookmark not found')
      let values = args.values, hidden = args.hidden
      if (!values || typeof values !== 'object' || Array.isArray(values) || !Array.isArray(hidden)
        || Object.values(values).some(value => typeof value !== 'string' || value.length > 2048)) throw new Error('Invalid bookmark parameters')
      let keys = new Set(editableBookmarkParameters(bookmark.url, { values: values as Record<string, string>, hidden: [] }).map(([key]) => key))
      if (Object.entries(values).some(([key, value]) => !keys.has(key) || (key.startsWith('x:') && !/^\d+$/.test(value as string)))
        || hidden.some(key => typeof key !== 'string' || !keys.has(key))) throw new Error('Invalid bookmark parameters')
      let next = { ...bookmarkParameters, [profile.id]: { ...bookmarkParameters[profile.id], [bookmark.id]: { values: values as Record<string, string>, hidden: hidden as string[] } } }
      writeBookmarkParameters(parameterFile, next)
      bookmarkParameters = next
      publish()
      return next[profile.id][bookmark.id]
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
      let chrome = typeof args.pane === 'string' ? owner?.floats.get(args.pane) : owner?.chrome
      if (sourceClientId === focusedClientId && owner?.window.isFocused()) chrome?.webContents.focus()
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
    if (method === 'click-mode') {
      let clientId = typeof args.client === 'string' ? args.client : sourceClientId
      if (!clientId || clientId !== focusedClientId) throw new Error('Click mode requires the focused client')
      return { active: await activateClickMode(clientId) }
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
      if (fsSync.existsSync(bookmarkFile)) fsSync.copyFileSync(bookmarkFile, path.join(path.dirname(bookmarkFile), `bookmarks.before-brave-${Date.now()}.yaml`), fsSync.constants.COPYFILE_EXCL)
      writeModel(dataDirectory, imported.model, bookmarkFile)
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
    if (method === 'profile.proxy.set') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let profile = resolve(model.profiles, args.profile, 'Profile')
      let proxy = parseProfileProxy({ protocol: args.protocol, host: args.host, port: args.port, authenticated: args.authenticated })
      let username = typeof args.username === 'string' ? args.username : '', password = typeof args.password === 'string' ? args.password : ''
      if (!!username !== !!password) throw new Error('Enter both proxy username and password')
      let replacement = username && password ? { username, password } : proxy.authenticated ? proxyCredentials.get(profile.id) : undefined
      if (proxy.authenticated && !replacement) throw new Error('Proxy username and password are required')
      let previousProxy = profile.proxy, previousCredentials = previousProxy?.authenticated ? proxyCredentials.get(profile.id) : undefined
      let recovering = blockedProfileNetworks.has(profile.id)
      try {
        await updateProfileNetwork(profile.id, proxy, replacement)
        if (recovering) await verifyProfileProxy(profile.id)
        proxyCredentials.set(profile.id, proxy.authenticated ? replacement : undefined)
        profile.proxy = proxy
        if (!recovering) delete profileProxyTests[profile.id]
      } catch (error) {
        try { await updateProfileNetwork(profile.id, previousProxy, previousCredentials) } catch { /* Preserve the original error. */ }
        throw error
      }
      save(); reloadProfileTabs(profile.id); return profile
    }
    if (method === 'profile.proxy.clear') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let profile = resolve(model.profiles, args.profile, 'Profile')
      let previousProxy = profile.proxy, previousCredentials = previousProxy?.authenticated ? proxyCredentials.get(profile.id) : undefined
      try {
        await updateProfileNetwork(profile.id)
        proxyCredentials.set(profile.id); delete profile.proxy; delete profileProxyTests[profile.id]
        if (profileProxyFailures[profile.id]) { let next = { ...profileProxyFailures }; delete next[profile.id]; profileProxyFailures = next }
        releaseProfileNetwork(profile.id)
      }
      catch (error) { try { await updateProfileNetwork(profile.id, previousProxy, previousCredentials) } catch { /* Preserve the original error. */ }; throw error }
      save(); reloadProfileTabs(profile.id); return profile
    }
    if (method === 'profile.proxy.test') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let profile = resolve(model.profiles, args.profile, 'Profile')
      if (!profile.proxy) throw new Error('Configure a proxy first')
      delete profileProxyTests[profile.id]
      publish()
      browserSession(profile.id)
      if (!blockedProfileNetworks.has(profile.id)) await profileNetworkReady.get(profile.id)
      else if (!appliedProfileProxies.has(profile.id)) await applyProfileNetwork(profile.id)
      return verifyProfileProxy(profile.id)
    }
    if (method === 'profile.device.set') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let profile = resolve(model.profiles, args.profile, 'Profile')
      let device = parseDevicePersona(args.device)
      let previous = profile.device
      try {
        configureSessionIdentity(profile.id, device)
        let liveTabs = [...tabs].filter(([tabId, live]) => !live.contents.isDestroyed() && tabById(model, tabId).pane.profileId === profile.id)
        await Promise.all(liveTabs.map(([, live]) => applyDevicePersona(live.contents, device, live.deviceScale ?? 1)))
        for (let [, live] of liveTabs) live.deviceScale = undefined
        profile.device = device
      } catch (error) {
        configureSessionIdentity(profile.id, previous)
        if (previous) {
          try { await Promise.all([...tabs].filter(([tabId, live]) => !live.contents.isDestroyed() && tabById(model, tabId).pane.profileId === profile.id).map(([, live]) => applyDevicePersona(live.contents, previous, live.deviceScale ?? 1))) } catch { /* Preserve the original error. */ }
        } else {
          try { await recreateProfileTabs(profile.id) } catch { /* Preserve the original error. */ }
        }
        throw error
      }
      save(); reloadProfileTabs(profile.id); void scheduleVisuals(); return profile
    }
    if (method === 'profile.device.clear') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let profile = resolve(model.profiles, args.profile, 'Profile')
      let previous = profile.device
      try {
        delete profile.device
        configureSessionIdentity(profile.id)
        await recreateProfileTabs(profile.id)
      } catch (error) {
        profile.device = previous
        configureSessionIdentity(profile.id, previous)
        try { await recreateProfileTabs(profile.id) } catch { /* Preserve the original error. */ }
        throw error
      }
      save(); return profile
    }
    if (method === 'profile.cache.status') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let profile = resolve(model.profiles, args.profile, 'Profile')
      let bytes = await browserSession(profile.id).getCacheSize(), limit = 256 * 1024 * 1024
      profileCaches = { ...profileCaches, [profile.id]: { bytes, limit, checkedAt: Date.now() } }; publish()
      return profileCaches[profile.id]
    }
    if (method === 'profile.cache.clear') {
      if (!sourceClientId) throw new Error('Trusted UI required')
      let profile = resolve(model.profiles, args.profile, 'Profile')
      await browserSession(profile.id).clearCache()
      lastCacheChecks.set(profile.id, Date.now())
      profileCaches = { ...profileCaches, [profile.id]: { bytes: 0, limit: 256 * 1024 * 1024, checkedAt: Date.now() } }; publish()
      return profileCaches[profile.id]
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
    if (method === 'detach-client') {
      let client = resolve(model.clients, args.client, 'Client'), owner = clients.get(client.id)
      if (!owner) return { detached: client.id }
      if (!owner.window.isDestroyed()) {
        let closed = new Promise<void>(resolve => owner.window.once('closed', resolve))
        owner.window.close()
        await closed
      }
      return { detached: client.id }
    }
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
    if (method === 'list-panes') {
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      return window.panes.map(pane => ({ ...pane, floating: window.floating?.find(item => item.paneId === pane.id) ?? null }))
    }
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
    if (method === 'reopen-closed-tab') {
      let closed = closedTabs.at(-1)
      if (!closed) return null
      if (closed.kind === 'window') {
        let client = args.client ? resolve(model.clients, args.client, 'Client') : undefined
        let session = model.sessions.find(session => session.id === closed.sessionId)
          ?? (client ? resolve(model.sessions, client.sessionId, 'Session') : undefined)
        if (!session) throw new Error('No session available for the closed window')
        session.windows.splice(Math.min(closed.index, session.windows.length), 0, closed.window)
        if (client) { client.sessionId = session.id; client.windowId = closed.window.id; client.paneId = closed.window.panes[0]?.id ?? null }
        closedTabs.pop()
        changed(); await visualQueue; return closed.window
      }
      let { session, window, pane } = paneById(model, closed.paneId)
      if (closed.replacementTabId && pane.tabs.length === 1 && pane.tabs[0].id === closed.replacementTabId && pane.tabs[0].url === 'about:blank') pane.tabs = []
      pane.tabs.splice(Math.min(closed.index, pane.tabs.length), 0, closed.tab)
      pane.activeTabId = closed.tab.id
      if (args.client) { let client = resolve(model.clients, args.client, 'Client'); client.sessionId = session.id; client.windowId = window.id; client.paneId = pane.id }
      closedTabs.pop()
      changed(); await visualQueue; return closed.tab
    }
    if (method === 'rename-window') { let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window'); window.name = required(args, 'name'); window.automaticName = false; save(); return window }
    if (method === 'move-window') {
      let client = resolve(model.clients, args.client, 'Client')
      let session = resolve(model.sessions, client.sessionId, 'Session')
      let index = session.windows.findIndex(window => window.id === client.windowId)
      let position = args.position
      let destination = position === 'first' ? 0 : position === 'last' ? session.windows.length - 1 : Number(position) - 1
      if (!Number.isInteger(destination) || destination < 0 || destination >= session.windows.length) throw new Error(`Window index must be between 1 and ${session.windows.length}`)
      if (index === destination) return session.windows[index]
      let [window] = session.windows.splice(index, 1)
      session.windows.splice(destination, 0, window)
      changed(); await visualQueue; return window
    }
    if (method === 'reorder-window') {
      let client = resolve(model.clients, args.client, 'Client')
      let session = resolve(model.sessions, client.sessionId, 'Session')
      let window = resolve(session.windows, args.window, 'Window')
      let target = resolve(session.windows, args.target, 'Window')
      let position = args.position
      if (position !== 'before' && position !== 'after') throw new Error('Window position must be before or after')
      let sourceIndex = session.windows.indexOf(window)
      let destination = session.windows.indexOf(target) + (position === 'after' ? 1 : 0)
      if (sourceIndex < destination) destination--
      if (sourceIndex === destination) return window
      session.windows.splice(sourceIndex, 1)
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
        let rectangles = window.floating?.length && !client.zoomedPaneId ? window.panes.flatMap(pane => {
          let bounds = floatBounds(client, pane.id) ?? clients.get(client.id)?.bounds.find(bounds => bounds.tabId === pane.activeTabId)
          return bounds ? [{ ...bounds, paneId: pane.id }] : []
        }) : undefined
        client.paneId = paneInDirection(window.layout, client.paneId ?? '', direction as 'left' | 'right' | 'up' | 'down', rectangles) ?? client.paneId
      }
      // A repeated shortcut at a layout edge must not cancel a pending move.
      if (client.paneId) raisePane(window, client.paneId)
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
    if (method === 'break-pane' && args.floating !== true) {
      let parent = paneById(model, args.pane)
      if (parent.window.panes.length === 1) throw new Error('Pane is already the only pane in its window')
      return execute({ method: 'move-pane', args: { ...args, session: parent.session.id } })
    }
    if (method === 'new-pane' || method === 'break-pane') {
      let parent = args.pane ? paneById(model, args.pane) : undefined
      let window = parent?.window ?? resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      let client = model.clients.find(client => client.id === args.client) ?? model.clients.find(client => client.windowId === window.id)
      let session = parent?.session ?? model.sessions.find(session => session.windows.includes(window))!
      if (method === 'break-pane' && !parent) throw new Error('Use break-pane with a pane')
      let pane = method === 'break-pane' ? parent!.pane : newPane(resolve(model.profiles, args.profile ?? parent?.pane.profileId ?? session.defaultProfileId, 'Profile').id, args.url ? normalizeUrl(String(args.url)) : undefined)
      if (method === 'new-pane') window.panes.push(pane)
      liftPane(window, pane.id, client?.width ?? 1280, (client?.height ?? 850) - 28)
      if (args.client && args.background !== true) {
        let selected = resolve(model.clients, args.client, 'Client')
        selected.sessionId = session.id; selected.windowId = window.id; selected.paneId = pane.id; selected.zoomedPaneId = null
      }
      changed(); await visualQueue
      if (args.client && args.background !== true && focusedClientId === args.client) {
        let owner = clients.get(String(args.client)), page = tabs.get(pane.activeTabId)
        if (owner?.window.isFocused() && page?.parent === owner.window) page.contents.focus()
      }
      return pane
    }
    if (method === 'split-window') {
      let parent = args.pane ? paneById(model, args.pane) : undefined
      let window = parent?.window ?? resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      let session = parent?.session ?? model.sessions.find(session => session.windows.includes(window))!
      let pane = newPane(resolve(model.profiles, args.profile ?? parent?.pane.profileId ?? session.defaultProfileId, 'Profile').id, args.url ? normalizeUrl(String(args.url)) : undefined)
      let placement = parent && window.floating?.find(item => item.paneId === parent.pane.id)
      if (placement) { forgetPlacement(window, parent!.pane.id); dockPane(window, parent!.pane.id, placement) }
      window.layout = splitLayout(window.layout, parent?.pane.id ?? layoutPaneIds(window.layout)[0], pane.id, args.axis === 'vertical' ? 'vertical' : 'horizontal', args.before === true)
      window.panes.push(pane)
      if (args.client) resolve(model.clients, args.client, 'Client').paneId = pane.id
      changed(); await visualQueue; return pane
    }
    if (method === 'resize-pane') {
      if (args.pane) {
        let { window } = paneById(model, args.pane)
        let placement = window.floating?.find(item => item.paneId === args.pane)
        if (!placement) throw new Error('Pane is not floating')
        let width = Number(args.width ?? placement.width), height = Number(args.height ?? placement.height)
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Dimensions must be positive numbers')
        Object.assign(placement, { width, height })
        changed(); await visualQueue; return placement
      }
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      let ratio = Number(args.ratio)
      if (!Number.isFinite(ratio)) throw new Error('ratio must be numeric')
      window.layout = mapLayout(window.layout, node => node.kind === 'split' && node.id === args.split ? { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) } : node)
      save(); return window.layout
    }
    if (method === 'move-pane' || method === 'join-pane') {
      let { session: fromSession, window: from, pane } = paneById(model, args.pane)
      let placement = from.floating?.find(item => item.paneId === pane.id)
      if (args.x !== undefined || args.y !== undefined) {
        if (!placement) throw new Error('Pane is not floating')
        let x = Number(args.x ?? placement.x), y = Number(args.y ?? placement.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Coordinates must be numeric')
        Object.assign(placement, { x: Math.max(0, x), y: Math.max(0, y) })
        changed(); await visualQueue; return placement
      }
      let targetSession = args.session ? resolve(model.sessions, args.session, 'Session') : undefined
      let to = targetSession ? newWindow(from.panes.length === 1 ? from.name : `window-${targetSession.windows.length + 1}`, pane.profileId, from.panes.length === 1 ? from.automaticName : true)
        : args.destination ? paneById(model, args.destination).window : args.window ? resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window') : from
      if (to === from && !placement) throw new Error('Choose another internal window or a floating pane')
      if (args.destination && !layoutPaneIds(to.layout).includes(String(args.destination))) throw new Error('Destination must be a tiled pane')
      forgetPlacement(from, pane.id)
      if (to !== from) {
        from.panes = from.panes.filter(item => item.id !== pane.id)
        if (targetSession) {
          to.panes = [pane]; to.layout = { kind: 'pane', paneId: pane.id }
          if (to.automaticName) updateAutomaticWindowName(to, pane.id)
          targetSession.windows.push(to)
        } else to.panes.push(pane)
      }
      if (!targetSession) dockPane(to, pane.id, to === from ? placement : undefined, args.destination ? String(args.destination) : undefined, args.axis === 'vertical' ? 'vertical' : args.axis === 'horizontal' ? 'horizontal' : undefined)
      if (!from.panes.length) {
        fromSession.windows = fromSession.windows.filter(window => window !== from)
        if (!fromSession.windows.length) removeSession(model, fromSession)
      }
      if (args.client) {
        let selected = resolve(model.clients, args.client, 'Client')
        selected.sessionId = model.sessions.find(session => session.windows.includes(to))!.id; selected.windowId = to.id; selected.paneId = pane.id; selected.zoomedPaneId = null
      }
      changed(); await visualQueue; return pane
    }
    if (method === 'kill-pane') {
      let { window, pane } = paneById(model, args.pane)
      if (pane.tabs.length > 1 && args.confirm !== true) throw new Error('Pane contains multiple tabs; pass --confirm')
      if (window.panes.length === 1) {
        await execute({ method: 'kill-window', args: { window: window.id, confirm: true } })
        return { closed: pane.id }
      }
      forgetPlacement(window, pane.id); window.panes = window.panes.filter(item => item.id !== pane.id)
      changed(); await visualQueue; return { closed: pane.id }
    }
    if (method === 'kill-window') {
      let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
      if (window.panes.reduce((count, pane) => count + pane.tabs.length, 0) > 1 && args.confirm !== true) throw new Error('Window contains multiple tabs; pass --confirm')
      let session = model.sessions.find(session => session.windows.includes(window))!
      closedTabs.push({ kind: 'window', sessionId: session.id, index: session.windows.indexOf(window), window: structuredClone(window) })
      if (closedTabs.length > 25) closedTabs.shift()
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
      window.layout = replacement.layout; window.panes = replacement.panes; window.floating = replacement.floating
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
      let closed: Extract<(typeof closedTabs)[number], { kind: 'tab' }> = { kind: 'tab', paneId: pane.id, index: pane.tabs.indexOf(tab), tab: structuredClone(tab) }
      closedTabs.push(closed)
      if (closedTabs.length > 25) closedTabs.shift()
      pane.tabs = pane.tabs.filter(item => item.id !== tab.id)
      if (!pane.tabs.length) { let replacement = newTab(); pane.tabs.push(replacement); closed.replacementTabId = replacement.id }
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
      if (method === 'reload') { contents.stop(); contents.reload() }
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
    if (method === 'history.go-to') {
      let tabId = required(args, 'tab'); tabById(model, tabId)
      let contents = tabs.get(tabId)?.contents
      if (!contents || contents.isDestroyed()) throw new Error('Tab is closed')
      let index = args.index
      let history = contents.navigationHistory
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= history.length()) throw new Error('Invalid history entry')
      history.goToIndex(index)
      publish(); return { tab: tabId, index }
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
      void live.ready.then(() => { if (!live.disposed) return live.contents.loadURL(url) }).catch(error => { if (!live.disposed) { crashes[tabId] = errorText(error); publish() } }).finally(() => {
        if (live.pendingNavigation !== navigation) return
        live.pendingNavigation = undefined
        if (live.pendingUrl === url) live.pendingUrl = undefined
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
      let live = tabs.get(tabId)!
      await live.ready
      let contents = live.contents
      let background = resolve(model.profiles, pane.profileId, 'Profile').background
      contents.setBackgroundThrottling(false)
      let syntheticInput = ['click', 'type', 'key'].includes(method) || (method === 'cdp' && String(args.method).startsWith('Input.'))
      if (syntheticInput) { automatedContents.add(contents.id); contents.setIgnoreMenuShortcuts(true) }
      try {
        if (method === 'navigate') { await contents.loadURL(normalizeUrl(required(args, 'url'))); return { id: tab.id, url: contents.getURL() } }
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
    restoringTabs = false
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
    app.off('login', proxyLogin)
    void proxyRelays.closeAll()
    clickMode.cancel()
    crashRecovery.close()
    extensions.close()
    for (let window of extensionWindows) if (!window.isDestroyed()) window.destroy()
    pageTools?.close()
    filters?.close()
    plugins?.close()
    configuration?.close()
    clearTimeout(persistTimer); clearTimeout(publishTimer)
    writeModel(dataDirectory, model, bookmarkFile)
    for (let tabId of tabs.keys()) disposeTab(tabId)
    for (let host of hosts.values()) if (!host.isDestroyed()) host.destroy()
  }
  return { execute, state, start, shutdown, sourceClient, setBounds, createClient, preferredClient, get model() { return model }, get tabCount() { return tabs.size } }
}
