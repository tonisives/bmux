import { ConnectionIndicator } from './ConnectionIndicator'
import { connectionLabels, initialSecurity } from '../shared/site-security'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeEvent, DragEvent, FocusEvent, FormEvent, KeyboardEvent, PointerEvent, MouseEvent, RefObject } from 'react'
import type { Bookmark, BookmarkParameters, Bridge, DevicePlatform, DevicePreset, Download, HistoryEntry, InternalWindow, Layout, Permission, Profile, PublicState } from '../shared/types'
import css from './App.module.css'
import { SearchInput } from './SearchInput'
import { DEFAULT_KEYBOARD, shortcutAction, shortcutLabel } from '../shared/keyboard'
import { commandEntries, fuzzyMatch, HELP_NOTES, literalCommand, PANEL_COMMANDS, searchCommands } from '../shared/command-search'
import type { CommandEntry } from '../shared/command-search'
import { searchBookmarkPages, searchBookmarks, searchHistory } from '../shared/picker-search'
import { windowCloseBehavior } from '../shared/window-close'
import { inlineUrlCompletion, prioritizeInlineHistory } from '../shared/address-suggestions'
import { deleteWordBackward } from '../shared/text-edit'
import { bookmarkParameterPresentation, editableBookmarkParameters, parameterizedBookmarkUrl } from '../shared/bookmark-parameters'
import { clampFloat } from '../shared/floating'
import type { ClickAction } from '../shared/click-mode'
import { CloseButton } from './CloseButton'
import type { PluginProxyProvider, PluginProxyRegion } from '../shared/plugins'

type ManagementControl = 'rename-window' | 'rename-session' | 'move-window' | 'close-pane' | 'close-window'
type Control = ManagementControl | 'address' | 'command' | 'find' | 'help' | 'sessions' | 'bookmark' | 'bookmarks' | 'history' | 'activity' | 'downloads' | 'extensions' | 'profiles' | 'proxy' | 'settings' | 'plugins' | 'plugin-dialog' | 'browser-tools' | 'site-info'
type HistoryPopup = { tabId: string; direction: 'back' | 'forward' }
type AddressSelection = { start: number; end: number; direction: 'forward' | 'backward' | 'none' }
type Notification = { id: string; text: string; dismiss?: () => void; actions?: { label: string; run: () => void }[] }
type BrowserExtension = { id: string; name: string; version: string; path: string }
type ExtensionList = { extensions: BrowserExtension[]; available: Omit<BrowserExtension, 'id'>[]; errors: { path: string; error: string }[] }
type UIContext = { state: PublicState; control: Control | null; historyPopup: HistoryPopup | null; setHistoryPopup: (popup: HistoryPopup | null) => void; addressFocusVersion: number; setAddressSuggestionsVisible: (visible: boolean) => void; message: string; onMessage: (message: string) => void; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>; show: (control: Control, paneId?: string) => void; dismiss: () => void; bookmarkSearches: Record<string, string>; rememberBookmarkSearch: (profileId: string, query: string) => void; acknowledgeDownload: (downloadId: string) => void; acknowledgedDownloads: Set<string> }

export let App = () => {
  let [state, setState] = useState<PublicState | null>(null)
  let [control, setControl] = useState<Control | null>(null)
  let [historyPopup, setHistoryPopup] = useState<HistoryPopup | null>(null)
  let [addressFocusVersion, setAddressFocusVersion] = useState(0)
  let [addressSuggestionsVisible, setAddressSuggestionsVisible] = useState(false)
  let [message, setMessage] = useState('')
  let [dismissedConfigError, setDismissedConfigError] = useState(''), [dismissedStartupNotice, setDismissedStartupNotice] = useState('')
  let [bookmarkSearches, setBookmarkSearches] = useState<Record<string, string>>({})
  let [acknowledgedDownloads, setAcknowledgedDownloads] = useState<Set<string>>(() => new Set())
  let previous = useRef('')
  let knownPanes = useRef<Set<string> | null>(null)
  let previousControl = useRef<Control | null>(null), previousHistoryPopup = useRef(false)
  let accept = useCallback((next: PublicState) => {
    let { client, tab, window } = selection(next)
    let target = `${client?.windowId}:${client?.paneId}:${tab?.id}`
    if (previous.current && previous.current !== target) { setControl(null); setHistoryPopup(null); setMessage('') }
    let paneIds = next.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => pane.id)))
    if (client?.paneId && !window?.floating?.some(item => item.paneId === client.paneId) && client.id === next.focusedClientId && knownPanes.current && !knownPanes.current.has(client.paneId) && tab?.url === 'about:blank' && !tab.openerPaneId) {
      setControl('address')
      void bridge.command({ method: 'focus-ui', args: { client: client.id } }).catch(error => setMessage(String(error)))
    }
    knownPanes.current = new Set(paneIds)
    if (next.pluginPrompt) setControl('plugin-dialog')
    else setControl(current => current === 'plugin-dialog' ? null : current)
    previous.current = target; setState(next)
  }, [])
  let run = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    try { return await bridge.command({ method, args }) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return undefined }
  }, [])
  let show = useCallback(async (control: Control, paneId?: string) => {
    setHistoryPopup(null)
    if (paneId) {
      let current = await bridge.state()
      if (selection(current).pane?.id !== paneId) {
        if (await run('select-pane', { client: current.clientId, pane: paneId, focus: false }) === undefined) return
        current = await bridge.state()
      }
      accept(current)
    }
    if (control === 'address') { void run('focus-ui', { pane: paneId }); setAddressFocusVersion(version => version + 1) }
    setMessage(''); setControl(control)
  }, [accept, run])
  let dismiss = useCallback(() => {
    if (state?.pluginPrompt) void bridge.command({ method: 'plugin.respond', args: { id: state.pluginPrompt.id, cancel: true } }).catch(() => undefined)
    setControl(null); setHistoryPopup(null); setMessage('')
  }, [state?.pluginPrompt])
  let acknowledgeDownload = useCallback((downloadId: string) => setAcknowledgedDownloads(current => new Set(current).add(downloadId)), [])
  let rememberBookmarkSearch = useCallback((profileId: string, query: string) => setBookmarkSearches(current => ({ ...current, [profileId]: query })), [])
  useEffect(() => {
    let unsubscribe = bridge.subscribe(accept)
    void bridge.state().then(accept).catch(error => setMessage(String(error)))
    let controls = bridge.controls(control => {
      if (control === 'dismiss') { dismiss(); return }
      void bridge.state().then(next => { accept(next); if (control !== 'plugin-dialog') show(control as Control) })
    })
    return () => { unsubscribe(); controls() }
  }, [accept, show, dismiss])
  let management = control === 'rename-window' || control === 'rename-session' || control === 'move-window' || control === 'close-pane' || control === 'close-window'
  let prompt = management || control === 'address' || control === 'command' || control === 'find'
  let panel = control && !prompt ? control : null
  useEffect(() => {
    if (!state?.clientId) return
    let restoreFocus = previousHistoryPopup.current || ['site-info', 'sessions', 'bookmark', 'bookmarks', 'history', 'find', 'downloads', 'extensions', 'activity', 'profiles', 'proxy'].includes(previousControl.current ?? '')
    previousControl.current = control
    previousHistoryPopup.current = !!historyPopup
    let cancelled = false
    // Child layout effects publish the selected page's bounds before it receives focus.
    void run('client.overlay', { client: state.clientId, visible: !!panel || control === 'command' || !!historyPopup || (control === 'address' && addressSuggestionsVisible) }).then(() => {
      if (!cancelled && !control && restoreFocus) void run('focus-page', { client: state.clientId })
    })
    return () => { cancelled = true }
  }, [panel, control, historyPopup, addressSuggestionsVisible, state?.clientId, run])
  useEffect(() => {
    let escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [dismiss])
  useEffect(() => { if (!state?.configError) setDismissedConfigError('') }, [state?.configError])
  if (!state) return <div className={css.empty}>{message || 'Starting…'}</div>
  let { client, window } = selection(state)
  if (!client || !window) return <div className={css.empty}>Attaching…</div>
  let layout = client.zoomedPaneId && window.panes.some(pane => pane.id === client.zoomedPaneId) ? { kind: 'pane' as const, paneId: client.zoomedPaneId } : window.layout
  let notices: Notification[] = [
    ...(!prompt && control !== 'address' && message ? [{ id: 'message', text: message, dismiss: () => setMessage('') }] : []),
    ...(state.configError && state.configError !== dismissedConfigError ? [{ id: 'config', text: state.configError, dismiss: () => setDismissedConfigError(state.configError!) }] : []),
    ...(state.startupNotice && state.startupNotice !== dismissedStartupNotice ? [{ id: 'startup', text: state.startupNotice, dismiss: () => setDismissedStartupNotice(state.startupNotice!) }] : []),
    ...proxyFailureNotices(state, window, run, show),
  ]
  let context = { state, control, historyPopup, setHistoryPopup, addressFocusVersion, setAddressSuggestionsVisible, message, onMessage: setMessage, run, show, dismiss, bookmarkSearches, rememberBookmarkSearch, acknowledgeDownload, acknowledgedDownloads }
  return <Context.Provider value={context}><div className={css.app} data-status-bar={state.statusBar ?? 'top'}>
    <main className={css.workspace}>{layout ? <Branch node={layout} /> : !window.floating?.length && <section className={css.pane}><PaneAddress /><EmptyPane /></section>}{!client.zoomedPaneId && window.floating?.map(item => <FloatingPreview key={item.paneId} paneId={item.paneId} />)}</main>
    <footer className={css.status} aria-label="Browser status">
      {control === 'rename-window' || control === 'rename-session' || control === 'move-window' || control === 'close-pane' || control === 'close-window' ? <ManagementPrompt key={`${control}:${client.windowId}:${client.paneId}`} mode={control} message={message} /> : control === 'command' ? <CommandPrompt key={`${client.windowId}:${client.paneId}`} /> : control === 'find' ? <FindPrompt key={`${client.windowId}:${client.paneId}`} /> : <Status />}
    </footer>
    {notices.length > 0 && <Notifications notices={notices} />}
    {panel && <Panel key={panel} type={panel} />}
  </div></Context.Provider>
}

let proxyFailureNotices = (state: PublicState, window: InternalWindow, run: UIContext['run'], show: UIContext['show']): Notification[] => Object.entries(state.profileProxyFailures).flatMap(([profileId, failure]) => {
  let pane = window.panes.find(item => item.profileId === profileId)
  if (!pane) return []
  let name = state.model.profiles.find(item => item.id === profileId)?.name ?? profileId
  return [{ id: `proxy:${profileId}`, text: `Proxy for ${name} could not connect. Pages using it are paused. ${failure.error}`, actions: [{ label: 'Proxy settings', run: () => { void show('proxy', pane.id) } }, { label: 'Disable proxy and continue', run: () => { void run('profile.proxy.clear', { profile: profileId }) } }] }]
})

const AVATAR_COLORS = ['#89a8c7', '#b891c7', '#c9907b', '#87ad91', '#c4a96a', '#789fb0']

let profileHash = (value: string) => [...value].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
let profileDeviceLabel = (profile: Profile) => !profile.device ? 'desktop' : ({ 'pixel-8': 'Pixel 8', 'galaxy-s24': 'Galaxy S24', 'iphone-15-pro': 'iPhone 15 Pro', 'iphone-15-pro-max': 'iPhone 15 Pro Max', custom: profile.device.platform === 'android' ? 'Android' : 'iOS' })[profile.device.preset]

let ProfileAvatar = ({ id, name }: { id: string; name: string }) => {
  let hash = profileHash(id), background = AVATAR_COLORS[hash % AVATAR_COLORS.length], foreground = AVATAR_COLORS[(hash >>> 5) % AVATAR_COLORS.length]
  let left = 3 + (hash % 5), top = 3 + ((hash >>> 3) % 5), radius = 4 + ((hash >>> 6) % 3)
  return <svg className={css.profileAvatar} viewBox="0 0 20 20" aria-hidden="true" data-profile-avatar={id}>
    <rect width="20" height="20" fill={background} />
    <circle cx={left} cy={top} r={radius} fill={foreground} opacity=".9" />
    <path d={`M0 ${12 + (hash % 4)} Q${8 + (hash % 5)} ${5 + ((hash >>> 8) % 5)} 20 ${11 + ((hash >>> 11) % 5)} V20 H0Z`} fill="#17202a" opacity=".45" />
    <text x="10" y="14" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700" fontFamily="ui-monospace, monospace">{name.trim().charAt(0).toUpperCase()}</text>
  </svg>
}

let ProfileDeviceIcon = ({ mobile }: { mobile: boolean }) => mobile
  ? <svg className={css.profileRouteIcon} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="device"><rect x="5" y="1.5" width="8" height="15" rx="1" /><path d="M8 14h2" /></svg>
  : <svg className={css.profileRouteIcon} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="device"><rect x="2" y="3" width="14" height="9" rx="1" /><path d="M6 15h6M9 12v3" /></svg>

let ProfileConnectionIcon = ({ proxy, verified = false }: { proxy: boolean; verified?: boolean }) => proxy
  ? <svg className={`${css.profileRouteIcon} ${verified ? css.profileRouteIconVerified : ''}`} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="connection" data-proxy-verified={verified || undefined}><circle cx="4" cy="5" r="1.5" /><circle cx="14" cy="4" r="1.5" /><circle cx="13" cy="14" r="1.5" /><path d="m5.5 5 7-1M5 6.2l7 6.6" /></svg>
  : <svg className={css.profileRouteIcon} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="connection"><circle cx="9" cy="9" r="7" /><path d="M2 9h14M9 2c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z" /></svg>

let ProxyTestSuccess = ({ ip, region }: { ip: string; region?: string }) => <div className={css.proxyTestSuccess} role="status" aria-label={`Proxy test passed. Exit IP: ${ip}${region ? `. Region: ${region}` : ''}`}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="m5 8 2 2 4-4" /></svg><dl><div><dt>Exit IP</dt><dd>{ip}</dd></div>{region && <div><dt>Region</dt><dd>{region}</dd></div>}</dl></div>

let DownloadStatusIcon = ({ progressing, progress }: { progressing: boolean; progress?: number }) => progressing
  ? <svg className={`${css.statusIcon} ${progress === undefined ? css.downloadProgressIndeterminate : ''}`} viewBox="0 0 20 20" aria-hidden="true" data-download-icon="progressing" data-download-progress={progress}>
    <circle className={css.downloadProgressTrack} cx="10" cy="10" r="7" pathLength="100" />
    <circle className={css.downloadProgressValue} cx="10" cy="10" r="7" pathLength="100" strokeDasharray={progress === undefined ? undefined : `${progress} ${100 - progress}`} />
    <path d="M10 5v6m-2-2 2 2 2-2" />
  </svg>
  : <svg className={css.statusIcon} viewBox="0 0 20 20" aria-hidden="true" data-download-icon="idle"><path d="M10 2v10m-4-4 4 4 4-4M4 17h12" /></svg>

let ExtensionsIcon = () => <svg className={css.statusIcon} viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h4V5a2 2 0 0 1 4 0v2h4v9h-4v-2a2 2 0 0 0-4 0v2H4Z" /></svg>

let bridge = (window as unknown as { bmux: Bridge }).bmux
let Context = createContext<UIContext | null>(null)
let useUI = () => useContext(Context)!
let selection = (state: PublicState) => {
  let client = state.model.clients.find(client => client.id === state.clientId)
  let session = state.model.sessions.find(session => session.id === client?.sessionId)
  let window = session?.windows.find(window => window.id === client?.windowId)
  let pane = window?.panes.find(pane => pane.id === client?.paneId)
  let tab = pane
  let profile = state.model.profiles.find(profile => profile.id === pane?.profileId)
  return { client, session, window, pane, tab, profile }
}

let Notifications = ({ notices }: { notices: Notification[] }) => <div className={css.notifications} aria-label="Notifications">
  {notices.map(notice => <div key={notice.id} className={css.notification} role="status"><span>{notice.text}</span>{notice.actions?.map(action => <button type="button" key={action.label} className={css.notificationAction} onClick={action.run}>{action.label}</button>)}{notice.dismiss && <button type="button" onClick={notice.dismiss} aria-label="Dismiss notification"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>}</div>)}
</div>

let Status = () => {
  let { state, show, run, acknowledgedDownloads } = useUI()
  let { client, session, profile } = selection(state)
  let windows = useRef<HTMLDivElement>(null)
  let draggedWindow = useRef<string | null>(null)
  let [drop, setDrop] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  let dropAt = (event: DragEvent<HTMLDivElement>) => {
    let tab = (event.target as HTMLElement).closest<HTMLElement>('[data-window-id]')
    if (!tab || !windows.current?.contains(tab)) return null
    return { id: tab.dataset.windowId!, position: event.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2 ? 'before' as const : 'after' as const }
  }
  let startWindowDrag = (event: DragEvent<HTMLDivElement>) => {
    let button = (event.target as HTMLElement).closest<HTMLElement>(`.${css.windowSelect}`)
    let id = button?.closest<HTMLElement>('[data-window-id]')?.dataset.windowId
    if (!id) return
    draggedWindow.current = id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  let overWindow = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedWindow.current) return
    let target = dropAt(event)
    if (!target || target.id === draggedWindow.current) { setDrop(null); return }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDrop(current => current?.id === target.id && current.position === target.position ? current : target)
  }
  let finishWindowDrag = () => { draggedWindow.current = null; setDrop(null) }
  let dropWindow = (event: DragEvent<HTMLDivElement>) => {
    let source = draggedWindow.current, target = dropAt(event)
    finishWindowDrag()
    if (!source || !target || source === target.id) return
    event.preventDefault()
    void run('reorder-window', { client: state.clientId, window: source, target: target.id, position: target.position })
  }
  let sessions = () => show('sessions')
  let profiles = () => show('profiles')
  let proxy = () => show('proxy')
  let help = () => show('help')
  let commands = () => show('command')
  let activity = () => show('activity')
  let downloads = () => show('downloads')
  let extensions = () => show('extensions')
  let unhandledDownloads = state.downloads.filter(item => item.profileId === profile?.id && !acknowledgedDownloads.has(item.id))
  let progressingDownloads = unhandledDownloads.filter(item => item.active && item.state === 'progressing' && !item.paused)
  let progressTotal = progressingDownloads.reduce((total, item) => total + item.total, 0)
  let downloadProgress = progressingDownloads.length > 0 && progressingDownloads.every(item => item.total > 0)
    ? Math.min(100, Math.floor(progressingDownloads.reduce((received, item) => received + item.received, 0) / progressTotal * 100))
    : undefined
  let downloadTitle = progressingDownloads.length
    ? `${progressingDownloads.length} download${progressingDownloads.length === 1 ? '' : 's'} in progress${downloadProgress === undefined ? '' : ` · ${downloadProgress}%`}`
    : 'Downloads'
  let proxyTest = profile ? state.profileProxyTests[profile.id] : undefined
  let proxyFailure = profile ? state.profileProxyFailures[profile.id] : undefined
  let profileTitle = profile ? `Profile: ${profile.name}` : 'Profile'
  let proxyTitle = proxyTest ? `Proxy verified · Exit IP: ${proxyTest.ip}` : proxyFailure ? `Proxy unavailable · ${proxyFailure.error}` : profile?.proxy ? `${profile.proxy.protocol}://${profile.proxy.host}:${profile.proxy.port}` : ''
  useLayoutEffect(() => {
    let list = windows.current
    if (!list) return
    let reveal = () => {
      let active = list.querySelector<HTMLElement>('[data-active="true"]')
      if (!active) return
      let item = active.getBoundingClientRect(), bounds = list.getBoundingClientRect()
      if (item.left < bounds.left) list.scrollLeft = Math.max(0, list.scrollLeft - (bounds.left - item.left) - 1)
      else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right + 1
    }
    let observer = new ResizeObserver(reveal)
    observer.observe(list); reveal()
    return () => observer.disconnect()
  }, [client?.windowId, session?.windows.length])
  let reclaim = () => { void run('remote.reclaim') }
  return <><button onClick={sessions} aria-label="Sessions" className={css.session}>[{session!.name}{session!.private && <PrivateIcon />}]</button>
    <div ref={windows} className={css.windows} data-window-list onDragStart={startWindowDrag} onDragOver={overWindow} onDrop={dropWindow} onDragEnd={finishWindowDrag}>{session!.windows.map((window, index) => <StatusWindow key={window.id} window={window} index={index + 1} active={window.id === client!.windowId} dropPosition={drop?.id === window.id ? drop.position : undefined} />)}</div>
    <span className={css.drag} />
    {state.remoteControl?.[session!.id] && <button onClick={reclaim}>Reclaim control</button>}
    <button onClick={profiles} aria-label={profile ? `Profile: ${profile.name}` : 'Profile'} title={profileTitle} className={css.profileButton}>{profile && <ProfileAvatar id={profile.id} name={profile.name} />}</button>
    {profile?.proxy && <button type="button" onClick={proxy} aria-label={`Proxy for ${profile.name}${proxyFailure ? ', unavailable' : ''}`} title={proxyTitle} className={css.proxyButton} data-proxy-failed={!!proxyFailure || undefined}><ProfileConnectionIcon proxy verified={!!proxyTest} /></button>}
    {state.permissions.length > 0 && <button onClick={activity} aria-label="Activity">permission:{state.permissions.length}</button>}
    {unhandledDownloads.length > 0 && <button onClick={downloads} aria-label="Downloads" title={downloadTitle} className={css.downloadButton}><DownloadStatusIcon progressing={progressingDownloads.length > 0} progress={downloadProgress} />{progressingDownloads.length > 1 && <span className={css.downloadCount}>{progressingDownloads.length}</span>}</button>}
    <button onClick={extensions} aria-label="Extensions" title="Extensions" className={css.extensionsButton}><ExtensionsIcon /></button>
    <button onClick={commands} aria-label="Command prompt">:</button><button onClick={help} aria-label="Help" title="Ctrl+B then ?">?</button>
  </>
}
let StatusWindow = ({ window, index, active, dropPosition }: { window: InternalWindow; index: number; active: boolean; dropPosition?: 'before' | 'after' }) => {
  let { state, run } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)
  let pane = window.panes.find(pane => active && pane.id === client?.paneId) ?? window.panes[0]
  let tabId = pane?.id
  let label = `${index}:${window.name}${active ? '*' : ''}`
  let select = () => { void run('select-window', { client: state.clientId, window: window.id }) }
  let close = () => { void run('kill-window', { window: window.id, confirm: true }) }
  let menu = (event: MouseEvent<HTMLElement>) => { event.preventDefault(); void run('window.menu', { window: window.id }) }
  return <span className={css.windowTab} data-window-id={window.id} data-drop-position={dropPosition} onContextMenu={menu}>
    <button onClick={select} className={css.windowSelect} data-active={active} title={window.name} draggable>
      {tabId && (state.loading[tabId] ? <span className={css.tabSpinner} aria-hidden="true" data-tab-loading /> : state.favicons[tabId] ? <img className={css.tabFavicon} src={state.favicons[tabId]} alt="" /> : null)}
      <span className={css.windowLabel}>{label}</span>
    </button>
    {state.showTabCloseButtons === true && <button onClick={close} className={css.windowClose} aria-label={`Close ${window.name}`} title={`Close ${window.name}`}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>}
  </span>
}

let commandHistory: string[] = []
let rememberCommand = (line: string) => {
  if (!line.trim()) return
  if (commandHistory.at(-1) !== line) commandHistory.push(line)
  commandHistory = commandHistory.slice(-100)
}
let MatchText = ({ value, query }: { value: string; query: string }) => {
  let positions = new Set(query.trim().split(/\s+/).flatMap(term => fuzzyMatch(term, value)?.positions ?? []))
  let parts: { start: number; value: string; matched: boolean }[] = []
  for (let index = 0; index < value.length; index++) {
    let matched = positions.has(index), previous = parts.at(-1)
    if (previous?.matched === matched) previous.value += value[index]
    else parts.push({ start: index, value: value[index], matched })
  }
  return <>{parts.map(part => part.matched ? <mark key={part.start}>{part.value}</mark> : <span key={part.start}>{part.value}</span>)}</>
}
let CommandOption = ({ entry, position, active, query, busy, choose }: { entry: CommandEntry; position: number; active: boolean; query: string; busy: boolean; choose: (event: MouseEvent<HTMLButtonElement>) => void }) => (
  <button id={`command-result-${position}`} type="button" role="option" aria-selected={active} tabIndex={-1} className={css.commandOption} data-command={entry.command} onClick={choose} disabled={busy}><span className={css.commandName}><MatchText value={entry.usage ?? entry.command} query={query} /></span><span className={css.commandDescription}><MatchText value={entry.description} query={query} /></span><span className={css.commandKeys}>{entry.shortcuts?.join(' · ')}</span></button>
)

let CommandPrompt = () => {
  let { state, run, show, dismiss, message } = useUI()
  let [text, setText] = useState(''), [index, setIndex] = useState(0), [selected, setSelected] = useState(false), [busy, setBusy] = useState(false)
  let input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null), mounted = useRef(true), currentText = useRef('')
  let historyIndex = useRef(commandHistory.length), draft = useRef('')
  let entries = commandEntries(state.keyboard ?? DEFAULT_KEYBOARD, state.plugins)
  let literal = literalCommand(text), argumentsStarted = literal && /\S\s/.test(text.trimStart())
  let query = argumentsStarted ? text.trim().split(/\s+/)[0] : text
  let results = searchCommands(entries, query, commandHistory).slice(0, 80)
  let active = results[Math.min(index, Math.max(0, results.length - 1))]
  useEffect(() => { input.current?.focus(); mounted.current = true; return () => { mounted.current = false; rememberCommand(currentText.current) } }, [])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [index, text])
  let finish = () => { dismiss(); void run('client.overlay', { client: state.clientId, visible: false }).then(() => run('focus-page', { client: state.clientId })) }
  let edit = (line: string) => { currentText.current = line; setText(line); setIndex(0); setSelected(false); input.current?.focus() }
  let complete = (line: string) => { historyIndex.current = commandHistory.length; edit(line) }
  let change = (event: ChangeEvent<HTMLInputElement>) => { draft.current = event.target.value; historyIndex.current = commandHistory.length; edit(event.target.value) }
  let execute = async (line: string, entry?: CommandEntry) => {
    if (busy) return
    if (entry?.complete) { complete(entry.command); return }
    if (!line.trim()) return
    let exact = entries.find(item => item.command === line.trim())
    if (exact?.control) {
      rememberCommand(line)
      let { session, window } = selection(state)
      if (exact.control !== 'close-window' || !session || !window) { show(exact.control); return }
      let behavior = windowCloseBehavior(session, window)
      if (behavior === 'confirm') { show(exact.control); return }
      setBusy(true)
      let result = await run('kill-window', { client: state.clientId, window: window.id, confirm: true })
      if (!mounted.current) return
      setBusy(false)
      if (result !== undefined) finish()
      return
    }
    if (PANEL_COMMANDS.some(panel => panel === line.trim())) { rememberCommand(line); show(line.trim() as Control); return }
    setBusy(true); rememberCommand(line)
    let result = await run('command-line', { client: state.clientId, line })
    if (!mounted.current) return
    setBusy(false)
    if (result !== undefined) finish()
  }
  let submit = (event: FormEvent) => {
    event.preventDefault()
    if (active && (selected || !literal || (!argumentsStarted && active.complete))) void execute(active.command, active)
    else void execute(text)
  }
  let choose = (event: MouseEvent<HTMLButtonElement>) => {
    let entry = results.find(item => item.command === event.currentTarget.dataset.command)
    if (entry) void execute(entry.command, entry)
  }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); return }
    if (busy) return
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); void execute(text); return }
    let key = event.key.toLowerCase()
    if (event.ctrlKey && ['r', 's'].includes(key)) {
      event.preventDefault()
      if (historyIndex.current === commandHistory.length) { if (key === 's') return; draft.current = text }
      historyIndex.current = Math.max(0, Math.min(commandHistory.length, historyIndex.current + (key === 'r' ? -1 : 1)))
      edit(commandHistory[historyIndex.current] ?? draft.current); return
    }
    if (event.key === 'Tab' && active) { event.preventDefault(); complete(active.command); return }
    if (['ArrowUp', 'ArrowDown'].includes(event.key) || (event.ctrlKey && ['p', 'n'].includes(key))) {
      event.preventDefault(); setSelected(true)
      let direction = event.key === 'ArrowUp' || key === 'p' ? -1 : 1
      if (results.length) setIndex((index + direction + results.length) % results.length)
    }
  }
  return <><form className={css.prompt} onSubmit={submit}><label htmlFor="command">:</label><input id="command" ref={input} aria-label="Command" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant={active ? `command-result-${results.indexOf(active)}` : undefined} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || (busy ? 'running…' : 'esc')}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
    <section className={css.commandFinder} aria-label="Command finder"><div className={css.finderHint}>Type to find · ↑/↓ or Ctrl+P/N select · Tab complete · Enter {argumentsStarted && !selected ? 'run typed command' : 'open / run'} · Ctrl+R history</div>
      <div ref={list} id="command-results" role="listbox" aria-label="Commands" className={css.commandResults}>{results.map((entry, position) => <CommandOption key={entry.command} entry={entry} position={position} active={entry === active} query={query} busy={busy} choose={choose} />)}</div>
      {!results.length && <p className={css.finderHint}>No matching commands. Enter runs the text you typed.</p>}
    </section></>
}

let useAddressSuggestionPosition = (form: RefObject<HTMLFormElement | null>, list: RefObject<HTMLDivElement | null>, visible: boolean, statusBar?: string) => {
  useLayoutEffect(() => {
    if (!visible || !form.current || !list.current) return
    let bar = form.current.closest('[aria-label="Pane address"]')
    let pane = bar?.parentElement
    let position = () => {
      if (!bar || !list.current) return
      let bottom = bar.getBoundingClientRect().bottom
      let available = window.innerHeight - bottom - (statusBar === 'bottom' ? 28 : 0)
      list.current.style.top = `${bottom}px`
      list.current.style.maxHeight = `${Math.max(0, available * .9)}px`
    }
    position()
    let observer = new ResizeObserver(position)
    if (pane) observer.observe(pane)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [form, list, visible, statusBar])
}

let useAddressFocus = (ref: RefObject<HTMLInputElement | null>, focusVersion: number, takeSelection: () => AddressSelection | undefined) => {
  useEffect(() => {
    let input = ref.current
    if (!input) return
    input.focus()
    let selection = takeSelection()
    if (selection) input.setSelectionRange(selection.start, selection.end, selection.direction)
    else input.select()
  }, [focusVersion, ref, takeSelection])
}

let useDismissAddressOnPageClick = (finish: () => void) => {
  useEffect(() => {
    let outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-browser-content]')) finish()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [finish])
}

let AddressPrompt = ({ takeSelection }: { takeSelection: () => AddressSelection | undefined }) => {
  let { state, run, dismiss, message, onMessage, addressFocusVersion, setAddressSuggestionsVisible } = useUI()
  let { client, pane, tab, profile } = selection(state)
  let [index, setIndex] = useState(-1)
  let currentUrl = tab ? state.pendingUrls[tab.id] ?? tab.url : ''
  let [text, setText] = useState(currentUrl !== 'about:blank' ? currentUrl : '')
  let [query, setQuery] = useState('')
  let [inlineUrl, setInlineUrl] = useState<{ value: string; url: string }>()
  let [expandedHistory, setExpandedHistory] = useState(false)
  let [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  let form = useRef<HTMLFormElement>(null)
  let suggestionList = useRef<HTMLDivElement>(null)
  let deleting = useRef(false)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useAddressFocus(ref, addressFocusVersion, takeSelection)
  let profileHistory = profile?.history ?? []
  let inlineHistory = inlineUrl ? profileHistory.find(entry => entry.url === inlineUrl.url) : undefined
  let bookmarkMatches = searchBookmarkPages(profile?.bookmarks ?? [], query)
  let inlineBookmark = inlineHistory && bookmarkMatches.slice(0, 8).some(bookmark => bookmark.url === inlineHistory.url)
  let bookmarks = bookmarkMatches.slice(0, inlineHistory && !inlineBookmark ? 7 : 8)
  let bookmarkUrls = new Set(bookmarks.map(bookmark => bookmark.url))
  let historyMatches = query.trim() ? searchHistory(profileHistory, query) : []
  let availableHistory = prioritizeInlineHistory(historyMatches, profileHistory, inlineUrl?.url).filter(entry => !bookmarkUrls.has(entry.url))
  let history = availableHistory.slice(0, expandedHistory ? undefined : 10 - bookmarks.length)
  let results = [
    ...bookmarks.map(bookmark => ({ kind: 'bookmark', value: parameterizedBookmarkUrl(bookmark.url!, state.bookmarkParameters?.[profile!.id]?.[bookmark.id]), title: bookmark.title, detail: bookmark.url! })),
    ...history.map(entry => ({ kind: 'history', value: entry.url, title: entry.title, detail: entry.url })),
    ...(availableHistory.length > history.length ? [{ kind: 'more', value: '', title: `Show ${availableHistory.length - history.length} more history matches`, detail: '' }] : []),
  ]
  let selectedResult = results[index]
  let selectedCompletion = selectedResult?.value ? inlineUrlCompletion(query, selectedResult.value) : undefined
  let previewText = selectedResult?.value ? selectedCompletion?.value ?? selectedResult.value : text
  useEffect(() => { setAddressSuggestionsVisible(results.length > 0); return () => setAddressSuggestionsVisible(false) }, [results.length, setAddressSuggestionsVisible])
  useAddressSuggestionPosition(form, suggestionList, results.length > 0, state.statusBar)
  useEffect(() => { setIndex(current => Math.min(current, results.length - 1)) }, [results.length])
  useEffect(() => { if (index >= 0) suggestionList.current?.children[index]?.scrollIntoView({ block: 'nearest' }) }, [index])
  useLayoutEffect(() => {
    if (!ref.current || (!inlineUrl && !selectedResult)) return
    let start = previewText.toLowerCase().startsWith(query.toLowerCase()) ? query.length : 0
    ref.current.setSelectionRange(start, previewText.length)
  }, [inlineUrl, selectedResult, previewText, query])
  let change = (event: ChangeEvent<HTMLInputElement>) => {
    let value = event.target.value
    let deletion = deleting.current || ((event.nativeEvent as InputEvent).inputType?.startsWith('delete') ?? false)
    deleting.current = false
    let completion = deletion ? undefined : profileHistory.map(entry => inlineUrlCompletion(value, entry.url)).find(Boolean)
    setQuery(value); setIndex(-1); setInlineUrl(completion); setExpandedHistory(false); setText(completion?.value ?? value)
  }
  let finish = () => { dismiss(); void run('client.overlay', { client: client!.id, visible: false }).then(() => run('focus-page', { client: client!.id })) }
  useDismissAddressOnPageClick(finish)
  let navigate = async (url: string) => {
    if (!url.trim() || busy) return
    setBusy(true)
    let target = tab?.id
    if (!target) {
      let created = await run('split-window', { window: client!.windowId, client: client!.id }) as { id: string } | undefined
      target = created?.id
    }
    let result = target ? await run('navigate', { tab: target, url, waitUntil: 'none' }) : undefined
    if (!mounted.current) return
    setBusy(false)
    if (result === undefined) { if (!tab && !pane) onMessage('Create a pane first'); return }
    finish()
  }
  let submit = (event: FormEvent) => { event.preventDefault(); if (selectedResult?.kind === 'more') { setExpandedHistory(true); setIndex(-1); return }; void navigate(selectedResult?.value ?? inlineUrl?.url ?? text) }
  let choose = (event: MouseEvent<HTMLButtonElement>) => { if (event.currentTarget.dataset.kind === 'more') { setExpandedHistory(true); setIndex(-1); return }; void navigate(event.currentTarget.dataset.value!) }
  let removeHistory = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    let url = event.currentTarget.dataset.value!
    if (inlineUrl?.url === url) { setInlineUrl(undefined); setText(query) }
    setIndex(-1); void run('history.remove', { profile: profile!.id, url })
    ref.current?.focus()
  }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
      event.preventDefault()
      let input = event.currentTarget
      let deletion = deleteWordBackward(input.value, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length)
      deleting.current = true
      input.setSelectionRange(deletion.cursor, input.selectionEnd ?? input.value.length)
      document.execCommand('delete')
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') deleting.current = true
    if (event.key === 'ArrowRight' && (inlineUrl || selectedResult) && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.currentTarget.selectionStart === query.length && event.currentTarget.selectionEnd === previewText.length) {
      event.preventDefault(); setQuery(previewText); setText(previewText); setIndex(-1); setInlineUrl(undefined); requestAnimationFrame(() => ref.current?.setSelectionRange(previewText.length, previewText.length)); return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length) setIndex(current => current < 0 ? (event.key === 'ArrowDown' ? 0 : results.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish() }
  }
  return <div className={css.addressEditor}><form ref={form} className={css.prompt} onSubmit={submit}><label htmlFor="prompt">open</label><div className={css.addressInput}><input id="prompt" ref={ref} aria-label="URL or search" aria-autocomplete="both" aria-expanded={!!results.length} aria-controls="address-suggestions" aria-activedescendant={selectedResult ? `address-suggestion-${index}` : undefined} value={previewText} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /></div><span className={message ? css.error : undefined} role="status">{message || (busy ? 'loading…' : inlineUrl ? 'Enter opens · Backspace searches · esc' : 'esc')}</span><CloseButton label="Close URL search" onClick={finish} /><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
    {!!results.length && createPortal(<div ref={suggestionList} id="address-suggestions" role="listbox" aria-label="Address suggestions" className={css.urlHistory}>{results.map((entry, position) => <div key={`${entry.kind}:${entry.value}`} className={css.addressSuggestionRow}><button id={`address-suggestion-${position}`} type="button" role="option" aria-selected={position === index} data-kind={entry.kind} data-value={entry.value} onClick={choose} disabled={busy}><AddressSuggestionIcon kind={entry.kind} /><strong>{entry.title}</strong><span>{entry.detail}</span></button>{entry.kind === 'history' && <button type="button" className={css.addressSuggestionRemove} data-value={entry.value} aria-label={`Remove ${entry.title || entry.value} from history`} title="Remove from history" onClick={removeHistory} disabled={busy}>×</button>}</div>)}</div>, document.body)}
  </div>
}

let AddressSuggestionIcon = ({ kind }: { kind: string }) => <svg className={css.addressSuggestionIcon} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
  {kind === 'bookmark' ? <path d="M4 2.5h8v11l-4-2.7-4 2.7z" /> : kind === 'history' ? <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5V8l2.5 1.5" /></> : <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>}
</svg>

let FindPrompt = () => {
  let { state, run, message, onMessage, dismiss } = useUI()
  let { tab } = selection(state)
  let loading = !!(tab && state.loading[tab.id])
  let [text, setText] = useState('')
  let result = tab ? state.findResults?.[tab.id] : undefined
  let current = result?.text === text ? result : undefined
  let searching = !!current
  let ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  useEffect(() => {
    if (!tab || loading || searching) return
    void run('find', { tab: tab.id, text })
  }, [text, tab?.id, loading, searching, run])
  useEffect(() => () => {
    if (tab) void bridge.command({ method: 'find', args: { tab: tab.id, text: '' } }).catch(() => undefined)
  }, [tab?.id])
  let change = (event: ChangeEvent<HTMLInputElement>) => { onMessage(''); setText(event.target.value) }
  let search = (forward = true) => {
    if (tab && text) void run('find', { tab: tab.id, text, next: current !== undefined, forward })
    ref.current?.focus()
  }
  let next = () => search(), previous = () => search(false)
  let submit = (event: FormEvent) => { event.preventDefault(); search() }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); search(false) }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss() }
  }
  let summary = !text ? 'Enter next · Shift+Enter previous · Esc close' : current?.matches ? `${current.activeMatchOrdinal || 1} / ${current.matches}${current.finalUpdate ? '' : '…'}` : current?.finalUpdate ? 'No matches' : 'Searching…'
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="find">/</label><input id="find" ref={ref} aria-label="Find in page" value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} /><span className={message ? css.error : undefined} role="status" aria-label="Find results">{message || summary}</span><button type="button" onClick={previous} disabled={!text} aria-label="Previous match">Previous</button><button type="button" onClick={next} disabled={!text} aria-label="Next match">Next</button></form>
}

let ManagementPrompt = ({ mode, message }: { mode: ManagementControl; message: string }) => {
  let { state, run, dismiss } = useUI()
  let { client, session, window, pane } = selection(state)
  let closingPane = mode === 'close-pane', closingWindow = mode === 'close-window', closing = closingPane || closingWindow
  let [text, setText] = useState(closing ? '' : mode === 'rename-session' ? session!.name : mode === 'move-window' ? String(session!.windows.indexOf(window!) + 1) : window!.name)
  let [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  let finish = () => { dismiss(); void run('focus-page', { client: client!.id }) }
  let apply = async () => {
    if (busy) return
    setBusy(true)
    let result = await run(closingPane ? 'kill-pane' : closingWindow ? 'kill-window' : mode, { client: client!.id, window: window!.id, pane: pane?.id, session: session!.id, ...(closing ? { confirm: true } : mode === 'move-window' ? { position: text.trim() } : { name: text.trim() }) })
    if (!mounted.current) return
    setBusy(false)
    if (result !== undefined) finish()
  }
  let submit = (event: FormEvent) => { event.preventDefault(); if (closing ? text.toLowerCase() === 'y' : text.trim()) void apply() }
  let change = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' || (closing && event.key.toLowerCase() === 'n')) { event.preventDefault(); finish(); return }
    if (closing && event.key.toLowerCase() === 'y') { event.preventDefault(); void apply() }
  }
  let label = closingPane ? 'Close pane? (y/n)' : closingWindow ? `Close window "${window!.name}"? (y/n)` : mode === 'rename-session' ? 'Rename session' : mode === 'move-window' ? 'Move window to index' : 'Rename window'
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="manage">{label}</label><input id="manage" ref={ref} aria-label={closingPane ? 'Close pane confirmation' : closingWindow ? 'Close window confirmation' : label} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || 'esc'}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
}

let EmptyPane = ({ paneId }: { paneId?: string }) => {
  let { show } = useUI()
  let open = () => show('address', paneId)
  return <div className={css.empty}><button onClick={open}>Cmd+L to open a URL</button></div>
}
let NavigationButton = ({ direction, tabId, enabled, hasHistory, open }: { direction: 'back' | 'forward'; tabId: string; enabled: boolean; hasHistory: boolean; open: () => void }) => {
  let { run } = useUI()
  let timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  let held = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  let cancelHold = () => { clearTimeout(timer.current); timer.current = undefined }
  let press = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !hasHistory) return
    held.current = false
    timer.current = setTimeout(() => { held.current = true; open() }, 450)
  }
  let click = () => { if (held.current) { held.current = false; return }; void run(direction, { tab: tabId }) }
  let contextMenu = (event: MouseEvent<HTMLButtonElement>) => { if (!hasHistory) return; event.preventDefault(); cancelHold(); held.current = true; open() }
  return <button type="button" className={css.navigationButton} aria-label={direction === 'back' ? 'Back' : 'Forward'} title={direction === 'back' ? 'Back (hold for history)' : 'Forward (hold for history)'} disabled={!enabled} onPointerDown={press} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onClick={click} onContextMenu={contextMenu}><svg viewBox="0 0 16 16" aria-hidden="true"><path d={direction === 'back' ? 'M10.5 3.5 6 8l4.5 4.5' : 'M5.5 3.5 10 8l-4.5 4.5'} /></svg></button>
}
let NavigationMenuItem = ({ entry, select }: { entry: { index: number; title: string; url: string }; select: (index: number) => void }) => {
  let click = () => select(entry.index)
  return <button type="button" role="menuitem" onClick={click} title={entry.url}><strong>{entry.title || entry.url}</strong><span>{entry.url}</span></button>
}
let ClickModeActionIcon = ({ action }: { action: ClickAction }) => <svg viewBox="0 0 24 24" aria-hidden="true">
  {action === 'normal' && <path d="M4 3v16l4.2-4.1 3 6.6 3-1.4-3-6.5H17z" />}
  {action === 'right' && <><rect x="5" y="2" width="14" height="20" rx="7" /><path d="M12 2v8h7" /><path className={css.clickModeFill} d="M13 3h1a4 4 0 0 1 4 4v2h-5z" /></>}
  {action === 'command' && <text x="12" y="17" textAnchor="middle">⌘</text>}
  {action === 'double' && <text x="12" y="16" textAnchor="middle">2×</text>}
  {action === 'float' && <><rect x="3" y="6" width="13" height="12" rx="1" /><rect className={css.clickModeFill} x="8" y="3" width="13" height="12" rx="1" /></>}
  {action === 'split-left' && <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M12 4v16" /><path className={css.clickModeFill} d="M4 5h7v14H4z" /></>}
  {action === 'split-right' && <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M12 4v16" /><path className={css.clickModeFill} d="M13 5h7v14h-7z" /></>}
</svg>
let ClickModeActions = ({ action, input, backgroundColor, textColor }: { action: ClickAction; input: string; backgroundColor: string; textColor: string }) => {
  let definitions: { action: ClickAction; key: string; label: string }[] = [
    { action: 'normal', key: 'n', label: 'click' }, { action: 'right', key: 'r', label: 'right' }, { action: 'command', key: 'c', label: 'cmd' }, { action: 'double', key: 'd', label: 'double' },
    { action: 'float', key: 'f', label: 'float' }, { action: 'split-left', key: 'h', label: 'left' }, { action: 'split-right', key: 'l', label: 'right' },
  ]
  return <div className={css.clickModeActions} role="group" aria-label="Click mode actions">
    {input && <strong className={css.clickModeInput} style={{ color: backgroundColor }}>{input}</strong>}
    {definitions.map((definition, index) => {
      let selected = action === definition.action
      return <span key={definition.action} className={css.clickModeActionGroup}>
        {index === 4 && <span className={css.clickModeDivider} />}
        <span className={css.clickModeAction} data-click-action={definition.action} data-selected={selected} aria-label={`${definition.label} (${definition.key})`} style={selected ? { color: textColor, backgroundColor, borderColor: backgroundColor } : undefined}>
          <strong style={{ color: selected ? textColor : backgroundColor }}>{definition.key}</strong><ClickModeActionIcon action={definition.action} /><span className={css.clickModeLabel}>{definition.label}</span>
        </span>
      </span>
    })}
  </div>
}
let PaneAddress = ({ paneId }: { paneId?: string }) => {
  let { state, control, show, run, historyPopup, setHistoryPopup } = useUI()
  let { client, session, window } = selection(state)
  let pane = window?.panes.find(pane => pane.id === paneId)
  let tab = pane
  let profile = state.model.profiles.find(profile => profile.id === pane?.profileId)
  let security = tab ? state.security?.[tab.id] : undefined
  let url = tab ? state.pendingUrls[tab.id] ?? (security?.status === 'certificate-error' ? security.url : tab.url) : undefined
  let editing = control === 'address' && (client?.paneId === paneId || !paneId)
  let addressSelection = useRef<AddressSelection | undefined>(undefined)
  let takeAddressSelection = useCallback(() => {
    let selection = addressSelection.current
    addressSelection.current = undefined
    return selection
  }, [])
  let open = () => show('address', paneId)
  let rememberSelection = (event: PointerEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>) => {
    let input = event.currentTarget, bounds = input.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return
    let start = input.selectionStart ?? 0, end = input.selectionEnd ?? 0
    if (start !== end) addressSelection.current = { start, end, direction: input.selectionDirection ?? 'none' }
  }
  let beginSelection = (event: PointerEvent<HTMLInputElement>) => {
    if (event.button === 0) { addressSelection.current = undefined; event.currentTarget.setPointerCapture(event.pointerId) }
  }
  let editSelection = (event: PointerEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>) => {
    rememberSelection(event)
    void open()
  }
  let editFromKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault(); void open()
  }
  let navigation = tab ? state.navigation[tab.id] : undefined
  let activeIndex = navigation?.activeIndex ?? 0
  let entries = navigation?.entries ?? []
  let back = entries.map((entry, index) => ({ ...entry, index })).filter(entry => entry.index < activeIndex).reverse()
  let forward = entries.map((entry, index) => ({ ...entry, index })).filter(entry => entry.index > activeIndex)
  let backHasPage = back.length > 0 && back[0].url !== 'about:blank'
  let backEnabled = back.length > 0 ? backHasPage : !!tab?.openerPaneId && !!window?.panes.some(candidate => candidate.id === tab.openerPaneId)
  let popup = historyPopup?.tabId === tab?.id ? historyPopup : null
  let menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popup) return
    let outside = (event: globalThis.PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setHistoryPopup(null) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [popup, setHistoryPopup])
  let selectHistory = (index: number) => { if (!tab) return; setHistoryPopup(null); void run('history.go-to', { tab: tab.id, index }) }
  let refresh = () => { if (tab) void run('reload', { tab: tab.id }) }
  let openSiteInfo = () => show('site-info', paneId)
  let openProfile = () => show('profiles', paneId)
  let openProxy = () => show('proxy', paneId)
  let customProfile = profile && session && profile.id !== session.defaultProfileId ? profile : undefined
  let proxyTest = customProfile ? state.profileProxyTests[customProfile.id] : undefined
  let profileRouteLabel = customProfile ? `Profile ${customProfile.name}, ${profileDeviceLabel(customProfile)}` : ''
  let proxyRouteLabel = customProfile?.proxy ? `Proxy for ${customProfile.name}${proxyTest ? ', verified' : ''}` : ''
  let proxyRouteTitle = customProfile?.proxy ? `${customProfile.proxy.protocol}://${customProfile.proxy.host}:${customProfile.proxy.port}${proxyTest ? ` · Exit IP: ${proxyTest.ip}` : ''}` : ''
  let clickState = state.clickMode?.showInput && state.clickModeState?.paneId === tab?.id ? state.clickModeState : undefined
  if (clickState && !editing) return <div className={css.addressBar} role="group" aria-label="Pane address"><ClickModeActions action={clickState.action} input={clickState.input} backgroundColor={state.clickMode!.backgroundColor} textColor={state.clickMode!.textColor} /></div>
  return <div className={css.addressBar} role="group" aria-label="Pane address">
    {tab && <div className={css.navigationControls}>
      <NavigationButton direction="back" tabId={tab.id} enabled={backEnabled} hasHistory={backHasPage} open={() => setHistoryPopup({ tabId: tab.id, direction: 'back' })} />
      <NavigationButton direction="forward" tabId={tab.id} enabled={forward.length > 0} hasHistory={forward.length > 0} open={() => setHistoryPopup({ tabId: tab.id, direction: 'forward' })} />
      <button type="button" className={css.navigationButton} aria-label="Refresh" title="Refresh" onClick={refresh}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 7.5a5 5 0 1 0-.9 3.3M13 3.5v4h-4" /></svg></button>
      {popup && <div ref={menu} className={css.navigationMenu} role="menu" aria-label={`${popup.direction === 'back' ? 'Back' : 'Forward'} history`}>
        {(popup.direction === 'back' ? back : forward).map(entry => <NavigationMenuItem key={entry.index} entry={entry} select={selectHistory} />)}
      </div>}
    </div>}
    {tab && <ConnectionIndicator security={security} url={url ?? tab.url} open={openSiteInfo} />}
    {editing ? <AddressPrompt key={tab?.id ?? 'empty'} takeSelection={takeAddressSelection} /> : <input onClick={editSelection} onPointerDown={beginSelection} onPointerMove={rememberSelection} onPointerUp={editSelection} onKeyDown={editFromKeyboard} aria-label="Address" className={css.location} title={url} value={url && url !== 'about:blank' ? url : 'Cmd+L to open a URL'} role="button" readOnly />}
    {!editing && !clickState && tab && state.loading[tab.id] && <span className={css.loading}>loading…</span>}
    {customProfile && <div className={css.profileRouteControls}><button type="button" className={css.profileRoute} onClick={openProfile} aria-label={profileRouteLabel} title={profileRouteLabel}><ProfileAvatar id={customProfile.id} name={customProfile.name} /><ProfileDeviceIcon mobile={!!customProfile.device} /></button>{customProfile.proxy && <button type="button" className={css.profileRoute} onClick={openProxy} aria-label={proxyRouteLabel} title={proxyRouteTitle}><ProfileConnectionIcon proxy verified={!!proxyTest} /></button>}</div>}
  </div>
}
let Branch = ({ node }: { node: Layout }) => {
  let { state, run } = useUI()
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (node.kind === 'split') ref.current?.style.setProperty('--ratio', String(node.ratio)) }, [node])
  let startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (node.kind !== 'split' || !ref.current) return
    event.preventDefault()
    let { client } = selection(state)
    let bounds = ref.current.getBoundingClientRect(), ratio = node.ratio, gutter = event.currentTarget
    gutter.setPointerCapture(event.pointerId)
    void run('client.overlay', { client: client!.id, visible: true })
    let move = (event: globalThis.PointerEvent) => { ratio = Math.max(.1, Math.min(.9, node.axis === 'horizontal' ? (event.clientX - bounds.x) / bounds.width : (event.clientY - bounds.y) / bounds.height)); ref.current?.style.setProperty('--ratio', String(ratio)) }
    let end = () => {
      gutter.removeEventListener('pointermove', move); gutter.removeEventListener('pointerup', end); gutter.removeEventListener('pointercancel', end)
      void run('resize-pane', { window: client!.windowId, split: node.id, ratio }).then(() => run('client.overlay', { client: client!.id, visible: false }))
    }
    gutter.addEventListener('pointermove', move); gutter.addEventListener('pointerup', end); gutter.addEventListener('pointercancel', end)
  }
  if (node.kind === 'pane') return <BrowserPane paneId={node.paneId} />
  return <div ref={ref} className={css.branch} data-axis={node.axis}><div className={css.first}><Branch node={node.first} /></div><div className={css.gutter} role="separator" aria-label="Resize split" onPointerDown={startDrag} /><div className={css.second}><Branch node={node.second} /></div></div>
}
let FloatingPreview = ({ paneId }: { paneId: string }) => {
  let { state } = useUI()
  let { window, client } = selection(state)
  let placement = window?.floating?.find(item => item.paneId === paneId)
  let pane = window?.panes.find(pane => pane.id === paneId)
  let tab = pane
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!placement || !client || !ref.current) return
    let rect = clampFloat(placement, client.width, client.height - 28)
    for (let key of ['x', 'y', 'width', 'height'] as const) ref.current.style.setProperty(`--float-${key}`, `${rect[key]}px`)
  }, [placement, client?.width, client?.height])
  return <div ref={ref} className={css.floatingPreview} aria-hidden="true"><div>{tab?.url}</div>{tab && state.snapshots[tab.id] && <img src={state.snapshots[tab.id].image} alt="" />}</div>
}
let BrowserPane = ({ paneId }: { paneId: string }) => {
  let { state, run } = useUI()
  let { client } = selection(state)
  let pane = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === paneId)!
  let tab = pane
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    let publish = () => bridge.bounds([...document.querySelectorAll<HTMLElement>('[data-browser-content]')].map(element => { let rect = element.getBoundingClientRect(); return { paneId: element.dataset.contentPaneId!, x: rect.x, y: rect.y, width: rect.width, height: rect.height } }))
    let observer = new ResizeObserver(publish)
    if (ref.current) observer.observe(ref.current)
    publish()
    return () => observer.disconnect()
  }, [tab.id, client!.windowId, state.statusBar])
  let focus = () => { if (client!.paneId !== pane.id) void run('select-pane', { client: client!.id, pane: pane.id }) }
  let menu = (event: MouseEvent<HTMLElement>) => { event.preventDefault(); void run('pane.menu', { pane: pane.id }) }
  let reload = () => { void run('reload', { tab: tab.id }) }
  let snapshot = state.snapshots[tab.id]
  return <section className={css.pane} data-pane-id={pane.id} data-focused-pane={client!.paneId === pane.id} onContextMenu={menu}><PaneAddress paneId={pane.id} /><div className={css.content} ref={ref} data-browser-content data-content-pane-id={pane.id} onMouseDown={focus}>
    {state.crashes[tab.id] ? <div className={css.empty}><span>{state.crashes[tab.id]}</span><button onClick={reload}>Reload</button></div> : tab.url === 'about:blank' ? <EmptyPane paneId={pane.id} /> : snapshot ? <img className={css.preview} src={snapshot.image} alt="Page preview" /> : <div className={css.empty}>{state.loading[tab.id] ? 'Loading…' : ''}</div>}
  </div></section>
}

let Panel = ({ type }: { type: Control }) => {
  let { state, dismiss } = useUI()
  let ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!['help', 'sessions', 'bookmark', 'bookmarks', 'history', 'plugin-dialog', 'plugins'].includes(type)) ref.current?.focus() }, [type])
  let title = type === 'site-info' ? 'Site information' : type === 'plugin-dialog' ? 'Plugin' : type === 'browser-tools' ? 'Browser tools' : type === 'profiles' ? 'Profile' : type === 'proxy' ? 'Proxy' : type.charAt(0).toUpperCase() + type.slice(1)
  let dismissBackground = (event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) dismiss() }
  return <div className={css.overlay} onClick={dismissBackground}><div className={`${css.panel} ${type === 'settings' ? css.settingsPanel : ''}`} role="dialog" aria-label={title} aria-modal="true" tabIndex={-1} ref={ref}>
    <header><strong>{title}</strong><CloseButton label="Close" onClick={dismiss} /></header>
    <div className={css.panelBody}>
      {type === 'help' && <HelpContent />}
      {type === 'plugins' && <PluginList />}
      {type === 'plugin-dialog' && state.pluginPrompt && <PluginDialog key={state.pluginPrompt.id} />}
      {type === 'browser-tools' && <BrowserTools />}
      {type === 'site-info' && <SiteInformation />}
      {type === 'settings' && <SettingsContent />}
      {type === 'sessions' && <SessionPicker />}
      {type === 'profiles' && <ProfileInfo />}
      {type === 'proxy' && <ProxyInfo />}
      {type === 'bookmark' && <BookmarkEditor />}
      {type === 'bookmarks' && <BookmarkPicker />}
      {type === 'history' && <HistoryPicker />}
      {type === 'downloads' && <DownloadManager />}
      {type === 'extensions' && <ExtensionManager />}
      {type === 'activity' && <><PluginActivity /><p>Permissions</p>{state.permissions.length ? state.permissions.map(permission => <PermissionRow key={permission.id} permission={permission} />) : <p>No pending requests.</p>}<DownloadManager /></>}
    </div>
  </div></div>
}
let SiteInformation = () => {
  let { state } = useUI()
  let { tab, profile } = selection(state)
  if (!tab) return <p>Open a page to see its connection.</p>
  let security = state.security?.[tab.id] ?? initialSecurity(tab.url)
  let origin = (() => { try { let parsed = new URL(security.url); return parsed.origin === 'null' ? parsed.protocol : parsed.origin } catch { return security.url } })()
  let certificate = security.certificate
  let date = (seconds: number) => Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : 'Unavailable'
  return <section aria-label="Connection details">
    <p><strong>{origin}</strong><br />{profile?.name}</p>
    <p role="status">{connectionLabels[security.status]}</p>
    {security.error && <p>{security.error}</p>}
    {security.status === 'certificate-error' && <p>This connection was blocked because its certificate could not be verified.</p>}
    {security.status === 'mixed' && <p>This page includes or requests content over an unencrypted connection.</p>}
    <p>Encryption protects the connection. It does not establish that a website is trustworthy.</p>
    {certificate && <dl><dt>Subject</dt><dd>{certificate.subject || 'Unavailable'}</dd><dt>Issuer</dt><dd>{certificate.issuer || 'Unavailable'}</dd><dt>Valid from</dt><dd>{date(certificate.validFrom)}</dd><dt>Valid until</dt><dd>{date(certificate.validTo)}</dd>{certificate.protocol && <><dt>Protocol</dt><dd>{certificate.protocol}</dd></>}</dl>}
  </section>
}
let ExtensionManager = () => {
  let { state, run, dismiss } = useUI()
  let { profile } = selection(state)
  let [listing, setListing] = useState<ExtensionList | null>(null)
  let [enabling, setEnabling] = useState('')
  useEffect(() => {
    setListing(null)
    if (!profile) return
    let cancelled = false
    void run('extension.list', { profile: profile.id }).then(result => {
      if (!cancelled && result) setListing(result as ExtensionList)
    })
    return () => { cancelled = true }
  }, [profile?.id, run])
  let open = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!profile) return
    let opened = await run('extension.open', { profile: profile.id, id: event.currentTarget.dataset.id })
    if (opened) dismiss()
  }
  let enable = async (extension: ExtensionList['available'][number]) => {
    if (!profile || enabling) return
    setEnabling(extension.path)
    let loaded = await run('extension.load', { profile: profile.id, path: extension.path })
    if (loaded) {
      let updated = await run('extension.list', { profile: profile.id })
      if (updated) setListing(updated as ExtensionList)
    }
    setEnabling('')
  }
  return <section aria-label="Profile extensions"><p>Profile: {profile?.name ?? 'No selected pane'}</p>
    {!listing && <p>Loading extensions…</p>}
    {listing && !listing.extensions.length && <p>No extensions in this profile.</p>}
    {listing?.extensions.map(extension => <button key={extension.id} className={css.listRow} data-id={extension.id} onClick={open}><strong>{extension.name}</strong><span className={css.pluginDescription}>Version {extension.version}</span></button>)}
    {!!listing?.available.length && <p>Available from other profiles</p>}
    {listing?.available.map(extension => <button key={extension.path} className={css.listRow} disabled={!!enabling} onClick={() => void enable(extension)}><strong>Enable {extension.name}</strong><span className={css.pluginDescription}>Version {extension.version}</span></button>)}
    {listing?.errors.map(error => <p key={`${error.path}:${error.error}`} className={css.error}>{error.error}</p>)}
  </section>
}
let PluginList = ({ compact = false }: { compact?: boolean }) => {
  let { state, run, dismiss } = useUI()
  let [query, setQuery] = useState('')
  let choose = (event: MouseEvent<HTMLButtonElement>) => { dismiss(); void run('plugin.run', { action: event.currentTarget.dataset.action }) }
  let toggle = (event: ChangeEvent<HTMLInputElement>) => { void run('plugin.enable', { id: event.target.dataset.id, enabled: event.target.checked }) }
  let reload = () => { void run('plugin.reload') }
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  return <>{!compact && <ToolStatus />}{!compact && <h2>Installed plugins</h2>}<SearchInput aria-label="Find plugin action" value={query} onChange={change} autoFocus={!compact} />
    {!state.plugins?.length && <p>{compact ? 'No plugins installed.' : 'No plugins found. Add folders containing plugin.yaml beside your config, in plugins/.'}</p>}
    {state.plugins?.map(plugin => <div key={plugin.id}><label><input type="checkbox" data-id={plugin.id} checked={plugin.enabled} onChange={toggle} />{plugin.name} · {plugin.enabled ? 'enabled' : 'disabled'}{plugin.error ? ` · ${plugin.error}` : ''}</label>
      {plugin.actions.filter(action => `${plugin.name} ${action.title}`.toLowerCase().includes(query.toLowerCase())).map(action => <button key={action.id} className={css.listRow} disabled={!plugin.enabled} data-action={`${plugin.id}/${action.id}`} onClick={choose}>{action.title}{action.description && <span className={css.pluginDescription}>{action.description}</span>}</button>)}</div>)}
    {!compact && <p>Enable plugins in config.yaml. Scripts run with your OS user privileges.</p>}<button onClick={reload}>Reload plugins</button></>
}
let PluginActivity = () => {
  let { state, run } = useUI()
  let cancel = (event: MouseEvent<HTMLButtonElement>) => { void run('plugin.cancel', { id: event.currentTarget.dataset.id }) }
  return <><p>Plugin runs</p>{state.pluginRuns?.length ? state.pluginRuns.map(item => <div key={item.id} className={css.row}>{item.title} · {item.status}
    {item.progress && <span className={css.pluginDescription}>{item.progress.percent}% · {item.progress.message}</span>}{item.error && <span className={css.pluginDescription}>{item.error}</span>}
    {['running', 'queued'].includes(item.status) && <button data-id={item.id} onClick={cancel}>Cancel</button>}</div>) : <p>No plugin runs.</p>}</>
}
let PluginDialog = () => {
  let { state, run } = useUI()
  let request = state.pluginPrompt!
  let [value, setValue] = useState(''), [index, setIndex] = useState(0), [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  let items = request.items?.filter(item => `${item.label} ${item.description ?? ''}`.toLowerCase().includes(value.toLowerCase())) ?? []
  let respond = async (value: string | boolean) => {
    if (busy) return
    setBusy(true); await run('plugin.respond', { id: request.id, value }); setValue(''); setBusy(false)
  }
  let change = (event: ChangeEvent<HTMLInputElement>) => { setValue(event.target.value); setIndex(0) }
  let yes = () => { void respond(true) }
  let no = () => { void respond(false) }
  let pick = (event: MouseEvent<HTMLButtonElement>) => { void respond(event.currentTarget.dataset.id!) }
  let submit = (event: FormEvent) => { event.preventDefault(); if (request.kind === 'pick') { if (items[index]) void respond(items[index].id) } else void respond(value) }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (request.kind !== 'pick' || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    if (items.length) setIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
  }
  return <><p>{request.pluginName}</p>{request.kind === 'confirm' ? <><p>{request.title}</p><button autoFocus onClick={yes}>Yes</button><button onClick={no}>No</button></> : <form onSubmit={submit}>
    {request.kind === 'pick' ? <SearchInput ref={ref} aria-label={request.title} value={value} onChange={change} onKeyDown={keys} /> : <label>{request.title}<input ref={ref} className={css.pluginInput} type={request.kind === 'password' ? 'password' : 'text'} value={value} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} required={request.required} /></label>}
    {request.kind === 'pick' ? items.map((item, position) => <button key={item.id} type="button" className={css.listRow} data-id={item.id} data-active={position === index} disabled={busy} onClick={pick}>{item.label}{item.description && <span className={css.pluginDescription}>{item.description}</span>}</button>) : <button type="submit" disabled={busy}>Continue</button>}
    {request.kind === 'pick' && !items.length && <p>No matching items.</p>}
  </form>}</>
}
let usePickerNavigation = (onMetaEnter?: (row: HTMLButtonElement) => void, initialQuery = '', onQueryChange?: (query: string) => void) => {
  let [query, setCurrentQuery] = useState(initialQuery)
  let setQuery = (value: string) => { setCurrentQuery(value); onQueryChange?.(value) }
  let ref = useRef<HTMLDivElement>(null)
  let input = useRef<HTMLInputElement>(null)
  useEffect(() => { (ref.current?.querySelector<HTMLButtonElement>('[data-active="true"]') ?? input.current)?.focus() }, [])
  useEffect(() => {
    let picker = ref.current
    let updateSelection = () => {
      let rows = picker?.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([data-picker-action])')
      rows?.forEach((row, index) => { row.dataset.searchSelected = String(!!query && document.activeElement === input.current && index === 0) })
    }
    picker?.addEventListener('focusin', updateSelection)
    updateSelection()
    return () => picker?.removeEventListener('focusin', updateSelection)
  }, [query])
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.altKey) return
    if (event.target instanceof HTMLElement && event.target !== input.current && event.target.closest('input, [data-picker-action]')) return
    let editing = event.target === input.current
    let rows = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([data-picker-action])')].filter(row => row.getClientRects().length)
    if (event.key === 'Enter' && event.metaKey && onMetaEnter) {
      event.preventDefault()
      let selected = rows.find(row => row === document.activeElement) ?? rows[0]
      if (selected) onMetaEnter(selected)
      return
    }
    if (event.metaKey || event.ctrlKey) return
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); input.current?.focus(); return }
    if (event.key === '/' && !editing) { event.preventDefault(); input.current?.focus(); input.current?.select(); return }
    if (!editing && event.key.length === 1 && event.key !== ' ') { event.preventDefault(); setQuery(query + event.key); input.current?.focus(); return }
    if (editing && event.key === 'Enter') { event.preventDefault(); rows[0]?.click(); return }
    if (editing && ['Home', 'End'].includes(event.key)) return
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    let index = editing && query ? 0 : rows.findIndex(row => row === document.activeElement)
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index < 0 && event.key === 'ArrowUp' ? -1 : index + ({ ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key] ?? 0)
    let arrow = event.key === 'ArrowUp' || event.key === 'ArrowDown'
    let nextIndex = arrow && rows.length ? (next + rows.length) % rows.length : Math.max(0, Math.min(rows.length - 1, next)), row = rows[nextIndex]
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
    let panel = ref.current?.closest<HTMLElement>('[role="dialog"]')
    if (panel && nextIndex === 0) panel.scrollTop = 0
    else if (panel && nextIndex === rows.length - 1) panel.scrollTop = panel.scrollHeight
  }
  return { ref, keys, input, query, setQuery, change }
}
let PrivateIcon = () => <svg className={css.privateIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Private session" role="img"><path d="M4 8.5h12M7 8.5l1-5h4l1 5M3 12h3m8 0h3M6 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Zm5 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Z" /></svg>
let SessionPicker = () => {
  let { state, run } = useUI()
  let [busy, setBusy] = useState(false)
  let { ref, keys, input, query, change } = usePickerNavigation()
  let client = selection(state).client
  let previousSession = state.model.sessions.find(session => session.id === client?.sessionHistory?.find(id => id !== client.sessionId))
  let backSession = previousSession && fuzzyMatch(query, `go back ${previousSession.name}`) ? previousSession : undefined
  let sessions = state.model.sessions.filter(session => fuzzyMatch(query, session.name))
  let goBack = () => { if (client && previousSession) void run('switch-client', { client: client.id, session: previousSession.id }) }
  let create = async (privateSession = false) => {
    if (busy) return
    setBusy(true)
    if (await run('new-session', { client: state.clientId, private: privateSession }) === undefined) setBusy(false)
  }
  let createRegular = () => { void create() }
  let createPrivate = () => { void create(true) }
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose session"><SearchInput ref={input} aria-label="Search sessions" value={query} onChange={change} />{backSession && <button className={`${css.listRow} ${css.sessionBack}`} data-session-back onClick={goBack}>go back: {backSession.name}{backSession.private && <PrivateIcon />}</button>}{sessions.map(session => <SessionRow key={session.id} id={session.id} name={session.name} privateSession={session.private === true} />)}{!backSession && !sessions.length && <p role="status">No matching sessions.</p>}<button className={`${css.listRow} ${css.newSession}`} onClick={createRegular} disabled={busy}>new session</button><button className={`${css.listRow} ${css.newSession}`} onClick={createPrivate} disabled={busy}>new private session</button></div>
}
let SessionRow = ({ id, name, privateSession }: { id: string; name: string; privateSession: boolean }) => {
  let { state, run, dismiss } = useUI()
  let [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  let active = selection(state).client?.sessionId === id
  let select = async () => { if (await run('switch-client', { client: state.clientId, session: id }) && active) dismiss() }
  let ask = () => setConfirming(true)
  let cancel = () => setConfirming(false)
  let close = async () => {
    if (busy) return
    setBusy(true)
    if (await run('kill-session', { session: id, confirm: true }) === undefined) setBusy(false)
  }
  if (confirming) return <div className={css.sessionConfirm} role="alertdialog" aria-label={`Close session ${name}?`}><span>Close session "{name}"?</span><button data-picker-action onClick={close} disabled={busy}>yes</button><button data-picker-action onClick={cancel} disabled={busy}>no</button></div>
  return <div className={css.sessionRow}><button className={css.listRow} data-session-row onClick={select} data-active={active} aria-current={active ? 'true' : undefined}>{name}{privateSession && <PrivateIcon />}</button><button className={css.sessionClose} data-picker-action onClick={ask} aria-label={`Close session ${name}`}>x</button></div>
}
type DeviceSettingsProps = { profile: Profile; paneCount: number }
let ProfileDeviceSettings = ({ profile, paneCount }: DeviceSettingsProps) => {
  let { run } = useUI()
  let current = profile.device
  let [preset, setPreset] = useState<DevicePreset>(current?.preset ?? 'pixel-8')
  let [platform, setPlatform] = useState<DevicePlatform>(current?.platform ?? 'android')
  let [width, setWidth] = useState(String(current?.width ?? 412)), [height, setHeight] = useState(String(current?.height ?? 915)), [dpr, setDpr] = useState(String(current?.deviceScaleFactor ?? 2.625))
  let [orientation, setOrientation] = useState(current?.orientation ?? 'portrait')
  let [locale, setLocale] = useState(current?.locale ?? navigator.language ?? 'en-US')
  let [timezone, setTimezone] = useState(current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
  let [locationEnabled, setLocationEnabled] = useState(!!current?.geolocation)
  let [latitude, setLatitude] = useState(String(current?.geolocation?.latitude ?? '')), [longitude, setLongitude] = useState(String(current?.geolocation?.longitude ?? '')), [accuracy, setAccuracy] = useState(String(current?.geolocation?.accuracy ?? 100))
  let [busy, setBusy] = useState(false)
  let changePreset = (event: ChangeEvent<HTMLSelectElement>) => setPreset(event.target.value as DevicePreset)
  let changePlatform = (event: ChangeEvent<HTMLSelectElement>) => setPlatform(event.target.value as DevicePlatform)
  let changeOrientation = (event: ChangeEvent<HTMLSelectElement>) => setOrientation(event.target.value as 'portrait' | 'landscape')
  let changeLocale = (event: ChangeEvent<HTMLInputElement>) => setLocale(event.target.value)
  let changeTimezone = (event: ChangeEvent<HTMLInputElement>) => setTimezone(event.target.value)
  let changeWidth = (event: ChangeEvent<HTMLInputElement>) => setWidth(event.target.value)
  let changeHeight = (event: ChangeEvent<HTMLInputElement>) => setHeight(event.target.value)
  let changeDpr = (event: ChangeEvent<HTMLInputElement>) => setDpr(event.target.value)
  let changeLocationEnabled = (event: ChangeEvent<HTMLInputElement>) => setLocationEnabled(event.target.checked)
  let changeLatitude = (event: ChangeEvent<HTMLInputElement>) => setLatitude(event.target.value)
  let changeLongitude = (event: ChangeEvent<HTMLInputElement>) => setLongitude(event.target.value)
  let changeAccuracy = (event: ChangeEvent<HTMLInputElement>) => setAccuracy(event.target.value)
  let saveDevice = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return
    setBusy(true)
    await run('profile.device.set', { profile: profile.id, device: { preset, platform, width: Number(width), height: Number(height), deviceScaleFactor: Number(dpr), orientation, locale, timezone, ...(locationEnabled ? { geolocation: { latitude: Number(latitude), longitude: Number(longitude), accuracy: Number(accuracy) } } : {}) } })
    setBusy(false)
  }
  let clearDevice = async () => { if (busy) return; setBusy(true); await run('profile.device.clear', { profile: profile.id }); setBusy(false) }
  return <form className={css.profileProxy} onSubmit={saveDevice}>
    <h2>Device</h2>
    <p>{current ? 'Mobile identity active' : 'Desktop identity'}. Changes reload {paneCount} open pane{paneCount === 1 ? '' : 's'} using this profile.</p>
    <div className={css.profileDeviceGrid}>
      <label>Device<select aria-label="Device" value={preset} onChange={changePreset}><option value="pixel-8">Pixel 8</option><option value="galaxy-s24">Galaxy S24</option><option value="iphone-15-pro">iPhone 15 Pro</option><option value="iphone-15-pro-max">iPhone 15 Pro Max</option><option value="custom">Custom</option></select></label>
      <label>Orientation<select aria-label="Orientation" value={orientation} onChange={changeOrientation}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      <label>Locale<input className={css.pluginInput} value={locale} onChange={changeLocale} required spellCheck={false} /></label>
      <label>Timezone<input className={css.pluginInput} value={timezone} onChange={changeTimezone} required spellCheck={false} /></label>
    </div>
    {preset === 'custom' && <div className={css.profileDeviceGrid}>
      <label>Platform<select aria-label="Platform" value={platform} onChange={changePlatform}><option value="android">Android</option><option value="ios">iOS</option></select></label>
      <label>Width<input className={css.pluginInput} type="number" min="240" max="1440" value={width} onChange={changeWidth} required /></label>
      <label>Height<input className={css.pluginInput} type="number" min="320" max="2560" value={height} onChange={changeHeight} required /></label>
      <label>DPR<input className={css.pluginInput} type="number" min="1" max="4" step="0.125" value={dpr} onChange={changeDpr} required /></label>
    </div>}
    <label className={css.profileProxyAuthentication}><input type="checkbox" checked={locationEnabled} onChange={changeLocationEnabled} />Set geolocation</label>
    {locationEnabled && <div className={css.profileDeviceLocation}><label>Latitude<input className={css.pluginInput} type="number" min="-90" max="90" step="any" value={latitude} onChange={changeLatitude} required /></label><label>Longitude<input className={css.pluginInput} type="number" min="-180" max="180" step="any" value={longitude} onChange={changeLongitude} required /></label><label>Accuracy<input className={css.pluginInput} type="number" min="0" max="100000" step="any" value={accuracy} onChange={changeAccuracy} required /></label></div>}
    <div className={css.profileProxyActions}><button type="submit" disabled={busy}>Apply device</button>{current && <button type="button" onClick={clearDevice} disabled={busy}>Use desktop</button>}</div>
  </form>
}

let ProxyProtocolSelect = ({ value, onChange }: { value: 'http' | 'https' | 'socks5'; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) => <select aria-label="Protocol" value={value} onChange={onChange}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select>
let ProxyRegionSelect = ({ regions, value, onChange }: { regions: PluginProxyRegion[]; value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) => {
  let groups = [...new Set(regions.map(region => region.group))]
  return <select aria-label="Region" value={value} onChange={onChange} required><option value="" disabled>Choose region</option>{groups.map(group => <optgroup key={group} label={group}>{regions.filter(region => region.group === group).map(region => <option key={`${region.protocol}:${region.host}:${region.port}`} value={region.host}>{region.label}</option>)}</optgroup>)}</select>
}
type ProxyProviderEntry = { key: string; provider: PluginProxyProvider }
let proxyProviderEntries = (state: PublicState): ProxyProviderEntry[] => (state.plugins ?? []).filter(plugin => plugin.enabled).flatMap(plugin => plugin.proxyProviders.map(provider => ({ key: `${plugin.id}/${provider.id}`, provider })))
let matchesProxyRegion = (region: PluginProxyRegion, profile: Profile) => region.protocol === profile.proxy?.protocol && region.host === profile.proxy.host && region.port === profile.proxy.port

let ProxySettings = ({ profile, paneCount, showRegion = false }: { profile: Profile; paneCount: number; showRegion?: boolean }) => {
  let { state, run } = useUI()
  let providers = proxyProviderEntries(state)
  let configuredProvider = providers.find(entry => entry.provider.regions.some(region => matchesProxyRegion(region, profile)))
  let configuredRegion = configuredProvider?.provider.regions.find(region => matchesProxyRegion(region, profile))?.host ?? ''
  let [providerKey, setProviderKey] = useState(configuredProvider?.key ?? 'custom')
  let [providerRegion, setProviderRegion] = useState(configuredRegion)
  let [protocol, setProtocol] = useState(profile?.proxy?.protocol ?? 'https')
  let [host, setHost] = useState(profile?.proxy?.host ?? '')
  let [port, setPort] = useState(String(profile?.proxy?.port ?? 443))
  let [authenticated, setAuthenticated] = useState(profile?.proxy?.authenticated ?? true)
  let [username, setUsername] = useState(''), [password, setPassword] = useState('')
  let [busy, setBusy] = useState(false)
  let proxyTest = state.profileProxyTests[profile.id]
  let providerEntry = providers.find(entry => entry.key === providerKey)
  let provider = providerEntry?.provider
  let changeProvider = (event: ChangeEvent<HTMLSelectElement>) => {
    let value = event.target.value
    setProviderKey(value)
    if (value === 'custom') return
    let selectedProvider = providers.find(entry => entry.key === value)?.provider
    let region = selectedProvider?.regions.find(item => item.host === providerRegion)
    setAuthenticated(selectedProvider?.authenticated ?? false)
    if (region) setHost(region.host)
    else { setProviderRegion(''); setHost('') }
    if (region) { setProtocol(region.protocol); setPort(String(region.port)) }
  }
  let changeProviderRegion = (event: ChangeEvent<HTMLSelectElement>) => {
    let region = provider?.regions.find(item => item.host === event.target.value)
    if (!region) return
    setProviderRegion(region.host); setHost(region.host); setProtocol(region.protocol); setPort(String(region.port))
  }
  let changeProtocol = (event: ChangeEvent<HTMLSelectElement>) => { let value = event.target.value as 'http' | 'https' | 'socks5'; setProtocol(value); if (!profile.proxy) setPort(value === 'http' ? '80' : value === 'https' ? '443' : '1080') }
  let changeHost = (event: ChangeEvent<HTMLInputElement>) => setHost(event.target.value)
  let changePort = (event: ChangeEvent<HTMLInputElement>) => setPort(event.target.value)
  let changeAuthenticated = (event: ChangeEvent<HTMLInputElement>) => setAuthenticated(event.target.checked)
  let changeUsername = (event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)
  let changePassword = (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)
  let saveProxy = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return
    setBusy(true)
    let result = await run('profile.proxy.set', { profile: profile.id, protocol, host, port: Number(port), authenticated, username, password })
    if (result) { setUsername(''); setPassword('') }
    setBusy(false)
  }
  let useSystem = async () => { if (busy) return; setBusy(true); await run('profile.proxy.clear', { profile: profile.id }); setBusy(false) }
  let testProxy = async () => {
    if (busy) return
    setBusy(true)
    await run('profile.proxy.test', { profile: profile.id })
    setBusy(false)
  }
  return <form className={css.profileProxy} onSubmit={saveProxy}>
      <h2>Connection</h2>
      <p>{profile.proxy ? `${profile.proxy.protocol}://${profile.proxy.host}:${profile.proxy.port}` : 'Use the system connection'}. Changes reload {paneCount} open pane{paneCount === 1 ? '' : 's'} using this profile.</p>
      <div className={css.profileProxyProvider}><label>Provider<select aria-label="Provider" value={providerEntry ? providerKey : 'custom'} onChange={changeProvider}><option value="custom">Custom</option>{providers.map(entry => <option key={entry.key} value={entry.key}>{entry.provider.title}</option>)}</select></label>{provider && <label>Region<ProxyRegionSelect regions={provider.regions} value={providerRegion} onChange={changeProviderRegion} /></label>}</div>
      {!provider && <div className={css.profileProxyEndpoint}><label>Protocol<ProxyProtocolSelect value={protocol} onChange={changeProtocol} /></label><label>Host<input className={css.pluginInput} value={host} onChange={changeHost} autoComplete="off" spellCheck={false} required /></label><label>Port<input className={css.pluginInput} type="number" min="1" max="65535" value={port} onChange={changePort} required /></label></div>}
      {provider ? <p>Uses {protocol.toUpperCase()} proxy on port {port}. {provider.help}</p> : <label className={css.profileProxyAuthentication}><input type="checkbox" checked={authenticated} onChange={changeAuthenticated} />Proxy requires authentication</label>}
      {authenticated && <div className={css.profileProxyCredentials}><label>Username<input className={css.pluginInput} value={username} onChange={changeUsername} autoComplete="off" spellCheck={false} placeholder={profile.proxy?.authenticated ? 'Leave blank to keep saved credentials' : ''} /></label><label>Password<input className={css.pluginInput} type="password" value={password} onChange={changePassword} autoComplete="new-password" placeholder={profile.proxy?.authenticated ? 'Leave blank to keep saved credentials' : ''} /></label></div>}
      {protocol === 'socks5' && <p>Authenticated SOCKS5 uses a private loopback relay because Chromium does not support SOCKS5 credentials directly.</p>}
      <div className={css.profileProxyActions}><button type="submit" disabled={busy}>Save proxy</button>{profile.proxy && <button type="button" onClick={testProxy} disabled={busy}>Test connection</button>}{profile.proxy && <button type="button" onClick={useSystem} disabled={busy}>Use system connection</button>}</div>
      {proxyTest && <ProxyTestSuccess ip={proxyTest.ip} region={showRegion ? proxyTest.region : undefined} />}
    </form>
}

let ProxyInfo = () => {
  let { state } = useUI()
  let { profile } = selection(state)
  if (!profile) return <p>No profile is selected.</p>
  let paneCount = state.model.sessions.flatMap(item => item.windows.flatMap(item => item.panes)).filter(item => item.profileId === profile.id).length
  return <section className={css.profileInfo} aria-label={`${profile.name} proxy settings`}>
    <div className={css.profileHeading}><ProfileConnectionIcon proxy={!!profile.proxy} verified={!!state.profileProxyTests[profile.id]} /><strong>{profile.name}</strong></div>
    <ProxySettings profile={profile} paneCount={paneCount} showRegion />
  </section>
}

let ProfileInfo = () => {
  let { state, run } = useUI()
  let { session, window, pane, profile } = selection(state)
  useEffect(() => { if (profile) void run('profile.cache.status', { profile: profile.id }) }, [profile?.id, run])
  if (!profile) return <p>No profile is selected.</p>
  let paneCount = state.model.sessions.flatMap(item => item.windows.flatMap(item => item.panes)).filter(item => item.profileId === profile.id).length
  let cache = state.profileCaches[profile.id]
  let clearCache = () => { void run('profile.cache.clear', { profile: profile.id }) }
  return <section className={css.profileInfo} aria-label={`${profile.name} profile details`}>
    <div className={css.profileHeading}><ProfileAvatar id={profile.id} name={profile.name} /><strong>{profile.name}</strong></div>
    <dl>
      <div><dt>Background pages</dt><dd>{profile.background ? 'Keep running' : 'Throttle when inactive'}</dd></div>
      <div><dt>Session</dt><dd>{session?.name}</dd></div>
      <div><dt>Window</dt><dd>{window?.name}</dd></div>
      <div><dt>Pane</dt><dd>{pane?.id}</dd></div>
    </dl>
    <p>Sessions organize windows. Profiles define a browser identity and are inherited when a pane is split. Cookies, storage, history, extensions, and network routing are isolated to this profile.</p>
    <ProfileDeviceSettings profile={profile} paneCount={paneCount} />
    <ProxySettings profile={profile} paneCount={paneCount} />
    <section className={css.profileProxy}>
      <h2>HTTP cache</h2>
      <p>{cache ? `${(cache.bytes / 1024 / 1024).toFixed(1)} MiB of ${(cache.limit / 1024 / 1024).toFixed(0)} MiB` : 'Checking size'}. Cookies and site storage are preserved.</p>
      <div className={css.profileProxyActions}><button type="button" onClick={clearCache}>Clear HTTP cache</button></div>
    </section>
  </section>
}
type BookmarkFolderOption = { id: string; label: string }
let bookmarkFolderOptions = (bookmarks: Bookmark[], ancestors: string[] = []): BookmarkFolderOption[] => bookmarks.flatMap(bookmark => {
  if (!bookmark.children) return []
  let path = [...ancestors, bookmark.title || 'Untitled folder']
  return [{ id: bookmark.id, label: path.join(' / ') }, ...bookmarkFolderOptions(bookmark.children, path)]
})
let bookmarkFolderForUrl = (bookmarks: Bookmark[], url: string, folderId = ''): string | undefined => {
  for (let bookmark of bookmarks) {
    if (bookmark.url === url) return folderId
    if (bookmark.children) {
      let nested = bookmarkFolderForUrl(bookmark.children, url, bookmark.id)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}
let BookmarkEditor = () => {
  let { state, run, dismiss } = useUI()
  let { tab, profile } = selection(state)
  let folders = bookmarkFolderOptions(profile?.bookmarks ?? [])
  let [title, setTitle] = useState(tab?.title && tab.title !== 'about:blank' ? tab.title : ''), [folder, setFolder] = useState(() => bookmarkFolderForUrl(profile?.bookmarks ?? [], tab?.url ?? '') ?? '')
  let [busy, setBusy] = useState(false), [creatingFolder, setCreatingFolder] = useState(false), [folderName, setFolderName] = useState(''), [folderBusy, setFolderBusy] = useState(false)
  let input = useRef<HTMLInputElement>(null)
  let folderNameInput = useRef<HTMLInputElement>(null)
  let { ref: folderPicker, keys: folderKeys, input: folderSearch, query: folderQuery, setQuery: setFolderQuery, change: changeFolderQuery } = usePickerNavigation()
  let folderOptions = [{ id: '', label: 'Profile root' }, ...folders]
  let matchingFolders = folderOptions.filter(option => fuzzyMatch(folderQuery, option.label))
  let selectedFolder = folderOptions.find(option => option.id === folder)?.label ?? 'Profile root'
  let supported = !!tab && /^(https?:|file:)/i.test(tab.url)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => { if (creatingFolder) folderNameInput.current?.focus() }, [creatingFolder])
  let changeTitle = (event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)
  let chooseFolder = (event: MouseEvent<HTMLButtonElement>) => setFolder(event.currentTarget.dataset.id ?? '')
  let beginFolder = () => { setFolderName(''); setCreatingFolder(true) }
  let cancelFolder = () => { setFolderName(''); setCreatingFolder(false); folderSearch.current?.focus() }
  let changeFolderName = (event: ChangeEvent<HTMLInputElement>) => setFolderName(event.target.value)
  let createFolder = async () => {
    if (!tab || !folderName.trim() || folderBusy) return
    setFolderBusy(true)
    let result = await run('bookmark.folder.add', { tab: tab.id, title: folderName, parent: folder }) as { folder: Bookmark } | undefined
    setFolderBusy(false)
    if (!result) return
    setFolder(result.folder.id); setFolderQuery(''); setFolderName(''); setCreatingFolder(false)
  }
  let folderNameKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); void createFolder() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelFolder() }
  }
  let editorKeys = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== '/' || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    let titleSelected = event.target === input.current && input.current?.selectionStart === 0 && input.current.selectionEnd === title.length
    if (!titleSelected && event.target instanceof HTMLInputElement) return
    event.preventDefault(); folderSearch.current?.focus(); folderSearch.current?.select()
  }
  let submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!tab || !supported || !title.trim() || busy) return
    setBusy(true)
    let result = await run('bookmark.add', { tab: tab.id, title, folder })
    setBusy(false)
    if (result !== undefined) dismiss()
  }
  if (!profile || !tab) return <p>No page is selected.</p>
  return <form className={css.bookmarkEditor} onSubmit={submit} onKeyDown={editorKeys}>
    <p className={css.bookmarkUrl}>{tab.url}</p>
    <label>Title<input ref={input} value={title} onChange={changeTitle} autoComplete="off" spellCheck={false} required /></label>
    <div ref={folderPicker} className={css.bookmarkFolders} onKeyDown={folderKeys} role="group" aria-label="Choose bookmark folder">
      <label>Folder search<SearchInput ref={folderSearch} aria-label="Search bookmark folders" value={folderQuery} onChange={changeFolderQuery} /></label>
      <div className={css.bookmarkFolderRows}>{matchingFolders.map(option => <button key={option.id || 'root'} type="button" className={css.listRow} data-bookmark-folder data-id={option.id} data-active={folder === option.id} aria-pressed={folder === option.id} onClick={chooseFolder}>{option.label}</button>)}</div>
      {!matchingFolders.length && <p role="status">No matching folders.</p>}
      {creatingFolder ? <div className={css.newBookmarkFolder}><label>New folder name<input ref={folderNameInput} value={folderName} onChange={changeFolderName} onKeyDown={folderNameKeys} autoComplete="off" spellCheck={false} /></label><div><button type="button" data-picker-action onClick={createFolder} disabled={!folderName.trim() || folderBusy}>{folderBusy ? 'Creating…' : 'Create folder'}</button><button type="button" data-picker-action onClick={cancelFolder} disabled={folderBusy}>Cancel</button></div></div> : <button type="button" data-picker-action onClick={beginFolder}>New folder inside {selectedFolder}</button>}
    </div>
    {!supported && <p role="alert">Open an HTTP, HTTPS, or file page before bookmarking it.</p>}
    <button type="submit" disabled={!supported || !title.trim() || busy}>{busy ? 'Saving…' : 'Save bookmark'}</button>
  </form>
}
let BookmarkExpansionContext = createContext<{ expandedBookmarkId: string | null; setExpandedBookmarkId: (bookmarkId: string | null) => void } | null>(null)

let BookmarkPicker = () => {
  let { state, run, dismiss, bookmarkSearches, rememberBookmarkSearch } = useUI()
  let { profile, client, session, tab } = selection(state)
  let [expandedBookmarkId, setExpandedBookmarkId] = useState<string | null>(null)
  let [pointerMode, setPointerMode] = useState(false)
  let bookmarks: Bookmark[] = []
  let activate = async (bookmark: Bookmark, newWindow = false, settings?: BookmarkParameters) => {
    if (!bookmark.url || !/^(https?:|file:)/i.test(bookmark.url) || !client?.paneId) return
    let url = parameterizedBookmarkUrl(bookmark.url, settings ?? state.bookmarkParameters?.[profile!.id]?.[bookmark.id])
    let result = newWindow
      ? await run('new-window', { session: session?.id, profile: profile?.id, client: client.id, url })
      : tab ? await run('navigate', { pane: tab.id, url }) : undefined
    if (result !== undefined) dismiss()
  }
  let { ref, keys, input, query, change } = usePickerNavigation(row => {
    let bookmark = findBookmark(bookmarks, row.dataset.bookmarkId ?? '')
    if (bookmark) void activate(bookmark, true)
  }, bookmarkSearches[profile?.id ?? ''] ?? '', value => { if (profile) rememberBookmarkSearch(profile.id, value) })
  let changeQuery = (event: ChangeEvent<HTMLInputElement>) => { setExpandedBookmarkId(null); change(event) }
  let focus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === input.current || (event.target instanceof HTMLButtonElement && event.target.dataset.bookmarkId && event.target.dataset.bookmarkId !== expandedBookmarkId)) setExpandedBookmarkId(null)
  }
  bookmarks = searchBookmarks(profile?.bookmarks ?? [], query)
  return <BookmarkExpansionContext.Provider value={{ expandedBookmarkId, setExpandedBookmarkId }}><div ref={ref} data-bookmark-picker data-pointer-mode={pointerMode} onPointerMove={() => setPointerMode(true)} onKeyDownCapture={() => setPointerMode(false)} onFocusCapture={focus} onKeyDown={keys} role="group" aria-label="Choose bookmark"><SearchInput ref={input} aria-label="Search bookmarks" value={query} onChange={changeQuery} />{bookmarks.map(bookmark => <BookmarkRow key={`${query}:${bookmark.id}`} bookmark={bookmark} profileId={profile?.id ?? ''} activate={activate} />)}{!bookmarks.length && <p role="status">{query ? 'No matching bookmarks.' : 'No bookmarks in this profile.'}</p>}</div></BookmarkExpansionContext.Provider>
}
let findBookmark = (bookmarks: Bookmark[], id: string): Bookmark | undefined => {
  for (let bookmark of bookmarks) {
    if (bookmark.id === id) return bookmark
    if (bookmark.children) {
      let found = findBookmark(bookmark.children, id)
      if (found) return found
    }
  }
}
let BookmarkRow = ({ bookmark, profileId, activate }: { bookmark: Bookmark; profileId: string; activate: (bookmark: Bookmark, newTab?: boolean, settings?: BookmarkParameters) => void }) => {
  let { state, run } = useUI()
  let { expandedBookmarkId, setExpandedBookmarkId } = useContext(BookmarkExpansionContext)!
  let expanded = expandedBookmarkId === bookmark.id
  let [settings, setSettings] = useState<BookmarkParameters>(() => state.bookmarkParameters?.[profileId]?.[bookmark.id] ?? { values: {}, hidden: [] })
  let supported = !!bookmark.url && /^(https?:|file:)/i.test(bookmark.url)
  let parameters = bookmark.url ? editableBookmarkParameters(bookmark.url, settings) : []
  let visible = parameters.filter(([key]) => !settings.hidden.includes(key))
  let persist = async (next: BookmarkParameters) => run('bookmark.parameters.update', { profile: profileId, bookmark: bookmark.id, ...next })
  let open = async () => { if (parameters.length && await persist(settings) === undefined) return; activate(bookmark, true, settings) }
  let click = () => { void open() }
  let toggle = () => setExpandedBookmarkId(expanded ? null : bookmark.id)
  let update = (key: string, value: string) => setSettings(current => ({ ...current, values: { ...current.values, [key]: value } }))
  let hide = (key: string) => {
    let next = { ...settings, hidden: [...settings.hidden, key] }
    setSettings(next); void persist(next)
  }
  let save = () => { void persist(settings) }
  if (bookmark.children) return <details className={css.folder} open><summary>{bookmark.title || 'Untitled folder'}</summary><div>{bookmark.children.map(child => <BookmarkRow key={child.id} bookmark={child} profileId={profileId} activate={activate} />)}</div></details>
  return <div className={css.bookmarkItem}>
    <div className={css.bookmarkRow}><button className={css.listRow} data-bookmark-id={bookmark.id} data-active={expanded} disabled={!supported} onClick={click} title={supported ? bookmark.url : 'Unsupported URL type'}>{bookmark.title || bookmark.url}</button>
      {!!visible.length && <button type="button" data-picker-action className={css.bookmarkCustomize} aria-label={`Customize ${bookmark.title || bookmark.url}`} aria-expanded={expanded} onClick={toggle} title="Customize URL parameters"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /><circle cx="6" cy="4" r="1.5" /><circle cx="10" cy="8" r="1.5" /><circle cx="5" cy="12" r="1.5" /></svg></button>}
    </div>
    {expanded && !!visible.length && <div className={css.bookmarkParameters} aria-label="Bookmark URL parameters">{visible.map(([key, initial]) => {
      let value = settings.values[key] ?? initial
      let { label, help } = bookmarkParameterPresentation(bookmark.url!, key)
      let numeric = /^-?\d+(?:\.\d+)?$/.test(initial) && Number.isFinite(Number(initial))
      let number = Number(initial), currentNumber = Number(value) || number
      let minimum = key === 'x:max_age_days' ? 0 : Math.min(0, Math.floor(number * 2), Math.floor(currentNumber * 2)), maximum = key === 'x:max_age_days' ? Math.max(365, currentNumber) : Math.max(100, Math.ceil(number * 2), Math.ceil(currentNumber * 2))
      let step = initial.includes('.') ? 10 ** -Math.min(initial.split('.')[1].length, 4) : 1
      let changeValue = (event: ChangeEvent<HTMLInputElement>) => update(key, event.target.value)
      let remove = () => hide(key)
      return <div className={css.bookmarkParameter} key={key}><label><span title={help ?? label}>{label}</span><input aria-label={label} title={help} type={numeric ? 'number' : 'text'} value={value} step={numeric ? step : undefined} onChange={changeValue} onBlur={save} autoComplete="off" spellCheck={false} /></label>{numeric && <input aria-label={`${label} slider`} title={help} type="range" min={minimum} max={maximum} step={step} value={value} onChange={changeValue} onPointerUp={save} onBlur={save} />}<button type="button" data-picker-action className={css.bookmarkRemoveParameter} aria-label={`Remove ${label} parameter`} title={`Remove ${label} from this bookmark URL`} onClick={remove}>×</button></div>
    })}<button type="button" data-picker-action className={css.bookmarkOpenCustomized} onClick={click}>Open</button></div>}
  </div>
}
let HistoryPicker = () => {
  let { state } = useUI()
  let { profile } = selection(state)
  let { ref, keys, input, query, change } = usePickerNavigation()
  let history = searchHistory(profile?.history ?? [], query)
  return <div ref={ref} onKeyDown={keys} role="group" aria-label="Choose history entry"><p>Profile: {profile?.name ?? 'No selected pane'}</p><SearchInput ref={input} aria-label="Search history" value={query} onChange={change} />{history.map(entry => <HistoryRow key={`${entry.url}:${entry.visitedAt}`} entry={entry} />)}{!history.length && <p role="status">{query ? 'No matching history.' : 'No history in this profile.'}</p>}</div>
}
let HistoryRow = ({ entry }: { entry: HistoryEntry }) => {
  let { state, run, dismiss } = useUI()
  let { tab, profile } = selection(state)
  let activate = async () => {
    if (tab && await run('navigate', { tab: tab.id, url: entry.url }) !== undefined) dismiss()
  }
  let visited = new Date(entry.visitedAt)
  let remove = () => { if (profile) void run('history.remove', { profile: profile.id, url: entry.url }) }
  return <div className={css.historyEntry}><button className={`${css.listRow} ${css.historyRow}`} onClick={activate} title={entry.url}><span><strong>{entry.title || entry.url}</strong><span>{entry.url}</span></span><time dateTime={visited.toISOString()}>{visited.toLocaleString()}</time></button><button type="button" data-picker-action className={css.historyRemove} aria-label={`Remove ${entry.title || entry.url} from history`} title="Remove from history" onClick={remove}>×</button></div>
}
let PermissionRow = ({ permission }: { permission: Permission }) => {
  let { run } = useUI()
  let deny = () => { void run('permission.respond', { id: permission.id, allow: false }) }
  let allow = () => { void run('permission.respond', { id: permission.id, allow: true }) }
  return <div className={css.row}>{permission.origin}: {permission.permission}<div><button onClick={deny}>Deny</button><button onClick={allow}>Allow</button></div></div>
}
let downloadSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
let DownloadManager = () => {
  let { state } = useUI()
  let { profile } = selection(state)
  let downloads = state.downloads.filter(download => download.profileId === profile?.id)
  return <section aria-label="Profile downloads"><p>Downloads · {profile?.name}</p>
    {!downloads.length && <p>No downloads in this profile.</p>}
    {downloads.map(download => <DownloadRow key={download.id} download={download} />)}
  </section>
}
let DownloadRow = ({ download }: { download: Download }) => {
  let { run, acknowledgeDownload } = useUI()
  let [busy, setBusy] = useState(false)
  let action = async (event: MouseEvent<HTMLButtonElement>) => {
    let method = event.currentTarget.dataset.method!
    if (method === 'cancel' || method === 'reveal') acknowledgeDownload(download.id)
    setBusy(true)
    try { await run(`download.${method}`, { id: download.id, profile: download.profileId }) }
    finally { setBusy(false) }
  }
  let status = download.paused ? 'Paused' : download.state === 'interrupted' ? download.active ? 'Interrupted' : 'Failed' : download.state === 'progressing' ? 'Downloading' : download.state === 'completed' ? 'Completed' : 'Cancelled'
  let progress = download.total > 0 ? Math.min(100, Math.floor(download.received / download.total * 100)) : undefined
  return <article className={css.download} aria-label={download.name}>
    <strong>{download.name}</strong><span>{status} · {downloadSize(download.received)}{download.total > 0 ? ` / ${downloadSize(download.total)} (${progress}%)` : ' · Size unknown'}</span>
    {download.active && <progress aria-label={`Download progress for ${download.name}`} max={100} value={progress} />}
    <div>
      {download.active && download.state === 'progressing' && !download.paused && <button disabled={busy} data-method="pause" onClick={action}>Pause</button>}
      {download.active && (download.paused || download.state === 'interrupted') && <button disabled={busy || !download.canResume} data-method="resume" onClick={action}>Resume</button>}
      {download.active && <button disabled={busy} data-method="cancel" onClick={action}>Cancel</button>}
      {download.state === 'completed' && <button disabled={busy} data-method="reveal" onClick={action}>Show in Finder</button>}
    </div>
  </article>
}

let HelpRow = ({ label, description, query }: { label: string; description: string; query: string }) => <div><dt><MatchText value={label} query={query} /></dt><dd><MatchText value={description} query={query} /></dd></div>
let HelpContent = () => {
  let { state } = useUI()
  let [query, setQuery] = useState(''), [searching, setSearching] = useState(false)
  let root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  useEffect(() => { root.current?.focus() }, [])
  useEffect(() => { if (searching) input.current?.focus() }, [searching])
  let keyboard = state.keyboard ?? DEFAULT_KEYBOARD
  let entries = commandEntries(keyboard, state.plugins)
  let bindings = [...Object.entries(keyboard.shortcuts).map(([key, binding]) => [shortcutLabel(key, binding), shortcutAction(binding)]), ...Object.entries(keyboard.sequences).map(([key, binding]) => [shortcutLabel(key.split('').join(' '), binding), shortcutAction(binding)]), ...Object.entries(keyboard.prefixBindings).map(([key, action]) => [`${keyboard.prefix} then ${key}`, action])].map(([key, action]) => ({ key, action, description: entries.find(entry => entry.action === action)?.description ?? '' })).filter(binding => fuzzyMatch(query, `${binding.key} ${binding.action} ${binding.description}`))
  let commands = searchCommands(entries, query), notes = HELP_NOTES.filter(note => fuzzyMatch(query, note))
  let change = (event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSearching(true) }
  useEffect(() => {
    let keys = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && event.target !== input.current) { event.preventDefault(); setSearching(true); input.current?.focus(); input.current?.select() }
      if (event.key === 'Escape' && searching) { event.preventDefault(); event.stopPropagation(); setSearching(false); setQuery(''); root.current?.focus() }
      if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); root.current?.focus() }
    }
    document.addEventListener('keydown', keys, true)
    return () => document.removeEventListener('keydown', keys, true)
  }, [searching])
  return <div ref={root} tabIndex={-1} className={css.helpContent}>
    <div className={css.helpSearch}><SearchInput ref={input} aria-label="Search help" value={query} onChange={change} /><span role="status">{query ? `${bindings.length + commands.length + notes.length} matches · Esc clears search` : 'Esc closes help'}</span></div>
    {!!bindings.length && <><h2>Shortcuts</h2><dl>{bindings.map(binding => <HelpRow key={binding.key} label={binding.key} description={binding.action} query={query} />)}</dl></>}
    {!!commands.length && <><h2>Commands</h2><dl className={css.helpCommands}>{commands.map(entry => <HelpRow key={entry.command} label={entry.usage ?? entry.command} description={entry.description} query={query} />)}</dl></>}
    {notes.map(note => <p key={note}>{note}</p>)}
    {!bindings.length && !commands.length && !notes.length && <p>No matching help entries.</p>}
  </div>
}

let ToolStatus = () => {
  let { state, show, run, control } = useUI()
  let { tab, profile } = selection(state)
  let tools = state.browserTools, current = tab && tools?.tabs[tab.id]
  let configure = () => show('browser-tools')
  let plugins = () => show('plugins')
  let edit = () => { void run('settings.open') }
  let blocking = !current?.origin ? 'No website selected' : current.adblock ? 'On' : 'Off'
  let filters = tools?.filters
  return <section className={css.toolStatus} aria-label="Tools status">
    <h2>Tools status</h2>
    <p>{profile?.name ?? 'No profile'} · {current?.origin || 'No website selected'}</p>
    <dl>
      <div><dt>Ad blocking</dt><dd>{blocking}{current?.origin && ` · ${current.blocked} requests blocked since navigation`}</dd></div>
      <div><dt>Filter lists</dt><dd>{!filters ? 'Loading' : filters.error ? 'Needs attention' : filters.updating ? 'Updating' : filters.network ? 'Ready' : 'Unavailable'}</dd></div>
      <div><dt>Website dark mode</dt><dd>{current?.origin ? current.darkMode === 'dark' ? 'On' : current.darkMode === 'system' ? 'Follow system' : 'Off' : 'No website selected'}</dd></div>
      <div><dt>Userscripts</dt><dd>{tools ? `${tools.scripts.filter(script => script.enabled).length} enabled · ${tools.scripts.filter(script => script.error).length} errors` : 'Loading'}</dd></div>
      <div><dt>Plugins</dt><dd>{state.plugins?.filter(plugin => plugin.enabled).length ?? 0} enabled · {state.plugins?.filter(plugin => plugin.error).length ?? 0} errors</dd></div>
    </dl>
    {current?.error && <p className={css.error}>{current.error}</p>}
    {filters?.error && <p className={css.error}>{filters.error}</p>}
    <div className={css.toolActions}>{control !== 'browser-tools' && <button onClick={configure}>Configure browser tools</button>}{control !== 'plugins' && <button onClick={plugins}>Manage plugins</button>}{control === 'plugins' && <button onClick={edit}>Edit config</button>}</div>
  </section>
}

let BrowserTools = ({ compact = false }: { compact?: boolean }) => {
  let { state, run, show } = useUI()
  let { tab, profile } = selection(state)
  let tools = state.browserTools, current = tab && tools?.tabs[tab.id]
  let [scope, setScope] = useState('site')
  let settings = scope === 'global' ? tools?.defaults : scope === 'profile' ? current?.profileDefaults : current
  let changeScope = (event: ChangeEvent<HTMLSelectElement>) => setScope(event.target.value)
  let adblock = () => { void run('browser.set', { tab: tab?.id, setting: 'adblock', value: !settings?.adblock, scope }) }
  let dark = (event: ChangeEvent<HTMLSelectElement>) => { void run('browser.set', { tab: tab?.id, setting: 'darkMode', value: event.target.value, scope }) }
  let inherit = async () => { await run('browser.set', { tab: tab?.id, setting: 'adblock', value: 'inherit', scope }); await run('browser.set', { tab: tab?.id, setting: 'darkMode', value: 'inherit', scope }) }
  let update = () => { void run('browser.update-filters') }
  let reload = () => { void run('browser.reload-scripts') }
  let edit = () => { void run('settings.open') }
  let plugins = () => show('plugins')
  let toggleScript = (event: ChangeEvent<HTMLInputElement>) => { void run('browser.script', { id: event.target.dataset.id, enabled: event.target.checked }) }
  return <>{!compact && <ToolStatus />}{!compact && <h2>Browser tool settings</h2>}<p>{profile?.name} · {current?.origin || 'Open a website to change its settings'}</p>
    <div className={css.toolOptions}><label>Apply changes to<select value={scope} onChange={changeScope}><option value="site">This site in this profile</option><option value="profile">This profile</option><option value="global">All profiles</option></select></label>
      <button onClick={adblock} disabled={!tab || (scope === 'site' && !current?.origin)} aria-pressed={settings?.adblock}>Ad and tracker blocking: {settings?.adblock ? 'on' : 'off'}</button>
      <label>Website dark mode<select value={settings?.darkMode ?? 'off'} onChange={dark} disabled={!tab || (scope === 'site' && !current?.origin)}><option value="off">Off</option><option value="dark">Dark Reader</option><option value="system">Follow system</option></select></label>
      <button onClick={inherit} disabled={!tab || (scope === 'site' && !current?.origin)}>Reset to inherited settings</button>
    </div>
    {!compact && scope !== 'site' && <p>Existing site overrides still apply. This page: blocking {current?.adblock ? 'on' : 'off'}, dark mode {current?.darkMode ?? 'off'}.</p>}
    {current?.error && <p className={css.error}>{current.error}</p>}
    <p>{compact ? `Blocked requests: ${current?.blocked ?? 0}` : `${current?.blocked ?? 0} requests blocked since navigation. Turning blocking off allows new requests; reload to retry resources already blocked.`}</p>
    {!!current?.recent.length && <details><summary>Blocked requests</summary>{current.recent.map((request, index) => <div className={css.row} key={`${request.time}:${index}`}>{request.host} · {request.type} · {new Date(request.time).toLocaleTimeString()}</div>)}</details>}
    {!compact && <p>{tools?.filters.network ?? 0} network rules · {tools?.filters.cosmetic ?? 0} cosmetic rules. Filters updated {tools?.filters.updatedAt ? new Date(tools.filters.updatedAt).toLocaleDateString() : 'never'}.</p>}
    {tools?.filters.error && <p className={css.error}>{tools.filters.error}</p>}
    <button onClick={update} disabled={tools?.filters.updating}>{tools?.filters.updating ? 'Updating filters…' : 'Update filters'}</button>
    <p>Userscripts and styles</p>
    {tools?.scripts.length ? tools.scripts.map(script => <label className={css.row} key={script.id}><input type="checkbox" data-id={script.id} checked={script.enabled} onChange={toggleScript} />{script.name}{script.error && <span className={css.error}>{script.error}</span>}</label>) : <p>{compact ? 'No userscripts' : 'Add local .js or .css files under browser.userscripts in the config. JavaScript changes apply on the next navigation.'}</p>}
    <button onClick={reload}>Reload scripts</button>{!compact && <><button onClick={edit}>Edit config</button><p>Use <code>save-fill</code> to save a form, <code>fill</code> to restore it.</p><button onClick={plugins}>Form fills and plugins</button></>}
  </>
}

type SettingsTab = 'general' | 'appearance' | 'memory' | 'browser-tools' | 'keyboard' | 'plugins'
let AppearanceSettings = ({ changeSetting }: { changeSetting: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void }) => {
  let { state } = useUI()
  return <>
    <section className={css.settingsGroup} aria-label="Browser layout"><h3>Browser layout</h3>
      <label className={css.settingsRow}><span>Status bar</span><select name="statusBar" value={state.statusBar ?? 'top'} onChange={changeSetting}><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
      <label className={css.settingsRow}><span>Window close buttons</span><input type="checkbox" name="showTabCloseButtons" checked={state.showTabCloseButtons === true} onChange={changeSetting} /></label>
    </section>
    <section className={css.settingsGroup} aria-label="Click mode"><h3>Click mode</h3>
      <label className={css.settingsRow}><span>Enabled</span><input type="checkbox" name="clickMode.enabled" checked={state.clickMode?.enabled !== false} onChange={changeSetting} /></label>
      <label className={css.settingsRow}><span>Double tap to activate</span><select name="clickMode.doubleTapModifier" value={state.clickMode?.doubleTapModifier ?? 'none'} onChange={changeSetting} disabled={state.clickMode?.enabled === false}><option value="none">Off</option><option value="Option">Option</option><option value="Command">Command</option><option value="Control">Control</option><option value="Shift">Shift</option><option value="Escape">Escape</option></select></label>
    </section>
  </>
}
let MemorySettings = ({ changeSetting }: { changeSetting: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void }) => {
  let { state } = useUI()
  let minutes = state.memory?.idleUnloadMinutes ?? 0
  return <>
    <label className={css.settingsRow}><span>Load inactive sessions on demand</span><input type="checkbox" name="memory.lazyRestore" checked={state.memory?.lazyRestore !== false} onChange={changeSetting} /></label>
    <p className={css.settingsHint}>Applies on the next launch. Agent commands load pages when addressed. Background profiles still start normally.</p>
    <label className={css.settingsRow}><span>Unload idle pages</span><select name="memory.idleUnloadMinutes" value={minutes} onChange={changeSetting}><option value="0">Off</option><option value="5">After 5 minutes</option><option value="15">After 15 minutes</option><option value="30">After 30 minutes</option><option value="60">After 1 hour</option>{![0, 5, 15, 30, 60].includes(minutes) && <option value={minutes}>After {minutes} minutes</option>}</select></label>
    <p className={css.settingsHint}>Only hidden, inactive pages that pass safety checks are unloaded. Page memory and JavaScript state cannot always be restored; use Keep Page Loaded for important windows.</p>
  </>
}
let SettingsContent = () => {
  let { state, run, onMessage } = useUI()
  let [tab, setTab] = useState<SettingsTab>('general')
  let [prefix, setPrefix] = useState(state.keyboard?.prefix ?? DEFAULT_KEYBOARD.prefix)
  useEffect(() => setPrefix(state.keyboard?.prefix ?? DEFAULT_KEYBOARD.prefix), [state.keyboard?.prefix])
  let makeDefault = async () => { if (await run('settings.default-browser')) onMessage('Default browser requested. Confirm any macOS prompt; you can also choose bmux in System Settings > Desktop & Dock.') }
  let changeTab = (event: MouseEvent<HTMLButtonElement>) => setTab(event.currentTarget.dataset.tab as SettingsTab)
  let moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    let index = tabs.findIndex(item => item.id === (event.target as HTMLElement).dataset.tab)
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setTab(tabs[next].id)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  let changeSetting = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    let target = event.currentTarget
    void run('settings.set', { key: target.name, value: target instanceof HTMLInputElement ? target.checked : target.name === 'memory.idleUnloadMinutes' ? Number(target.value) : target.value === 'none' ? null : target.value })
  }
  let changePrefix = (event: ChangeEvent<HTMLInputElement>) => setPrefix(event.target.value)
  let savePrefix = () => { void run('settings.set', { key: 'keyboard.prefix', value: prefix }) }
  let edit = () => { void run('settings.open') }
  let reload = () => { void run('settings.reload') }
  let tabs: { id: SettingsTab; label: string }[] = [{ id: 'general', label: 'General' }, { id: 'appearance', label: 'Appearance' }, { id: 'memory', label: 'Memory' }, { id: 'browser-tools', label: 'Browser tools' }, { id: 'keyboard', label: 'Keyboard' }, { id: 'plugins', label: 'Plugins' }]
  return <div className={css.settings}>
    <div className={css.settingsTabs} role="tablist" aria-label="Settings sections" onKeyDown={moveTab}>{tabs.map(item => <button key={item.id} type="button" role="tab" data-tab={item.id} aria-selected={tab === item.id} aria-controls="settings-panel" tabIndex={tab === item.id ? 0 : -1} onClick={changeTab}>{item.label}</button>)}</div>
    <section id="settings-panel" role="tabpanel" aria-label={tabs.find(item => item.id === tab)?.label} className={css.settingsContent}>
      {tab === 'general' && <><label className={css.settingsRow}><span>Accessibility</span><input type="checkbox" name="accessibility" checked={state.accessibility === true} onChange={changeSetting} /></label><p className={css.settingsHint}>Lets screen readers and other accessibility tools inspect page controls.</p><button onClick={makeDefault}>Make bmux the default browser</button></>}
      {tab === 'appearance' && <AppearanceSettings changeSetting={changeSetting} />}
      {tab === 'memory' && <MemorySettings changeSetting={changeSetting} />}
      {tab === 'browser-tools' && <BrowserTools compact />}
      {tab === 'keyboard' && <><label className={css.settingsRow}><span>Prefix</span><input type="text" aria-label="Keyboard prefix" value={prefix} onChange={changePrefix} /></label><button onClick={savePrefix} disabled={prefix === state.keyboard?.prefix}>Save prefix</button><button onClick={edit}>Edit shortcuts in config</button></>}
      {tab === 'plugins' && <PluginList compact />}
    </section>
    {state.configError && <p className={css.error}>{state.configError}</p>}
    <footer className={css.settingsFooter}><button onClick={edit}>Edit config</button><button onClick={reload}>Reload</button></footer>
  </div>
}
