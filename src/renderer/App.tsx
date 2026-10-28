import { remoteWorkspaceShortcut } from '../shared/remote-workspace'
import { RemotePaneControls } from './RemotePaneControls'
import { useViewportPan } from './useViewportPan'
import { PROFILE_COLORS, profileHash, profileColor } from '../shared/profile-color'
import type { RemoteView } from '../shared/remote'
import { DEFAULT_REMOTE_PREVIEWS } from '../shared/remote-preview-settings'
import type { RemotePreviewSettings } from '../shared/remote-preview-settings'
import { profileDeletionReason } from '../shared/profile-management'
import { MessageDialog } from './MessageDialog'
import { NavigationFailure } from './NavigationFailure'
import { AgentFeedbackSettings, FeedbackTabIcon } from './AgentFeedbackSettings'
import type { FeedbackSection } from './AgentFeedbackSettings'
import { DEFAULT_AGENT_FEEDBACK } from '../shared/agent-feedback'
import { RemoteAccount } from './RemoteAccount'
import { RemoteMachineDetails, RemoteMachineHeading, remoteMachineName, useRemoteMachines } from './RemoteMachine'
import { VimMode } from './VimMode'
import { pickerRemovalFocus } from './picker-removal-focus'
import { VimCursor } from './VimCursor'
import { usePanelStack } from './usePanelStack'
import { BackButton, PanelBackContext, PanelHeader, usePanelBack } from './PanelHeader'
import type { PanelBack } from './PanelHeader'
import { useAddressVim } from './useAddressVim'
import { activityAge, activityLabel, compactActivityLabel, windowActivityTime, windowVisitTime } from '../shared/pane-activity'
import { lastPaneAgent, paneAgents } from '../shared/pane-agents'
import { agentIdentifier } from '../shared/agent-info'
import { connectionProfile, defaultConnectionId, paneConnectionId, savedProxyProfiles } from '../shared/profile-connections'
import { deviceFrameScreen, deviceScreenShape } from '../shared/device-frame'
import { permissionPaneLabel } from '../shared/permission-source'
import { parseDevicePersona } from '../shared/device-persona'
import { DeviceEmulationDetails } from './DeviceEmulationDetails'
import { automationWebsiteHost, automationExclusionActive, automationProfileLimits, automationSiteExclusion, automationSiteEnabled, automationSafetyEnabled, automationWarningEnabled, DEFAULT_AUTOMATION } from '../shared/automation'
import type { AutomationActor, AutomationSiteExclusion, AutomationSafetyLimitKey, AutomationSafetyState, AutomationWarning } from '../shared/automation'
import { ConnectionIndicator } from './ConnectionIndicator'
import { connectionLabels, initialSecurity } from '../shared/site-security'
import { Fragment, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HTMLAttributes, ChangeEvent, DragEvent, FocusEvent, FormEvent, KeyboardEvent, PointerEvent, MouseEvent, RefObject, ReactNode } from 'react'
import type { Bookmark, BookmarkParameters, Bridge, DevicePersona, DevicePlatform, DevicePreset, Download, HistoryEntry, InternalWindow, Layout, Permission, Profile, PublicState, RemoteSessionListing, Snapshot } from '../shared/types'
import type { RemoteHost, RemoteSession, RemoteWindow } from '../shared/remote-sessions'
import type { RemoteComputer } from '../shared/remote-account'
import css from './App.module.css'
import iphoneFrame from './device-frames/iphone-15-pro.png'
import pixelFrame from './device-frames/pixel-8.png'
import galaxyFrame from './device-frames/galaxy-s24.png'
import { SearchInput } from './SearchInput'
import { captureAddressPointer, useAddressSelection } from './useAddressSelection'
import { DEFAULT_KEYBOARD, shortcutAction, shortcutLabel } from '../shared/keyboard'
import { commandEntries, fuzzyMatch, HELP_NOTES, literalCommand, PANEL_COMMANDS, searchCommands } from '../shared/command-search'
import type { CommandEntry } from '../shared/command-search'
import { commandTargetSuggestions } from '../shared/command-completion'
import { searchBookmarkPages, searchBookmarks, searchHistory, searchSessions, searchRecentWindows } from '../shared/picker-search'
import { sessionIsLocked, windowCloseBehavior } from '../shared/window-close'
import { backOpener } from '../shared/opener-navigation'
import { addressDestination, addressUrlCompletion, inlineUrlCompletion, prioritizeInlineHistory, searchUrlDestination, urlDestinationTitle, withAddressSearch } from '../shared/address-suggestions'
import { deduplicateAddressEntries } from '../shared/address-result-deduplication'
import { deleteWordBackward } from '../shared/text-edit'
import { BookmarkPlugins } from './BookmarkPlugins'
import { bookmarkParameterPresentation, editableBookmarkParameters, parameterizedBookmarkUrl } from '../shared/bookmark-parameters'
import { clampFloat } from '../shared/floating'
import { DEFAULT_SEARCH_APPS, SEARCH_APPS } from '../shared/search-app'
import type { ClickAction } from '../shared/click-mode'
import { CloseButton } from './CloseButton'
import { BookmarkActions, BookmarkTitle, useBookmarkActions } from './BookmarkActions'
import type { PluginProxyProvider, PluginProxyRegion } from '../shared/plugins'
import type { ExtensionDetails } from '../shared/extension-details'

type ManagementControl = 'rename-window' | 'rename-session' | 'move-window' | 'select-window' | 'close-pane' | 'close-window'
type Control = ManagementControl | 'address' | 'command' | 'find' | 'help' | 'sessions' | 'bookmark' | 'bookmarks' | 'history' | 'activity' | 'downloads' | 'extensions' | 'profiles' | 'proxy' | 'settings' | 'plugins' | 'plugin-dialog' | 'site-info' | 'adblock-popup' | 'dark-mode-popup' | 'agent-info' | 'anti-bot-settings'
type PanelLocation = { control: Control | null; initialPlugin: BuiltinTool | null; bookmarkDestination: BookmarkDestination | null; agentDetails: AgentDetails }
type AgentDetails = { paneId: string } | { actors: AutomationActor[] } | { windowId: string } | { sessionId: string }
type HistoryPopup = { tabId: string; direction: 'back' | 'forward' }
type BookmarkDestination = { profileId: string; folderId: string }
type AddressSelection = { start: number; end: number; direction: 'forward' | 'backward' | 'none' }
type Notification = { id: string; text: string; warning?: AutomationWarning; detectedAt?: number; cooldown?: { retryAfter: string; minutes: number }; profileId?: string; agents?: AutomationActor[]; dismiss?: () => void; actions?: { label: string; title?: string; disabled?: boolean; run: () => void }[]; paneLinks?: { label: string; title: string; run: () => void }[]; siteExclusion?: { profileId: string; host: string } }
type BrowserExtension = ExtensionDetails & { id: string; name: string; version: string; path: string; enabled: boolean; hasPopup: boolean; hasOptions: boolean; error?: string }
type ExtensionList = { extensions: BrowserExtension[]; available: Pick<BrowserExtension, 'name' | 'version' | 'path'>[]; errors: { path: string; error: string }[] }
type BookmarkView = { scroll?: number; folders?: Record<string, boolean> }
type UIContext = { panelBack: PanelBack | null; settingsTarget: 'build' | null; setSettingsTarget: (target: 'build' | null) => void; agentDetails: AgentDetails; setAgentDetails: (details: AgentDetails) => void; bookmarkViews: Record<string, BookmarkView>; rememberBookmarkView: (profileId: string, view: BookmarkView) => void; settingsMemory: Map<string, { initial: unknown; value: unknown }>; initialPlugin: BuiltinTool | null; state: PublicState; control: Control | null; historyPopup: HistoryPopup | null; setHistoryPopup: (popup: HistoryPopup | null) => void; bookmarkDestination: BookmarkDestination | null; addressFocusVersion: number; setAddressSuggestionsVisible: (visible: boolean) => void; message: string; onMessage: (message: string) => void; run: (method: string, args?: Record<string, unknown>) => Promise<unknown>; show: (control: Control, paneId?: string, destination?: BookmarkDestination, plugin?: BuiltinTool) => void; dismiss: () => void; allBookmarkProfiles: boolean; setAllBookmarkProfiles: (enabled: boolean) => void; bookmarkSearches: Record<string, string>; rememberBookmarkSearch: (profileId: string, query: string) => void; bookmarkSelections: Record<string, string>; rememberBookmarkSelection: (profileId: string, bookmarkId: string) => void; acknowledgeDownload: (downloadId: string) => void; acknowledgedDownloads: Set<string> }

export let App = () => {
  let settingsMemory = useRef(new Map<string, { initial: unknown; value: unknown }>()).current, [state, setState] = useState<PublicState | null>(null)
  let [alertsCollapsed, setAlertsCollapsed] = useState(() => localStorage.getItem('agent-alerts-collapsed') === 'true')
  useAutomationExpiry(state?.automationSafety)
  useEffect(() => { localStorage.setItem('agent-alerts-collapsed', String(alertsCollapsed)) }, [alertsCollapsed])
  let [control, setControl] = useState<Control | null>(null), [initialPlugin, setInitialPlugin] = useState<BuiltinTool | null>(null)
  let [historyPopup, setHistoryPopup] = useState<HistoryPopup | null>(null), [bookmarkDestination, setBookmarkDestination] = useState<BookmarkDestination | null>(null)
  let [addressFocusVersion, setAddressFocusVersion] = useState(0), [addressSuggestionsVisible, setAddressSuggestionsVisible] = useState(false)
  let [message, setMessage] = useState(''), [agentDetails, setAgentDetails] = useState<AgentDetails>({ actors: [] })
  let [dismissedConfigError, setDismissedConfigError] = useState(''), [dismissedStartupNotice, setDismissedStartupNotice] = useState('')
  let { allBookmarkProfiles, setAllBookmarkProfiles, bookmarkSearches, rememberBookmarkSearch, bookmarkSelections, rememberBookmarkSelection, bookmarkViews, rememberBookmarkView } = useBookmarkMemory()
  let [acknowledgedDownloads, setAcknowledgedDownloads] = useState<Set<string>>(() => new Set())
  let { panelBack, location, setPanelHistory, sessionsBehind, closeToSessions } = usePanelHistory({ control, initialPlugin, bookmarkDestination, agentDetails }, parent => {
    setControl(parent.control); setInitialPlugin(parent.initialPlugin); setBookmarkDestination(parent.bookmarkDestination); setAgentDetails(parent.agentDetails); setMessage('')
  })
  let [settingsTarget, setSettingsTarget] = useState<'build' | null>(null)
  let previous = useRef('')
  let knownPanes = useRef<Set<string> | null>(null)
  let accept = useCallback((next: PublicState) => {
    let { client, tab, window } = selection(next)
    let target = `${client?.windowId}:${client?.paneId}:${tab?.id}`, removedWindow = !!previous.current && !next.model.sessions.some(session => session.windows.some(window => window.id === previous.current.split(':')[0]))
    if (previous.current && previous.current !== target) { setPanelHistory([]); setControl(current => current === 'sessions' && removedWindow ? current : null); setHistoryPopup(null); setMessage('') }
    let paneIds = next.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => pane.id)))
    if (!selection(next).session?.remote && client?.paneId && !window?.floating?.some(item => item.paneId === client.paneId) && client.id === next.focusedClientId && knownPanes.current && !knownPanes.current.has(client.paneId) && tab?.url === 'about:blank' && !tab.openerPaneId) {
      setControl(current => current === 'sessions' && removedWindow ? current : 'address')
      void bridge.command({ method: 'focus-ui', args: { client: client.id } }).catch(error => setMessage(String(error)))
    }
    knownPanes.current = new Set(paneIds)
    if (next.dialogPrompt) { setPanelHistory([]); setControl(null); setHistoryPopup(null) }
    previous.current = target; setState(next)
  }, [])
  let run = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    try { return await bridge.command({ method, args }) }
    catch (error) { setMessage((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); return undefined }
  }, [])
  let show = useCallback(async (control: Control, paneId?: string, destination?: BookmarkDestination, plugin?: BuiltinTool) => {
    let parent = location.current
    setInitialPlugin(plugin ?? null); setHistoryPopup(null)
    if (paneId) {
      let current = await bridge.state()
      if (selection(current).pane?.id !== paneId) {
        if (await run('select-pane', { client: current.clientId, pane: paneId, focus: false }) === undefined) return
        current = await bridge.state()
      }
      accept(current)
    }
    if (control === 'address') { void run('focus-ui', { pane: paneId }); setAddressFocusVersion(version => version + 1) }
    setPanelHistory(history => isPanel(parent.control) && isPanel(control) && parent.control !== control ? [...history, parent] : [])
    setBookmarkDestination(control === 'bookmark' ? destination ?? null : null); setMessage(''); setControl(control)
  }, [accept, run])
  let dismiss = useCallback(() => {
    if (state?.pluginPrompt) {
      void bridge.command({ method: 'plugin.respond', args: { id: state.pluginPrompt.id, cancel: true } }).catch(() => undefined)
      return
    }
    setPanelHistory([]); setControl(null); setHistoryPopup(null); setMessage('')
  }, [state?.pluginPrompt])
  let acknowledgeDownload = useCallback((downloadId: string) => setAcknowledgedDownloads(current => new Set(current).add(downloadId)), [])
  useEffect(() => {
    let unsubscribe = bridge.subscribe(accept)
    void bridge.state().then(accept).catch(error => setMessage(String(error)))
    let controls = bridge.controls((control, paneId) => {
      if (control === 'dismiss') { dismiss(); return }
      void bridge.state().then(next => { accept(next); if (control === 'agent-info' && paneId) setAgentDetails({ paneId }); if (control !== 'plugin-dialog') show(control as Control) })
    })
    return () => { unsubscribe(); controls() }
  }, [accept, show, dismiss])
  let management = control === 'rename-window' || control === 'rename-session' || control === 'move-window' || control === 'select-window' || control === 'close-pane' || control === 'close-window'
  let prompt = management || control === 'address' || control === 'command' || control === 'find'
  let panel = control && !prompt ? control : null
  let keepPages = panel === 'profiles' && !sessionsBehind && !state?.pluginPrompt
  useOverlayFocus(state, control, panel, historyPopup, addressSuggestionsVisible, keepPages, run)
  useControlDismiss(control, state?.pluginPrompt ? dismiss : panelBack?.run ?? dismiss, !!state?.dialogPrompt)
  useAddressTabSwitch(control, state?.clientId, run)
  useEffect(() => { if (!state?.configError) setDismissedConfigError('') }, [state?.configError])
  if (!state) return <div className={css.empty}>{message || 'Starting…'}</div>
  let { client, window } = selection(state)
  if (!client || !window) return <div className={css.empty}>Attaching…</div>
  let layout = client.zoomedPaneId && window.panes.some(pane => pane.id === client.zoomedPaneId) ? { kind: 'pane' as const, paneId: client.zoomedPaneId } : window.layout
  let agentAlerts = automationWarningNotices(state, run)
  let collapseAlerts = () => { setAlertsCollapsed(true); void run('focus-page', { client: state.clientId }) }
  let notices: Notification[] = [
    ...(!prompt && control !== 'address' && message ? [{ id: 'message', text: message, dismiss: () => setMessage('') }] : []),
    ...(state.configError && state.configError !== dismissedConfigError ? [{ id: 'config', text: state.configError, dismiss: () => setDismissedConfigError(state.configError!) }] : []),
    ...(state.startupNotice && state.startupNotice !== dismissedStartupNotice ? [{ id: 'startup', text: state.startupNotice, dismiss: () => setDismissedStartupNotice(state.startupNotice!) }] : []),
    ...permissionNotices(state, run), ...proxyFailureNotices(state, window, show, run), ...(!alertsCollapsed ? agentAlerts : []),
  ]
  let respondToDialog = (response: number) => run('dialog.respond', { id: state.dialogPrompt?.id, response })
  let context = { panelBack, settingsTarget, setSettingsTarget, agentDetails, setAgentDetails, initialPlugin, settingsMemory, state, control, historyPopup, setHistoryPopup, bookmarkDestination, addressFocusVersion, setAddressSuggestionsVisible, message, onMessage: setMessage, run, show, dismiss, allBookmarkProfiles, setAllBookmarkProfiles, bookmarkSearches, rememberBookmarkSearch, bookmarkSelections, rememberBookmarkSelection, bookmarkViews, rememberBookmarkView, acknowledgeDownload, acknowledgedDownloads }
  return <Context.Provider value={context}><div className={css.app} data-page-overlay={!!state.dialogPrompt || keepPages || undefined} data-status-bar={state.statusBar ?? 'top'}>
    <main className={css.workspace}>{layout ? <Branch node={layout} /> : !window.floating?.length && <EmptyWorkspace />}{!client.zoomedPaneId && window.floating?.map(item => <FloatingPreview key={item.paneId} paneId={item.paneId} />)}{panel === 'profiles' && !sessionsBehind && <Panel key={panel} type={panel} hidden={!!state.pluginPrompt} />}{control === 'command' && !client.zoomedPaneId && window.floating?.some(item => item.paneId === client.paneId) && <CommandPrompt key={`${client.windowId}:${client.paneId}`} />}</main>
    <BrowserStatus collapsedAlerts={alertsCollapsed ? agentAlerts : []} expandAlerts={() => setAlertsCollapsed(false)} />
    {notices.length > 0 && <Notifications notices={notices} collapseAlerts={collapseAlerts} />}
    {(panel === 'sessions' || sessionsBehind) && <Panel key="sessions" type="sessions" inactive={sessionsBehind} hidden={!!state.pluginPrompt} />}
    {panel && panel !== 'profiles' && panel !== 'sessions' && !sessionsBehind && <Panel key={panel} type={panel} hidden={!!state.pluginPrompt} />}
    {sessionsBehind && panel && <SecondaryPanel type={panel} closeToSessions={closeToSessions} hidden={!!state.pluginPrompt} />}
    {state.pluginPrompt && <Panel key={state.pluginPrompt.id} type="plugin-dialog" />}
    {state.dialogPrompt && <MessageDialog key={state.dialogPrompt.id} prompt={state.dialogPrompt} respond={respondToDialog} />}
  </div></Context.Provider>
}

let isPanel = (control: Control | null) => !!control && !['address', 'command', 'find', 'rename-window', 'rename-session', 'move-window', 'select-window', 'close-pane', 'close-window'].includes(control)

let usePanelHistory = (current: PanelLocation, restore: (parent: PanelLocation) => void) => {
  let [history, setPanelHistory] = useState<PanelLocation[]>([])
  let location = useRef(current), restoreLocation = useRef(restore)
  location.current = current; restoreLocation.current = restore
  let back = useCallback(() => {
    let parent = history.at(-1)
    if (!parent) return
    setPanelHistory(history => history.slice(0, -1)); restoreLocation.current(parent)
  }, [history])
  let panelBack = useMemo(() => history.length ? { label: 'Back', run: back } : null, [history.length, back])
  return { panelBack, location, setPanelHistory, sessionsBehind: history.some(parent => parent.control === 'sessions'), closeToSessions: history.at(-1)?.control === 'sessions' }
}

let useOverlayFocus = (state: PublicState | null, control: Control | null, panel: Control | null, historyPopup: HistoryPopup | null, addressSuggestionsVisible: boolean, keepPages: boolean, run: UIContext['run']) => {
  let previousControl = useRef<Control | null>(null), previousHistoryPopup = useRef(false), previousDialogPrompt = useRef(false), previousPluginPrompt = useRef(false)
  useEffect(() => {
    if (!state?.clientId) return
    let restoreFocus = previousDialogPrompt.current || previousPluginPrompt.current || previousHistoryPopup.current || ['command', 'agent-info', 'anti-bot-settings', 'adblock-popup', 'dark-mode-popup', 'plugins', 'site-info', 'sessions', 'bookmark', 'bookmarks', 'history', 'find', 'downloads', 'extensions', 'activity', 'profiles', 'proxy'].includes(previousControl.current ?? '')
    previousDialogPrompt.current = !!state.dialogPrompt; previousPluginPrompt.current = !!state.pluginPrompt
    previousControl.current = control
    previousHistoryPopup.current = !!historyPopup
    let cancelled = false
    // Child layout effects publish the selected page's bounds before it receives focus.
    void run('client.overlay', { client: state.clientId, visible: !!state.dialogPrompt || !!state.pluginPrompt || !!panel || control === 'command' || !!historyPopup || (control === 'address' && addressSuggestionsVisible), keepPages }).then(() => {
      if (!cancelled && !control && !state.dialogPrompt && !state.pluginPrompt && restoreFocus) void run('focus-page', { client: state.clientId })
    })
    return () => { cancelled = true }
  }, [panel, control, historyPopup, addressSuggestionsVisible, keepPages, state?.clientId, state?.dialogPrompt?.id, state?.pluginPrompt?.id, run])
}

let BrowserStatus = ({ collapsedAlerts, expandAlerts }: { collapsedAlerts: Notification[]; expandAlerts: () => void }) => {
  let { state, control, message } = useUI()
  let { client } = selection(state)
  if (!client) return null
  return <footer className={css.status} aria-label="Browser status">
    {control === 'rename-window' || control === 'rename-session' || control === 'move-window' || control === 'select-window' || control === 'close-pane' || control === 'close-window' ? <ManagementPrompt key={`${control}:${client.windowId}:${client.paneId}`} mode={control} message={message} /> : control === 'find' ? <FindPrompt key={`${client.windowId}:${client.paneId}`} /> : <Status />}
    {collapsedAlerts.length > 0 && <button type="button" className={css.agentAlertsButton} aria-label="Show agent alerts" aria-expanded="false" title={collapsedAlerts.map(notice => notice.text).join('\n')} onClick={expandAlerts}><AgentStatusIcon /><span>{collapsedAlerts.length} {collapsedAlerts.length === 1 ? 'alert' : 'alerts'}</span><AlertChevron collapsed /></button>}
    <BuildId />
  </footer>
}

let BuildId = () => {
  let { state, show, setSettingsTarget } = useUI()
  if (!state.showBuildId || !state.buildInfo) return null
  let { version, revision, builtAt } = state.buildInfo
  let date = builtAt.slice(2, 10).replaceAll('-', ''), time = builtAt.slice(11, 16).replace(':', '')
  let open = () => { setSettingsTarget('build'); show('settings') }
  return <button type="button" className={css.buildId} aria-label="Build information" title={`bmux ${version} · ${revision} · ${builtAt}`} onClick={open}>{date}.{time}</button>
}

let useControlDismiss = (control: Control | null, dismiss: () => void, blocked: boolean) => {
  useEffect(() => {
    if (control !== 'command') return
    let outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(`[aria-label="Command finder"], [aria-label="Command prompt"]`)) dismiss()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [control, dismiss])
  useEffect(() => {
    let escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !blocked) dismiss() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [dismiss, blocked])
}

let frameAssets = {
  ios: { image: iphoneFrame },
  pixel: { image: pixelFrame },
  galaxy: { image: galaxyFrame },
}
let frameAsset = (device: DevicePersona) => device.platform === 'ios' ? frameAssets.ios : device.preset === 'galaxy-s24' ? frameAssets.galaxy : frameAssets.pixel
let frameGeometry = (device: DevicePersona, screenSize: { width: number; height: number }) => {
  let screen = deviceFrameScreen(device)
  let portrait = device.orientation === 'portrait'
  let widthFactor = portrait ? 1024 / screen.width : 1536 / screen.height
  let heightFactor = portrait ? 1536 / screen.height : 1024 / screen.width
  return {
    width: screenSize.width * widthFactor,
    height: screenSize.height * heightFactor,
    screenLeft: screenSize.width * (portrait ? screen.x / screen.width : (1536 - screen.y - screen.height) / screen.height),
    screenTop: screenSize.height * (portrait ? screen.y / screen.height : screen.x / screen.width),
  }
}

let useAddressTabSwitch = (control: Control | null, clientId: string | undefined, run: UIContext['run']) => useEffect(() => {
  if (control !== 'address' || !clientId) return
  let switchWindow = (event: globalThis.KeyboardEvent) => {
    if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault(); event.stopPropagation()
    void run('cycle-window', { client: clientId, direction: event.shiftKey ? -1 : 1 })
  }
  document.addEventListener('keydown', switchWindow, true)
  return () => document.removeEventListener('keydown', switchWindow, true)
}, [control, clientId, run])

type BookmarkMemory = { allProfiles: boolean; searches: Record<string, string>; selections: Record<string, string>; views: Record<string, BookmarkView> }
let useBookmarkMemory = () => {
  let [memory, setMemory] = useState<BookmarkMemory>(() => {
    try {
      let saved = JSON.parse(localStorage.getItem('bookmark-view') ?? 'null')
      if (saved && typeof saved.allProfiles === 'boolean' && saved.searches && saved.selections && saved.views) return saved
    } catch { /* Ignore an unreadable saved view. */ }
    return { allProfiles: false, searches: {}, selections: {}, views: {} }
  })
  useEffect(() => { localStorage.setItem('bookmark-view', JSON.stringify(memory)) }, [memory])
  let setAllBookmarkProfiles = useCallback((allProfiles: boolean) => setMemory(current => ({ ...current, allProfiles })), [])
  let rememberBookmarkSearch = useCallback((profileId: string, query: string) => setMemory(current => ({ ...current, searches: { ...current.searches, [profileId]: query }, views: { ...current.views, [profileId]: { ...current.views[profileId], scroll: 0 } } })), [])
  let rememberBookmarkSelection = useCallback((profileId: string, bookmarkId: string) => setMemory(current => ({ ...current, selections: { ...current.selections, [profileId]: bookmarkId } })), [])
  let rememberBookmarkView = useCallback((profileId: string, view: BookmarkView) => setMemory(current => ({ ...current, views: { ...current.views, [profileId]: { ...current.views[profileId], ...view } } })), [])
  return { allBookmarkProfiles: memory.allProfiles, setAllBookmarkProfiles, bookmarkSearches: memory.searches, rememberBookmarkSearch, bookmarkSelections: memory.selections, rememberBookmarkSelection, bookmarkViews: memory.views, rememberBookmarkView }
}

// Keep unfinished settings in this renderer only, including proxy credentials.
let useSettingsState = <T,>(key: string, initial: T | (() => T), resetWhenSavedChanges = true) => {
  let { settingsMemory } = useUI()
  let baseline = useRef(typeof initial === 'function' ? (initial as () => T)() : initial)
  let [value, setValue] = useState<T>(() => {
    let remembered = settingsMemory.get(key)
    return remembered && (!resetWhenSavedChanges || Object.is(remembered.initial, baseline.current)) ? remembered.value as T : baseline.current
  })
  let current = useRef(value)
  let update = useCallback((next: T | ((current: T) => T)) => {
    let value = typeof next === 'function' ? (next as (current: T) => T)(current.current) : next
    current.current = value
    settingsMemory.set(key, { initial: baseline.current, value })
    setValue(value)
  }, [key, settingsMemory])
  return [value, update] as const
}

let proxyFailureNotices = (state: PublicState, window: InternalWindow, show: UIContext['show'], run: UIContext['run']): Notification[] => Object.entries(state.profileProxyFailures).flatMap(([profileId, failure]) => {
  let pane = window.panes.find(item => paneConnectionId(item) === profileId)
  if (!pane) return []
  let name = state.model.profiles.find(item => item.id === pane.profileId)?.name ?? profileId
  return [{ id: `proxy:${profileId}`, text: `Proxy for ${name} could not connect. Pages using it are paused. ${failure.error}`, actions: [{ label: failure.retrying ? 'Retrying…' : 'Retry', disabled: failure.retrying, run: () => { void run('profile.proxy.retry', { profile: profileId }) } }, { label: 'Proxy settings', run: () => { void show('proxy', pane.id) } }] }]
})

let permissionNotices = (state: PublicState, run: UIContext['run']): Notification[] => state.permissions.filter(request => !state.dismissedPermissions?.includes(request.id)).map(request => {
  let label = permissionPaneLabel(state.model, request.paneId) ?? request.paneId
  let selected = selection(state).pane?.id === request.paneId
  return { id: request.id, text: `${selected ? 'This pane' : label} requests ${request.permission} on ${request.origin}.`, actions: [
    ...(selected ? [] : [{ label: 'Go to pane', title: label, run: () => { void run('permission.visit', { id: request.id }) } }]),
    { label: 'Deny', run: () => { void run('permission.respond', { id: request.id, allow: false }) } },
    { label: 'Allow', run: () => { void run('permission.respond', { id: request.id, allow: true }) } },
  ], dismiss: () => { void run('permission.dismiss', { ids: [request.id] }) } }
})

let automationActors = (state: PublicState, usage: AutomationSafetyState['profiles'][number]) => {
  let panes = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes))
  return (usage.actors ?? []).flatMap(actor => {
    let pane = panes.find(pane => pane.id === actor.paneId && pane.profileId === usage.profileId)
    let hosts = actor.hosts?.filter(host => automationWarningEnabled(state.automationSafety!.limits, usage.profileId, host, Date.now(), actor.paneId))
    return pane && automationWebsiteHost(pane.url) && automationSafetyEnabled(state.automationSafety!.limits, usage.profileId, pane.id) && (!actor.hosts?.length || hosts?.length) ? [{ ...actor, hosts, pane }] : []
  })
}

let automationNoticePanes = (state: PublicState, usage: AutomationSafetyState['profiles'][number]) => state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).filter(pane => pane.profileId === usage.profileId && automationSiteEnabled(state.automationSafety!.limits, usage.profileId, pane.url, Date.now(), pane.id) && (!usage.siteHost || automationWarningEnabled(state.automationSafety!.limits, usage.profileId, usage.siteHost, Date.now(), pane.id)))

let automationProfilePauses = (state: PublicState, profileId: string) => (state.automationSafety?.profiles ?? []).filter(usage => {
  if (usage.profileId !== profileId || !usage.warning && (!usage.retryAfter || Date.parse(usage.retryAfter) <= Date.now())) return false
  let host = usage.warningHost ?? usage.siteHost
  return !host || automationWarningEnabled(state.automationSafety!.limits, profileId, host) || state.model.sessions.some(session => session.windows.some(window => window.panes.some(pane => pane.profileId === profileId && automationWarningEnabled(state.automationSafety!.limits, profileId, host, Date.now(), pane.id))))
})

let automationWarningLabels = { 'account-warning': 'Account warning', challenge: 'Verification required', 'rate-limit': 'Site rate limit' }

let resumeAutomation = async (state: PublicState, run: UIContext['run'], paneId: string) => {
  if (selection(state).pane?.id !== paneId && !await run('select-pane', { client: state.clientId, pane: paneId })) return
  await run('automation.resume', { pane: paneId })
}

let automationWarningNotices = (state: PublicState, run: UIContext['run']): Notification[] => (state.automationSafety?.profiles ?? []).flatMap<Notification>(usage => {
  let limits = state.automationSafety!.limits, host = usage.warningHost
  let actors = automationActors(state, usage)
  let eligiblePanes = automationNoticePanes(state, usage)
  if (!eligiblePanes.length) return []
  let profile = state.model.profiles.find(item => item.id === usage.profileId)
  let selectedPane = selection(state).pane
  let paneLinks = (host?: string) => actors.filter(actor => actor.paneId !== selectedPane?.id && (!host || actor.hosts?.includes(host))).map(actor => {
    let label = permissionPaneLabel(state.model, actor.paneId) ?? actor.paneId
    return { label, title: `Go to pane ${label}${actor.agentId ? ` (${actor.agentId})` : ''}`, run: () => { void run('select-pane', { client: state.clientId, pane: actor.paneId }) } }
  })
  let name = profile?.name ?? usage.profileId
  let warningEnabled = host && eligiblePanes.some(pane => automationWarningEnabled(limits, usage.profileId, host, Date.now(), pane.id))
  if (usage.warning && host && warningEnabled) {
    let affectedPane = eligiblePanes.find(pane => automationWebsiteHost(pane.url)?.replace(/^www\./, '') === host.replace(/^www\./, ''))
    return [{ id: `${usage.profileId}:${host}:${usage.warning}`, profileId: usage.profileId, warning: usage.warning, agents: actors.filter(actor => !actor.hosts?.length || actor.hosts.includes(host)), siteExclusion: { profileId: usage.profileId, host }, text: `${name} · ${automationWarningLabels[usage.warning]}`, detectedAt: usage.warningAt, actions: affectedPane ? [{ label: 'Resume automation', title: 'Check the website again and resume if the warning has cleared', run: () => { void resumeAutomation(state, run, affectedPane.id) } }] : [], paneLinks: paneLinks(host) }]
  }
  if (!usage.retryAfter || Date.parse(usage.retryAfter) <= Date.now()) return []
  let retryAfter = usage.retryAfter
  // Current tab URLs may come from manual browsing after automation stopped.
  let siteHosts = usage.siteHost ? [usage.siteHost] : [...new Set(actors.flatMap(actor => actor.hosts ?? []))]
  return (siteHosts.length ? siteHosts : [undefined]).map(siteHost => ({ id: `${usage.profileId}:${usage.siteHost ?? ''}:session:${usage.retryAfter}`, profileId: usage.profileId, agents: actors.filter(actor => !siteHost || actor.hosts?.includes(siteHost)), ...(siteHost ? { siteExclusion: { profileId: usage.profileId, host: siteHost } } : {}), text: `${name} · Session limit`, cooldown: { retryAfter, minutes: automationProfileLimits(limits, usage.profileId).cooldownMinutes }, paneLinks: paneLinks(siteHost) }))
})

let profileDeviceLabel = (pane: { device?: { preset: DevicePreset; platform: DevicePlatform } }) => !pane.device ? 'desktop' : ({ 'pixel-8': 'Pixel 8', 'galaxy-s24': 'Galaxy S24', 'iphone-15-pro': 'iPhone 15 Pro', 'iphone-15-pro-max': 'iPhone 15 Pro Max', custom: pane.device.platform === 'android' ? 'Android' : 'iOS' })[pane.device.preset]

let ProfileAvatar = ({ id, name }: { id: string; name: string }) => {
  let hash = profileHash(id), background = profileColor(id), foreground = PROFILE_COLORS[(hash >>> 5) % PROFILE_COLORS.length]
  let left = 3 + (hash % 5), top = 3 + ((hash >>> 3) % 5), radius = 4 + ((hash >>> 6) % 3)
  return <svg className={css.profileAvatar} viewBox="0 0 20 20" aria-hidden="true" data-profile-avatar={id}>
    <rect width="20" height="20" fill={background} />
    <circle cx={left} cy={top} r={radius} fill={foreground} opacity=".9" />
    <path d={`M0 ${12 + (hash % 4)} Q${8 + (hash % 5)} ${5 + ((hash >>> 8) % 5)} 20 ${11 + ((hash >>> 11) % 5)} V20 H0Z`} fill="#17202a" opacity=".45" />
    <text x="10" y="14" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700" fontFamily="ui-monospace, monospace">{name.trim().charAt(0).toUpperCase()}</text>
  </svg>
}

let ProfileDeviceIcon = () => <svg className={css.profileRouteIcon} viewBox="0 0 18 18" aria-hidden="true" data-profile-route-icon="device"><rect x="5" y="1.5" width="8" height="15" rx="1" /><path d="M8 14h2" /></svg>

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

let CooldownTimer = ({ retryAfter, minutes }: { retryAfter: string; minutes: number }) => {
  let [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  let remaining = Math.max(0, Math.ceil((Date.parse(retryAfter) - now) / 1000))
  let progress = Math.min(1, remaining / (minutes * 60))
  let countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  let resetTime = new Date(retryAfter).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  let details = `Automation resumes at ${new Date(retryAfter).toLocaleString()}. ${countdown} remaining in the ${minutes}-minute break.`
  return <div className={css.cooldownTimer} role="timer" aria-label={details} title={details} tabIndex={0}>
    <div className={css.cooldownDial}>
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle className={css.cooldownTrack} cx="18" cy="18" r="16" /><circle cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${progress * 100} 100`} transform="rotate(-90 18 18)" /></svg>
    </div>
    <div className={css.cooldownText}><span>{countdown}</span><time dateTime={retryAfter}>Reset {resetTime}</time></div>
  </div>
}

let BmuxIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true" data-bmux-icon="lantern"><path d="M7 6V4a3 3 0 0 1 6 0v2M4 8l3-3h6l3 3H4Zm2 0L5 18h10L14 8M10 8v10m0-6h4" /></svg>

let NotificationIdentifier = ({ value, title = value }: { value: string; title?: string }) => {
  let location = /^(.*)( · %\d+)$/.exec(value)
  return <span className={css.notificationSegmentLabel} title={title}>{location ? <><span className={css.notificationLocation}>{location[1]}</span><span className={css.notificationPaneId}>{location[2]}</span></> : value}</span>
}

let NotificationPaneLink = ({ label, title, run }: NonNullable<Notification['paneLinks']>[number]) => <button type="button" className={css.notificationSegments} title={title} aria-label={title} onClick={run}>
  <span className={css.notificationSegmentIcon}><BmuxIcon /></span>
  <NotificationIdentifier value={label} />
  <span className={css.notificationSegmentIcon}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7 9M6 3H2v11h11v-4" /></svg></span>
</button>

let AlertChevron = ({ collapsed = false }: { collapsed?: boolean }) => <svg className={css.alertChevron} viewBox="0 0 16 16" aria-hidden="true"><path d={collapsed ? 'm4 6 4 4 4-4' : 'm4 10 4-4 4 4'} /></svg>
let AutomationPause = ({ detectedAt }: { detectedAt?: number }) => <span className={css.notificationPause} role="group" aria-label="Automation paused" title={detectedAt === undefined ? 'Automation paused' : `Automation paused · Detected ${new Date(detectedAt).toLocaleString()}`}>
  <svg viewBox="0 0 20 20" aria-hidden="true" data-automation-paused><circle cx="10" cy="10" r="8" /><path d="M8 6v8m4-8v8" /></svg>
  {detectedAt !== undefined && <time dateTime={new Date(detectedAt).toISOString()} aria-label={`Detected ${new Date(detectedAt).toLocaleString()}`}>{new Date(detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time>}
</span>
let AgentStatusIcon = ({ locked = false }: { locked?: boolean }) => <svg className={css.statusIcon} viewBox="0 0 20 20" aria-hidden="true">{locked ? <><rect x="4" y="8" width="12" height="9" rx="1" /><path d="M6 8V6a4 4 0 0 1 8 0v2" /></> : <><rect x="3" y="6" width="14" height="11" rx="2" /><path d="M10 2v4M7 10v2m6-2v2M7 15h6M1 10v4m18-4v4" /></>}</svg>

let AgentInteractionTime = ({ when, compact = false, now }: { when: number; compact?: boolean; now?: number }) => <time className={compact ? css.windowActivity : undefined} data-age={compact ? activityAge(when, now) : undefined} dateTime={new Date(when).toISOString()} title={`Last agent interaction ${new Date(when).toLocaleString()}`}>{compact ? compactActivityLabel(when, now) : new Date(when).toLocaleString()}</time>
let AgentInteractionField = ({ actor }: { actor: AutomationActor }) => 'lastUsed' in actor && typeof actor.lastUsed === 'number' ? <><dt>Last interaction</dt><dd><AgentInteractionTime when={actor.lastUsed} /></dd></> : null

let AgentButton = ({ agents, paneId, active = true, lastUsed }: { agents: AutomationActor[]; paneId?: string; active?: boolean; lastUsed?: number }) => {
  let { state, show, setAgentDetails } = useUI()
  let [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!paneId || lastUsed === undefined) return
    let timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [paneId, lastUsed])
  let open = () => { setAgentDetails(paneId ? { paneId } : { actors: agents }); show('agent-info') }
  let actor = agents[0]
  let label = paneId ? active ? 'Active agent' : 'Last agent' : 'Agent information'
  let locked = !!paneId && state.lockedAgentPanes?.includes(paneId)
  let title = paneId ? `${locked ? 'Agent controlling · page input locked · ' : active ? '' : 'Last agent · '}${actor.agentName ?? actor.agentId ?? 'Unidentified agent'}${actor.agentName && actor.agentId ? ` (${actor.agentId})` : ''}` : label
  let definition = actor.agentType ? state.automationAgents?.definitions[actor.agentType] : undefined
  let agentPaneId = actor.agentData?.paneId ?? actor.agentOrigin?.paneId
  let identifier = agentPaneId ? { label: 'Pane ID', value: agentPaneId } : agentIdentifier(actor, definition)
  return <button type="button" className={paneId ? `${css.navigationButton} ${css.paneAgentButton}` : undefined} aria-label={label} title={title} onClick={open}><AgentStatusIcon locked={locked} />{paneId && <><span className={css.paneAgentId} title={`${identifier.label}: ${identifier.value}`}>{identifier.value}</span>{lastUsed !== undefined && <AgentInteractionTime when={lastUsed} compact now={now} />}</>}</button>
}

let PaneAgentButton = ({ paneId }: { paneId: string }) => {
  let { state } = useUI()
  let pane = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === paneId)
  let actor = pane && lastPaneAgent(pane, state.activeAgents)
  return actor ? <AgentButton agents={[actor]} paneId={paneId} active={actor.active} lastUsed={actor.lastUsed} /> : null
}

let NotificationAgent = ({ actor }: { actor: AutomationActor }) => {
  let { state, run } = useUI()
  let [focusing, setFocusing] = useState(false)
  let definition = actor.agentType ? state.automationAgents?.definitions[actor.agentType] : undefined
  let identifier = agentIdentifier(actor, definition)
  let focus = async () => {
    setFocusing(true)
    try { await run('agent.focus', { pane: actor.paneId, agentId: actor.agentId, agentOrigin: actor.agentOrigin }) } finally { setFocusing(false) }
  }
  return <span className={css.notificationSegments} role="group" aria-label={`Agent ${identifier.value}`}>
    <AgentButton agents={[actor]} />
    <NotificationIdentifier value={identifier.value} title={`${identifier.label}: ${identifier.value}`} />
    {definition?.focusCommand && <button type="button" aria-label="Focus agent" title={`Focus agent ${identifier.value}`} disabled={focusing} onClick={() => { void focus() }}><FocusAgentIcon /></button>}
  </span>
}

let Notifications = ({ notices, collapseAlerts }: { notices: Notification[]; collapseAlerts: () => void }) => {
  let { state, run, show } = useUI()
  let [resetting, setResetting] = useState(false)
  let automation = notices.filter(notice => notice.profileId)
  let openSettings = () => show('anti-bot-settings')
  let resetAll = async () => {
    setResetting(true)
    try { await run('automation.reset-all-sessions') } finally { setResetting(false) }
  }
  return <div className={css.notifications} aria-label="Notifications">
    {notices.map(notice => <div key={`${notice.id}:${notice.siteExclusion?.host ?? ''}`} className={css.notification} role="status" data-agent-alert={notice.profileId ? true : undefined}>
      {notice.warning && <AutomationPause detectedAt={notice.detectedAt} />}
      {notice.cooldown && <CooldownTimer {...notice.cooldown} />}
      {notice.siteExclusion && <AutomationWebsiteSelect {...notice.siteExclusion} resetSession={!!notice.cooldown} />}
      <span className={css.notificationText}>{notice.text}</span>
      {notice.actions?.map(action => <button type="button" key={action.label} className={css.notificationAction} title={action.title} disabled={action.disabled} onClick={action.run}>{action.label}</button>)}
      {notice.agents?.map(actor => <NotificationAgent key={`${actor.paneId}:${actor.agentId}`} actor={actor} />)}
      {notice.paneLinks?.map(link => <NotificationPaneLink key={link.title} {...link} />)}
      {notice.dismiss && <button type="button" onClick={notice.dismiss} aria-label="Dismiss notification" title="Dismiss notification"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>}
    </div>)}
    {automation.length > 0 && <div className={`${css.notification} ${css.notificationGeneral}`} role="group" aria-label="Bot settings">
      <span className={css.notificationText}>Bots · all agents and profiles</span>
      {state.automationSafety?.profiles.some(profile => profile.retryAfter) && <button type="button" className={css.notificationAction} disabled={resetting} onClick={resetAll}>Reset all bot sessions</button>}
      <button type="button" className={css.notificationSettings} onClick={openSettings} aria-label="Bot settings" title="Bot settings"><SettingsIcon /></button>
      <button type="button" onClick={collapseAlerts} aria-label="Collapse agent alerts" title="Collapse agent alerts to status bar"><AlertChevron /></button>
    </div>}
  </div>
}

let useWindowDrag = () => {
  let { state, run } = useUI()
  let { session } = selection(state)
  let windows = useRef<HTMLDivElement>(null)
  let draggedWindow = useRef<string | null>(null)
  let grabOffset = useRef(0)
  let committingWindowDrag = useRef(false)
  let pendingDrop = useRef<{ order: string[]; lefts: Map<string, number>; released: { id: string; left: number } } | null>(null)
  let [drop, setDrop] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  let windowBounds = (tab: HTMLElement) => {
    let bounds = tab.getBoundingClientRect()
    let transform = getComputedStyle(tab).transform
    let left = bounds.left - (transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41)
    return { left, width: bounds.width }
  }
  let dropAt = (event: DragEvent<HTMLDivElement>) => {
    let tabs = Array.from(windows.current?.querySelectorAll<HTMLElement>('[data-window-id]') ?? [])
    // Hit-test the original slots so animated tabs cannot move the drop target under the pointer.
    let tab = tabs.find(tab => { let bounds = windowBounds(tab); return event.clientX < bounds.left + bounds.width }) ?? tabs.at(-1)
    if (!tab) return null
    let bounds = windowBounds(tab)
    let sourceIndex = tabs.findIndex(tab => tab.dataset.windowId === draggedWindow.current)
    let threshold = tabs.indexOf(tab) > sourceIndex ? .25 : .75
    return { id: tab.dataset.windowId!, position: event.clientX < bounds.left + bounds.width * threshold ? 'before' as const : 'after' as const }
  }
  useLayoutEffect(() => {
    let list = windows.current
    if (!list) return
    let tabs = Array.from(list.querySelectorAll<HTMLElement>('[data-window-id]'))
    let pending = pendingDrop.current
    if (pending && tabs.every((tab, index) => tab.dataset.windowId === pending.order[index]) && tabs.length === pending.order.length) {
      let offsets = tabs.map(tab => {
        let transform = getComputedStyle(tab).transform
        let offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41
        let left = tab.dataset.windowId === pending.released.id ? pending.released.left : pending.lefts.get(tab.dataset.windowId!)! + offset
        return { tab, offset: left - windowBounds(tab).left }
      })
      committingWindowDrag.current = false; pendingDrop.current = null
      finishWindowDrag()
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for (let { tab, offset } of offsets) {
        if (Math.abs(offset) > .5) tab.animate([{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0px)' }], { duration: 160, easing: 'ease' })
      }
      return
    }
    let source = tabs.find(tab => tab.dataset.windowId === draggedWindow.current)
    let target = tabs.find(tab => tab.dataset.windowId === drop?.id)
    let bounds = new Map(tabs.map(tab => [tab, windowBounds(tab)]))
    let preview = tabs.filter(tab => tab !== source)
    if (source && target && source !== target) preview.splice(preview.indexOf(target) + (drop?.position === 'after' ? 1 : 0), 0, source)
    else preview = tabs
    let left = bounds.get(tabs[0])?.left ?? 0
    let gap = parseFloat(getComputedStyle(list).columnGap) || 0
    for (let tab of preview) {
      let original = bounds.get(tab)!
      tab.style.setProperty('--tab-drag-offset', `${left - original.left}px`)
      left += original.width + gap
    }
  }, [drop, session?.windows])
  let startWindowDrag = (event: DragEvent<HTMLDivElement>) => {
    if (committingWindowDrag.current) { event.preventDefault(); return }
    let button = (event.target as HTMLElement).closest<HTMLElement>(`.${css.windowSelect}`)
    let id = button?.closest<HTMLElement>('[data-window-id]')?.dataset.windowId
    if (!id) return
    windows.current!.getAnimations({ subtree: true }).forEach(animation => animation.cancel())
    grabOffset.current = event.clientX - button!.closest<HTMLElement>('[data-window-id]')!.getBoundingClientRect().left
    draggedWindow.current = id
    windows.current!.dataset.dragging = id
    button!.closest<HTMLElement>('[data-window-id]')!.dataset.dragging = 'true'
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  let overWindow = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedWindow.current || committingWindowDrag.current) return
    let target = dropAt(event)
    if (!target) { setDrop(null); return }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (target.id === draggedWindow.current) { setDrop(null); return }
    setDrop(current => current?.id === target.id && current.position === target.position ? current : target)
  }
  let finishWindowDrag = () => {
    if (committingWindowDrag.current) return
    draggedWindow.current = null; setDrop(null)
    pendingDrop.current = null
    delete windows.current?.dataset.dragging
    windows.current?.querySelectorAll<HTMLElement>('[data-window-id]').forEach(tab => { delete tab.dataset.dragging; tab.style.removeProperty('--tab-drag-offset') })
  }
  let dropWindow = async (event: DragEvent<HTMLDivElement>) => {
    if (committingWindowDrag.current) return
    let source = draggedWindow.current, target = dropAt(event)
    if (!source || !target) { finishWindowDrag(); return }
    event.preventDefault()
    let tabs = Array.from(windows.current!.querySelectorAll<HTMLElement>('[data-window-id]'))
    let order = tabs.map(tab => tab.dataset.windowId!)
    if (source !== target.id) { order = order.filter(id => id !== source); order.splice(order.indexOf(target.id) + (target.position === 'after' ? 1 : 0), 0, source) }
    let pinned = new Set(session!.windows.filter(window => window.pinned).map(window => window.id))
    order.sort((first, second) => Number(pinned.has(second)) - Number(pinned.has(first)))
    pendingDrop.current = { order, lefts: new Map(tabs.map(tab => [tab.dataset.windowId!, windowBounds(tab).left])), released: { id: source, left: event.clientX - grabOffset.current } }
    committingWindowDrag.current = true
    setDrop(target)
    let result = await run('reorder-window', { client: state.clientId, window: source, target: target.id, position: target.position })
    if (result === undefined) { committingWindowDrag.current = false; finishWindowDrag() }
  }
  return { windows, startWindowDrag, overWindow, dropWindow, finishWindowDrag }
}

let Status = () => <SessionStatus />
let SessionStatus = () => {
  let { state, show, run, control, dismiss, acknowledgedDownloads } = useUI()
  let [now, setNow] = useState(Date.now)
  useEffect(() => { let timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  let { client, session, profile } = selection(state)
  let { windows, startWindowDrag, overWindow, dropWindow, finishWindowDrag } = useWindowDrag()
  let sessions = () => show('sessions')
  let help = () => show('help')
  let commands = () => control === 'command' ? dismiss() : show('command')
  let activity = () => show('activity')
  let downloads = () => show('downloads')
  let newTab = () => { void run('new-window', { session: session!.id, client: state.clientId }) }
  let unhandledDownloads = session?.remote ? [] : state.downloads.filter(item => item.profileId === profile?.id && !acknowledgedDownloads.has(item.id))
  let progressingDownloads = unhandledDownloads.filter(item => item.active && item.state === 'progressing' && !item.paused)
  let progressTotal = progressingDownloads.reduce((total, item) => total + item.total, 0)
  let downloadProgress = progressingDownloads.length > 0 && progressingDownloads.every(item => item.total > 0)
    ? Math.min(100, Math.floor(progressingDownloads.reduce((received, item) => received + item.received, 0) / progressTotal * 100))
    : undefined
  let downloadTitle = progressingDownloads.length
    ? `${progressingDownloads.length} download${progressingDownloads.length === 1 ? '' : 's'} in progress${downloadProgress === undefined ? '' : ` · ${downloadProgress}%`}`
    : 'Downloads'
  useLayoutEffect(() => {
    let list = windows.current
    if (!list) return
    let reveal = () => {
      let tabs = Array.from(list.querySelectorAll<HTMLElement>('[data-window-id]'))
      let widths = tabs.map(tab => {
        if (tab.dataset.pinned === 'true') return tab.getBoundingClientRect().width
        let range = document.createRange()
        range.selectNodeContents(tab.querySelector(`.${css.windowLabel}`)!)
        let activity = tab.querySelector('time')
        tab.style.setProperty('--window-activity-width', `${activity ? activity.getBoundingClientRect().width + 5 : 0}px`)
        return range.getBoundingClientRect().width + parseFloat(getComputedStyle(tab).minWidth)
      })
      let automaticWidth = Math.max(0, ...widths.filter((_, index) => tabs[index].dataset.automatic === 'true'))
      list.style.setProperty('--automatic-tab-width', `${automaticWidth}px`)
      list.dataset.compressed = String(widths.reduce((total, width) => total + width, 0) + Math.max(0, tabs.length - 1) * 3 > list.clientWidth)
      let active = list.querySelector<HTMLElement>('[data-selected="true"]')
      if (!active) return
      let item = active.getBoundingClientRect(), bounds = list.getBoundingClientRect()
      if (item.left < bounds.left) list.scrollLeft = Math.max(0, list.scrollLeft - (bounds.left - item.left) - 1)
      else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right + 1
    }
    let observer = new ResizeObserver(reveal)
    observer.observe(list); reveal()
    return () => observer.disconnect()
  }, [client?.windowId, session?.windows, now])
  let reclaim = () => { void run('remote.reclaim') }
  return <><button onClick={sessions} aria-label="Sessions" title={session!.name} className={css.session}><span>{session!.name}</span>{session!.private && <PrivateIcon />}</button>
    <div ref={windows} className={css.windows} data-window-list onDragStart={startWindowDrag} onDragOver={overWindow} onDrop={dropWindow} onDragEnd={finishWindowDrag}>{session!.windows.map((window, index) => <StatusWindow key={window.id} window={window} index={window.number ?? index + 1} active={window.id === client!.windowId} now={now} />)}</div>
    <button type="button" onClick={newTab} className={css.newTab} disabled={!!session?.remote} aria-label="New tab" title="New tab"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" /></svg></button>
    <span className={css.drag} />
    {state.remoteControl?.[session!.id] && <button onClick={reclaim}>Reclaim control</button>}
    {state.permissions.length > 0 && <button onClick={activity} aria-label="Activity">permission:{state.permissions.length}</button>}
    {unhandledDownloads.length > 0 && <button onClick={downloads} aria-label="Downloads" title={downloadTitle} className={css.downloadButton}><DownloadStatusIcon progressing={progressingDownloads.length > 0} progress={downloadProgress} />{progressingDownloads.length > 1 && <span className={css.downloadCount}>{progressingDownloads.length}</span>}</button>}
    <button onClick={commands} aria-label="Command prompt" aria-expanded={control === 'command'}>:</button><button onClick={help} aria-label="Help" title="Ctrl+B then ?">?</button>
  </>
}
let PageIcon = ({ paneId }: { paneId?: string }) => {
  let { state } = useUI()
  if (paneId && state.loading[paneId]) return <span className={css.tabSpinner} aria-hidden="true" data-tab-loading />
  if (paneId && state.favicons[paneId]) return <img className={css.tabFavicon} src={state.favicons[paneId]} alt="" />
  return <svg className={css.tabPlaceholder} viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><ellipse cx="8" cy="8" rx="2.5" ry="6" /><path d="M2 8h12" /></svg>
}
let WindowLockIcon = () => <svg className={css.windowLock} viewBox="0 0 16 16" role="img" aria-label="Locked"><rect x="3" y="7" width="10" height="7" rx="1" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
let ViewportLockIcon = () => <svg className={css.windowLock} viewBox="0 0 16 16" role="img" aria-label="Viewport locked"><path d="M1.5 5.5v-4h4m5 0h4v4m0 5v4h-4m-5 0h-4v-4M5 5h6v6H5z" /></svg>
let WindowIcons = ({ window, paneId }: { window: InternalWindow; paneId?: string }) => <>{!window.locked && !window.lockedViewports && <PageIcon paneId={paneId} />}{window.locked && <WindowLockIcon />}{window.lockedViewports && <ViewportLockIcon />}</>
let StatusWindow = ({ window, index, active, now }: { window: InternalWindow; index: number; active: boolean; now: number }) => {
  let { state, run } = useUI()
  let client = state.model.clients.find(client => client.id === state.clientId)
  let remote = !!selection(state).session?.remote
  let pane = window.panes.find(pane => active && pane.id === client?.paneId) ?? window.panes[0]
  let tabId = pane?.id
  let characters = Array.from(window.name)
  let name = window.automaticName && characters.length > 18 ? `${characters.slice(0, 17).join('')}…` : window.name
  let label = `${index}:${name}${active ? '*' : ''}`
  let visitedAt = windowActivityTime(window)
  let playing = window.panes.filter(pane => state.audio[pane.id]?.playing)
  let muted = playing.length > 0 && playing.every(pane => state.audio[pane.id].muted)
  let tooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  let hideTooltip = () => {
    clearTimeout(tooltipTimer.current)
    tooltipTimer.current = undefined
    void run('client.tooltip', { visible: false, window: window.id })
  }
  let showTooltip = (event: MouseEvent<HTMLButtonElement>) => {
    clearTimeout(tooltipTimer.current)
    let button = event.currentTarget, bounds = button.getBoundingClientRect()
    let canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
    context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
    let width = Math.ceil(context.measureText(window.name).width) + 18
    let y = state.statusBar === 'bottom' ? bounds.top - 30 : bounds.bottom + 2
    tooltipTimer.current = setTimeout(() => { void run('client.tooltip', { visible: true, window: window.id, x: bounds.left, y, width }) }, 250)
  }
  useEffect(() => () => { clearTimeout(tooltipTimer.current); void run('client.tooltip', { visible: false, window: window.id }) }, [run, window.id])
  let select = () => { hideTooltip(); void run('select-window', { client: state.clientId, window: window.id }) }
  let toggleAudio = () => { void run('window.audio.toggle', { window: window.id }) }
  let close = () => { void run('kill-window', { window: window.id, confirm: true }) }
  let menu = (event: MouseEvent<HTMLElement>) => { event.preventDefault(); if (!remote) void run('window.menu', { window: window.id }) }
  return <span className={css.windowTab} data-window-id={window.id} data-pinned={window.pinned === true} data-locked={window.locked === true} data-viewport-locked={!!window.lockedViewports} data-automatic={window.automaticName === true && !window.pinned} data-selected={active} title={window.name} onContextMenu={menu}>
    <button onClick={select} onMouseEnter={showTooltip} onMouseLeave={hideTooltip} onDragStart={hideTooltip} className={css.windowSelect} data-active={active} aria-pressed={active} aria-label={window.pinned ? window.name : label} title={window.name} draggable={!remote}>
      <WindowIcons window={window} paneId={tabId} />
      {!window.pinned && <span className={css.windowLabel}>{label}</span>}
      {!window.pinned && visitedAt && <time className={css.windowActivity} data-age={activityAge(visitedAt, now)} dateTime={new Date(visitedAt).toISOString()} title={`Last activity ${new Date(visitedAt).toLocaleString()}`}>{compactActivityLabel(visitedAt, now)}</time>}
    </button>
    {playing.length > 0 && <button type="button" onClick={toggleAudio} className={css.windowAudio} aria-label={`${muted ? 'Unmute' : 'Mute'} window ${window.name}`} title={`${muted ? 'Unmute' : 'Mute'} window ${window.name}`} data-muted={muted}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" />{muted ? <path d="m11 6 4 4m0-4-4 4" /> : <path d="M11 5c1.5 1 1.5 5 0 6m2-8c3 2 3 8 0 10" />}</svg></button>}
    {!window.pinned && state.showTabCloseButtons === true && <button onClick={close} disabled={remote || window.locked} className={css.windowClose} aria-label={`Close ${window.name}`} title={window.locked ? 'Unlock window to close' : `Close ${window.name}`}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>}
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
  let entries = commandEntries(state.keyboard ?? DEFAULT_KEYBOARD, state.plugins).filter(entry => !selection(state).session?.remote || !remoteWorkspaceShortcut(entry.action ?? entry.command.trim().split(' ')[0]))
  let literal = literalCommand(text), argumentsStarted = literal && /\S\s/.test(text.trimStart())
  let targets = commandTargetSuggestions(text, state)
  let query = targets?.query ?? (argumentsStarted ? text.trim().split(/\s+/)[0] : text)
  let results = (targets?.entries ?? searchCommands(entries, query, commandHistory)).slice(0, 80)
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
  return <section className={css.commandFinder} aria-label="Command finder"><form className={css.prompt} onSubmit={submit}><label htmlFor="command">:</label><input id="command" ref={input} aria-label="Command" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant={active ? `command-result-${results.indexOf(active)}` : undefined} value={text} onChange={change} onKeyDown={keys} autoComplete="off" spellCheck={false} readOnly={busy} /><span className={message ? css.error : undefined} role="status">{message || (busy ? 'running…' : 'esc')}</span><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
    <div className={css.finderHint}>Type to find · ↑/↓ or Ctrl+P/N select · Tab complete · Enter {argumentsStarted && !selected ? 'run typed command' : 'open / run'} · Ctrl+R history</div>
      <div ref={list} id="command-results" role="listbox" aria-label={targets ? 'Targets' : 'Commands'} className={css.commandResults}>{results.map((entry, position) => <CommandOption key={entry.command} entry={entry} position={position} active={entry === active} query={query} busy={busy} choose={choose} />)}</div>
      {!results.length && <p className={css.finderHint}>No matching {targets ? 'targets' : 'commands'}. Enter runs the text you typed.</p>}
    </section>
}

let useAddressSuggestionPosition = (form: RefObject<HTMLFormElement | null>, list: RefObject<HTMLDivElement | null>, visible: boolean, statusBar?: string) => {
  useLayoutEffect(() => {
    if (!visible || !form.current || !list.current) return
    let bar = form.current.closest('[aria-label="Pane address"]')
    let pane = bar?.parentElement
    let position = () => {
      if (!bar || !pane || !list.current) return
      let bounds = bar.getBoundingClientRect()
      let available = pane.getBoundingClientRect().bottom - bounds.bottom
      list.current.style.top = `${bounds.bottom}px`
      list.current.style.left = `${bounds.left}px`
      list.current.style.width = `${bounds.width}px`
      list.current.style.maxHeight = `${Math.max(0, available * .9)}px`
    }
    position()
    let observer = new ResizeObserver(position)
    if (pane) observer.observe(pane)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [form, list, visible, statusBar])
}

let useAddressFocus = (ref: RefObject<HTMLInputElement | null>, focusVersion: number, takeSelection: () => AddressSelection | undefined, vimEnabled: boolean) => {
  useEffect(() => {
    let input = ref.current
    if (!input) return
    input.focus()
    let selection = takeSelection()
    if (selection) input.setSelectionRange(selection.start, selection.end, selection.direction)
    else if (vimEnabled) input.setSelectionRange(0, 0)
    else input.select()
  }, [focusVersion, ref, takeSelection, vimEnabled])
}

let useAddressSelectionFocus = () => {
  let { run } = useUI()
  let source = useRef<HTMLInputElement | undefined>(undefined)
  let original = useRef<AddressSelection | undefined>(undefined)
  let dragging = useRef(false)
  let start = (event: PointerEvent<HTMLInputElement>) => {
    if (event.button !== 0) return
    let input = event.currentTarget
    source.current = input
    dragging.current = false
    original.current = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? 'none' }
    captureAddressPointer(event)
  }
  let drag = (event: DragEvent<HTMLInputElement>) => {
    // Dragging selected URL text must leave it editable instead of starting a native drop.
    event.preventDefault()
    dragging.current = true
  }
  useEffect(() => {
    let finish = (event: globalThis.MouseEvent) => {
      let input = source.current
      if (event.button !== 0 || !input) return
      let selection = dragging.current ? original.current : undefined
      source.current = undefined; dragging.current = false
      let bounds = input.getBoundingClientRect()
      if (!selection && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return
      void run('focus-ui').then(() => {
        if (!input.isConnected) return
        let { start, end, direction } = selection ?? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }
        input.blur(); input.focus(); input.setSelectionRange(start, end, direction ?? undefined)
      })
    }
    // Restore after mouse-up, once native text dragging has finished changing the selection.
    document.addEventListener('mouseup', finish, true)
    return () => document.removeEventListener('mouseup', finish, true)
  }, [run])
  return { start, drag }
}

let useDismissAddressOnOutsideClick = (form: RefObject<HTMLFormElement | null>, list: RefObject<HTMLDivElement | null>, dismiss: () => void, finish: () => void) => {
  useEffect(() => {
    let outside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || form.current?.contains(event.target) || list.current?.contains(event.target)) return
      if (event.target.closest('[data-pane-content]')) finish()
      else dismiss()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [form, list, dismiss, finish])
}

let useOpenAddressBookmark = (finish: () => void) => {
  let { state, run } = useUI(), { profile, client, tab } = selection(state)
  return async (bookmarkId: string) => {
    let result = await run('bookmark.open', { bookmark: bookmarkId, profile: profile!.id, tab: tab?.id, session: client!.sessionId, client: client!.id })
    if (result !== undefined) finish()
  }
}

let AddressPrompt = ({ takeSelection }: { takeSelection: () => AddressSelection | undefined }) => {
  let { state, run, dismiss, message, onMessage, addressFocusVersion, setAddressSuggestionsVisible } = useUI()
  let { client, pane, tab, profile, session } = selection(state)
  let [index, setIndex] = useState(-1), [preferRoot, setPreferRoot] = useState(true)
  let remote = tab ? state.remoteViews?.[tab.id] : undefined, currentUrl = remote ? remote.panes.find(pane => pane.id === remote.pane)?.url ?? '' : tab ? state.pendingUrls[tab.id] ?? tab.url : ''
  let [text, setText] = useState(currentUrl !== 'about:blank' ? currentUrl : '')
  let [query, setQuery] = useState('')
  let [inlineUrl, setInlineUrl] = useState<{ value: string; url: string }>()
  let [expandedHistory, setExpandedHistory] = useState(false)
  let [busy, setBusy] = useState(false)
  let ref = useRef<HTMLInputElement>(null), form = useRef<HTMLFormElement>(null), suggestionList = useRef<HTMLDivElement>(null)
  let selectionFocus = useAddressSelectionFocus()
  let selectAddress = useAddressSelection()
  let deleting = useRef(false)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useAddressFocus(ref, addressFocusVersion, takeSelection, state.vimEditing !== false)
  let profileHistory = remote ? [] : profile?.history ?? [], bookmarkMatches = remote ? [] : searchBookmarkPages(profile?.bookmarks ?? [], query)
  let savedUrls = [...bookmarkMatches.map(bookmark => bookmark.url!), ...profileHistory.map(entry => entry.url)]
  let destination = addressDestination(query, savedUrls), baseUrl = addressUrlCompletion(query, savedUrls) ?? destination ?? searchUrlDestination(query, savedUrls)
  let baseTitle = baseUrl ? urlDestinationTitle(baseUrl.url, [...bookmarkMatches, ...profileHistory]) ?? baseUrl.value : '', inlineHistory = inlineUrl ? profileHistory.find(entry => entry.url === inlineUrl.url) : undefined
  let inlineBookmark = inlineHistory && bookmarkMatches.slice(0, 8).some(bookmark => bookmark.url === inlineHistory.url)
  let preferredUrls = baseUrl ? [{ url: baseUrl.url, title: baseTitle }] : [], bookmarks = deduplicateAddressEntries(bookmarkMatches, preferredUrls).slice(0, inlineHistory && !inlineBookmark ? 7 : 8)
  let historyMatches = query.trim() ? searchHistory(profileHistory, query) : []
  let availableHistory = deduplicateAddressEntries(prioritizeInlineHistory(historyMatches, profileHistory, inlineUrl?.url), [...preferredUrls, ...bookmarks])
  let history = availableHistory.slice(0, expandedHistory ? undefined : 10 - bookmarks.length - (baseUrl ? 1 : 0))
  let results = withAddressSearch([
    ...(baseUrl ? [{ kind: profileHistory.some(entry => entry.url === baseUrl.url) ? 'history' : 'url', value: baseUrl.url, title: baseTitle, detail: baseUrl.url }] : []),
    ...bookmarks.map(bookmark => ({ kind: 'bookmark', value: parameterizedBookmarkUrl(bookmark.url!, state.bookmarkParameters?.[profile!.id]?.[bookmark.id]), title: bookmark.title, detail: bookmark.url!, bookmarkId: bookmark.id })),
    ...history.map(entry => ({ kind: 'history', value: entry.url, title: entry.title, detail: entry.url })),
    ...(availableHistory.length > history.length ? [{ kind: 'more', value: '', title: `Show ${availableHistory.length - history.length} more history matches`, detail: '' }] : []),
  ], query, (state.searchApps ?? DEFAULT_SEARCH_APPS)[session?.private ? 'private' : 'normal'], !!destination)
  let selectedIndex = index < 0 && preferRoot && query.trim() ? 0 : index, selectedResult = results[selectedIndex], selectedCompletion = index >= 0 && selectedResult?.kind !== 'search' && selectedResult?.value ? inlineUrlCompletion(query, selectedResult.value) : undefined
  let previewText = index >= 0 && selectedResult?.kind === 'search' ? query : index >= 0 && selectedResult?.value ? selectedCompletion?.value ?? selectedResult.value : text, completing = !!inlineUrl || index >= 0 && selectedResult?.kind !== 'search' && !!selectedResult?.value
  useEffect(() => { setAddressSuggestionsVisible(results.length > 0); return () => setAddressSuggestionsVisible(false) }, [results.length, setAddressSuggestionsVisible])
  useAddressSuggestionPosition(form, suggestionList, results.length > 0, state.statusBar)
  useEffect(() => { setIndex(current => Math.min(current, results.length - 1)) }, [results.length])
  useEffect(() => { if (index >= 0) suggestionList.current?.children[index]?.scrollIntoView({ block: 'nearest' }) }, [index])
  useLayoutEffect(() => {
    if (!ref.current || !completing) return
    let start = previewText.toLowerCase().startsWith(query.toLowerCase()) ? query.length : 0
    ref.current.setSelectionRange(start, previewText.length)
  }, [completing, previewText, query])
  let change = (event: ChangeEvent<HTMLInputElement>) => {
    let value = event.target.value
    let deletion = deleting.current || ((event.nativeEvent as InputEvent).inputType?.startsWith('delete') ?? false)
    deleting.current = false
    if (deletion) vim.reset('INSERT')
    let completion = deletion ? undefined : addressUrlCompletion(value, [...searchBookmarkPages(profile?.bookmarks ?? [], value).map(bookmark => bookmark.url!), ...profileHistory.map(entry => entry.url)])
    setQuery(value); setIndex(-1); setPreferRoot(!deletion); setInlineUrl(completion); setExpandedHistory(false); setText(completion?.value ?? value)
  }
  let finish = () => { dismiss(); void run('client.overlay', { client: client!.id, visible: false }).then(() => run('focus-page', { client: client!.id })) }
  useDismissAddressOnOutsideClick(form, suggestionList, dismiss, finish)
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
  let chooseBookmark = useOpenAddressBookmark(finish), submit = (event: FormEvent) => { event.preventDefault(); if (selectedResult && 'bookmarkId' in selectedResult && selectedResult.bookmarkId) { void chooseBookmark(selectedResult.bookmarkId); return }; if (selectedResult?.kind === 'more') { setExpandedHistory(true); setIndex(-1); return }; void navigate(selectedResult?.value ?? inlineUrl?.url ?? text) }
  let choose = (event: MouseEvent<HTMLButtonElement>) => { let result = results.find(result => result.kind === 'bookmark' && result.value === event.currentTarget.dataset.value); if (result && 'bookmarkId' in result && result.bookmarkId) { void chooseBookmark(result.bookmarkId); return }; if (event.currentTarget.dataset.kind === 'more') { setExpandedHistory(true); setIndex(-1); return }; void navigate(event.currentTarget.dataset.value!) }
  let removeHistory = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    let url = event.currentTarget.dataset.value!
    if (inlineUrl?.url === url) { setInlineUrl(undefined); setText(query) }
    setIndex(-1); void run('history.remove', { profile: profile!.id, url }); ref.current?.focus()
  }
  let vim = useAddressVim(direction => { if (results.length) setIndex((((selectedIndex < 0 ? direction > 0 ? -1 : 0 : selectedIndex) + direction) % results.length + results.length) % results.length) }, addressFocusVersion, previewText ? 'NORMAL' : 'INSERT', state.vimEditing !== false, ref, finish)
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (vim.keys(event) || event.nativeEvent.isComposing) return
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
    if (event.key === 'ArrowRight' && (inlineUrl || index >= 0 && selectedResult) && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.currentTarget.selectionStart === query.length && event.currentTarget.selectionEnd === previewText.length) {
      event.preventDefault(); setQuery(previewText); setText(previewText); setIndex(-1); setInlineUrl(undefined); requestAnimationFrame(() => ref.current?.setSelectionRange(previewText.length, previewText.length)); return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length) setIndex(selectedIndex < 0 ? (event.key === 'ArrowDown' ? 0 : results.length - 1) : (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
    }
  }
  return <div className={css.addressEditor}><form ref={form} className={css.prompt} onSubmit={submit}>{vim.enabled && <VimMode mode={vim.mode} label="URL editing mode" />}<div className={css.addressInput}><input id="prompt" ref={ref} data-vim-mode={vim.mode} aria-label="URL or search" aria-autocomplete="both" aria-expanded={!!results.length} aria-controls="address-suggestions" aria-activedescendant={selectedResult ? `address-suggestion-${selectedIndex}` : undefined} value={previewText} onChange={change} onKeyDown={keys} onPointerDown={selectionFocus.start} onMouseDown={selectAddress} onMouseUp={vim.select} onDragStart={selectionFocus.drag} autoComplete="off" spellCheck={false} readOnly={busy} /><VimCursor input={ref} mode={vim.mode} value={previewText} /></div>{message && <span className={css.error} role="status">{message}</span>}<CloseButton label="Close URL search" onClick={finish} /><button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
    {!!results.length && createPortal(<div ref={suggestionList} id="address-suggestions" role="listbox" aria-label="Address suggestions" className={css.urlHistory}>{results.map((entry, position) => <div key={`${entry.kind}:${entry.value}`} className={css.addressSuggestionRow}><button id={`address-suggestion-${position}`} type="button" role="option" aria-selected={position === selectedIndex} data-kind={entry.kind} data-value={entry.value} onClick={choose} disabled={busy}><AddressSuggestionIcon kind={entry.kind} /><strong>{entry.title}</strong><span>{entry.detail}</span></button>{entry.kind === 'history' && <button type="button" className={css.addressSuggestionRemove} data-value={entry.value} aria-label={`Remove ${entry.title || entry.value} from history`} title="Remove from history" onClick={removeHistory} disabled={busy}>×</button>}</div>)}</div>, document.body)}
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
  let selecting = mode === 'select-window'
  let closingPane = mode === 'close-pane', closingWindow = mode === 'close-window', closing = closingPane || closingWindow
  let ref = useRef<HTMLInputElement>(null)
  let renaming = mode === 'rename-window' || mode === 'rename-session', vim = useAddressVim(undefined, undefined, 'NORMAL', state.vimEditing !== false, ref, () => finish())
  let [text, setText] = useState(closing || selecting ? '' : mode === 'rename-session' ? session!.name : mode === 'move-window' ? String(session!.windows.indexOf(window!) + 1) : window!.name)
  let [busy, setBusy] = useState(false)
  let mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let input = ref.current
    if (!input) return
    input.focus()
    if (renaming && vim.enabled) input.setSelectionRange(0, 0)
    else input.select()
  }, [])
  let finish = () => { dismiss(); void run('focus-page', { client: client!.id }) }
  let apply = async () => {
    if (busy) return
    setBusy(true)
    let result = selecting ? await run('command-line', { client: client!.id, line: `select-window -t :${text.trim()}` }) : await run(closingPane ? 'kill-pane' : closingWindow ? 'kill-window' : mode, { client: client!.id, window: window!.id, pane: pane?.id, session: session!.id, ...(closing ? { confirm: true } : mode === 'move-window' ? { position: text.trim() } : { name: text.trim() }) })
    if (!mounted.current) return
    setBusy(false)
    if (result !== undefined) finish()
  }
  let submit = (event: FormEvent) => { event.preventDefault(); if (closing ? text.toLowerCase() === 'y' : text.trim()) void apply() }
  let change = (event: ChangeEvent<HTMLInputElement>) => { if (renaming && (event.nativeEvent as InputEvent).inputType?.startsWith('delete')) vim.reset('INSERT'); setText(event.target.value) }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (renaming && vim.keys(event)) return
    if (event.key === 'Escape' || (closing && event.key.toLowerCase() === 'n')) { event.preventDefault(); finish(); return }
    if (closing && event.key.toLowerCase() === 'y') { event.preventDefault(); void apply() }
  }
  let selectName = renaming ? vim.select : undefined
  let label = selecting ? 'Select window by index' : closingPane ? 'Close pane? (y/n)' : closingWindow ? `Close window "${window!.name}"? (y/n)` : mode === 'rename-session' ? 'Rename session' : mode === 'move-window' ? 'Move window to index' : 'Rename window'
  return <form className={css.prompt} onSubmit={submit}><label htmlFor="manage">{label}</label>{renaming && vim.enabled && <VimMode mode={vim.mode} label="Name editing mode" />}<div className={css.addressInput}><input id="manage" ref={ref} inputMode={selecting ? 'numeric' : undefined} pattern={selecting ? '[0-9]+' : undefined} data-vim-mode={renaming ? vim.mode : undefined} aria-label={closingPane ? 'Close pane confirmation' : closingWindow ? 'Close window confirmation' : label} value={text} onChange={change} onKeyDown={keys} onMouseUp={selectName} autoComplete="off" spellCheck={false} readOnly={busy} />{renaming && <VimCursor input={ref} mode={vim.mode} value={text} />}</div><span className={message ? css.error : undefined} role="status">{message || (renaming ? '' : 'esc')}</span>{renaming && <CloseButton label="Cancel rename" onClick={finish} />}<button type="submit" className={css.submit} aria-label="Submit">Enter</button></form>
}

let EmptyWorkspace = () => {
  let { control } = useUI()
  return <section className={css.pane}><PaneAddress /><div className={css.content}><EmptyPane />{control === 'command' && <CommandPrompt />}</div></section>
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
    if (event.button !== 0) return
    held.current = false
    if (!hasHistory || event.metaKey) return
    timer.current = setTimeout(() => { held.current = true; open() }, 450)
  }
  let click = (event: MouseEvent<HTMLButtonElement>) => { if (held.current) { held.current = false; return }; void run(direction, { tab: tabId, newWindow: event.metaKey }) }
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
let useDisplayedAddressSelection = (open: () => void) => {
  let addressSelection = useRef<AddressSelection | undefined>(undefined)
  let selectionPointer = useRef<number | undefined>(undefined)
  let takeAddressSelection = useCallback(() => {
    let selection = addressSelection.current
    addressSelection.current = undefined
    return selection
  }, [])
  let rememberSelection = (event: PointerEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>) => {
    let input = event.currentTarget
    let start = input.selectionStart ?? 0, end = input.selectionEnd ?? 0
    if (start !== end) addressSelection.current = { start, end, direction: input.selectionDirection ?? 'none' }
  }
  let beginSelection = (event: PointerEvent<HTMLInputElement>) => {
    if (event.button === 0) { selectionPointer.current = event.pointerId; addressSelection.current = undefined; captureAddressPointer(event) }
  }
  let editSelection = (event: PointerEvent<HTMLInputElement>) => {
    if (selectionPointer.current !== event.pointerId || (event.type === 'pointerup' && event.button !== 0)) return
    // Crossing into a native page can cancel capture before this input receives pointerup.
    // Complete the display-to-editor handoff once, preserving the selected text.
    selectionPointer.current = undefined
    rememberSelection(event)
    void open()
  }
  return { beginSelection, editSelection, takeAddressSelection }
}

let PaneAddress = ({ paneId }: { paneId?: string }) => {
  let { state } = useUI()
  let remote = paneId ? state.remoteViews?.[paneId] : undefined
  return remote ? <RemoteAddress paneId={paneId!} remote={remote} /> : <LocalPaneAddress paneId={paneId} />
}
let RemoteAddress = ({ paneId, remote }: { paneId: string; remote: RemoteView }) => {
  let { state, run, show, control, onMessage } = useUI()
  let url = remote.panes.find(pane => pane.id === remote.pane)?.url ?? ''
  let open = () => show('address', paneId)
  let { beginSelection, editSelection, takeAddressSelection } = useDisplayedAddressSelection(open)
  let selectAddress = useAddressSelection()
  let editFromClick = (event: MouseEvent<HTMLInputElement>) => { if (event.detail === 0) void open() }
  let editFromKeyboard = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void open() } }
  let back = () => { void run('back', { tab: paneId }) }
  let forward = () => { void run('forward', { tab: paneId }) }
  let reload = () => { void run('reload', { tab: paneId }) }
  return <div className={css.addressBar} role="group" aria-label="Pane address" data-remote-address>
    <div className={css.navigationControls}>
      <button className={css.navigationButton} aria-label="Back" title="Back" disabled={!remote.controlling} onClick={back}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5 6 8l4.5 4.5" /></svg></button>
      <button className={css.navigationButton} aria-label="Forward" title="Forward" disabled={!remote.controlling} onClick={forward}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 10 8l-4.5 4.5" /></svg></button>
      <button className={css.navigationButton} aria-label="Refresh" title="Refresh" disabled={!remote.controlling} onClick={reload}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 7.5a5 5 0 1 0-.9 3.3M13 3.5v4h-4" /></svg></button>
    </div>
    <div className={css.urlBar}>{control === 'address' && selection(state).client?.paneId === paneId ? <AddressPrompt key={remote.pane ?? paneId} takeSelection={takeAddressSelection} /> : <input className={css.location} aria-label="Address" role="button" value={url} title={url} placeholder="Remote page" readOnly onClick={editFromClick} onKeyDown={editFromKeyboard} onMouseDown={selectAddress} onPointerDown={beginSelection} onPointerUp={editSelection} onPointerCancel={editSelection} onLostPointerCapture={editSelection} />}</div>
    <span className={css.remoteProfile} title={remote.profileName}>{remote.profileName}</span>
    <PaneAgentButton paneId={paneId} />
    <RemotePaneControls remote={remote} paneId={paneId} focused={selection(state).client?.paneId === paneId} run={run} onError={onMessage} />
  </div>
}
let LocalPaneAddress = ({ paneId }: { paneId?: string }) => {
  let { state, control, show, run, historyPopup, setHistoryPopup } = useUI()
  let { client, session, window } = selection(state)
  let pane = window?.panes.find(pane => pane.id === paneId)
  let tab = pane
  let profile = state.model.profiles.find(profile => profile.id === pane?.profileId)
  let [profilePickerOpen, setProfilePickerOpen] = useState(false)
  let profilePicker = useRef<HTMLDivElement>(null)
  let security = tab ? state.security?.[tab.id] : undefined
  let url = tab ? state.pendingUrls[tab.id] ?? (security?.status === 'certificate-error' ? security.url : tab.url) : undefined
  let editing = control === 'address' && (client?.paneId === paneId || !paneId)
  let selectAddress = useAddressSelection()
  let open = () => show('address', paneId)
  let { beginSelection, editSelection, takeAddressSelection } = useDisplayedAddressSelection(open)
  let editFromClick = (event: MouseEvent<HTMLInputElement>) => { if (event.detail === 0) void open() }
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
  let backEnabled = back.length > 0 ? backHasPage : !!backOpener(state.model, tab)
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
  let blocking = tab ? state.browserTools?.tabs[tab.id] : undefined
  let openAdblock = () => show('adblock-popup', paneId)
  let openDarkMode = () => show('dark-mode-popup', paneId)
  let openSiteInfo = () => show('site-info', paneId)
  let openExtensions = () => show('extensions', paneId)
  let openProfile = () => show('profiles', paneId)
  let openProxy = () => show('proxy', paneId)
  let blank = !!pane && !session?.private && pane.url === 'about:blank' && !state.pendingUrls[pane.id] && !state.loading[pane.id] && !(state.navigation[pane.id]?.entries.some(entry => entry.url !== 'about:blank'))
  let choosePaneProfile = (event: ChangeEvent<HTMLSelectElement>) => {
    if (pane) void run('pane.profile.set', { pane: pane.id, profile: event.target.value })
    setProfilePickerOpen(false)
  }
  let togglePaneProfile = () => { if (blank) setProfilePickerOpen(open => !open); else openProfile() }
  let profileOptions = state.model.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)
  useEffect(() => { setProfilePickerOpen(false) }, [paneId, blank])
  useEffect(() => {
    if (!profilePickerOpen) return
    let outside = (event: globalThis.PointerEvent) => { if (!profilePicker.current?.contains(event.target as Node)) setProfilePickerOpen(false) }
    let escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setProfilePickerOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [profilePickerOpen])
  let customProfile = profile && session && !session.private && profile.id !== session.defaultProfileId ? profile : undefined
  let paneProxy = pane ? connectionProfile(state.model, paneConnectionId(pane)) : undefined
  let proxyTest = paneProxy ? state.profileProxyTests[paneProxy.id] : undefined
  let profileRouteLabel = profile ? `Profile: ${profile.name}` : 'Profile'
  let profileRouteTitle = profile ? `${profileRouteLabel}, ${profileDeviceLabel(pane!)}` : profileRouteLabel
  let proxyFailure = paneProxy ? state.profileProxyFailures[paneProxy.id] : undefined
  let proxyRouteLabel = profile && paneProxy?.proxy ? `Proxy for ${profile.name}${proxyFailure ? ', unavailable' : ''}` : ''
  let proxyRouteTitle = proxyFailure ? `Proxy unavailable · ${proxyFailure.error}` : proxyTest ? `Proxy verified · Exit IP: ${proxyTest.ip}` : paneProxy?.proxy ? `${paneProxy.proxy.protocol}://${paneProxy.proxy.host}:${paneProxy.proxy.port}` : ''
  let clickState = state.clickMode?.showInput && state.clickModeState?.paneId === tab?.id ? state.clickModeState : undefined
  if (clickState && !editing) return <div className={css.addressBar} role="group" aria-label="Pane address"><ClickModeActions action={clickState.action} input={clickState.input} backgroundColor={state.clickMode!.backgroundColor} textColor={state.clickMode!.textColor} />{paneId && <PaneAgentButton paneId={paneId} />}</div>
  return <div className={css.addressBar} role="group" aria-label="Pane address">
    {tab && <div className={css.navigationControls}>
      <NavigationButton direction="back" tabId={tab.id} enabled={backEnabled} hasHistory={backHasPage} open={() => setHistoryPopup({ tabId: tab.id, direction: 'back' })} />
      <NavigationButton direction="forward" tabId={tab.id} enabled={forward.length > 0} hasHistory={forward.length > 0} open={() => setHistoryPopup({ tabId: tab.id, direction: 'forward' })} />
      <button type="button" className={css.navigationButton} aria-label="Refresh" title="Refresh" onClick={refresh}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 7.5a5 5 0 1 0-.9 3.3M13 3.5v4h-4" /></svg></button>
      {popup && <div ref={menu} className={css.navigationMenu} role="menu" aria-label={`${popup.direction === 'back' ? 'Back' : 'Forward'} history`}>
        {(popup.direction === 'back' ? back : forward).map(entry => <NavigationMenuItem key={entry.index} entry={entry} select={selectHistory} />)}
      </div>}
    </div>}
    <div className={css.urlBar}>
      {tab && <ConnectionIndicator security={security} url={url ?? tab.url} open={openSiteInfo} />}
      {editing ? <AddressPrompt key={tab?.id ?? 'empty'} takeSelection={takeAddressSelection} /> : <input onClick={editFromClick} onPointerDown={beginSelection} onMouseDown={selectAddress} onPointerUp={editSelection} onPointerCancel={editSelection} onLostPointerCapture={editSelection} onKeyDown={editFromKeyboard} aria-label="Address" className={css.location} title={url} value={url && url !== 'about:blank' ? url : 'Cmd+L to open a URL'} role="button" readOnly />}
      {paneId && <span className={css.paneId} title={`Pane ID: ${paneId}`}>{paneId}</span>}
    </div>
    {paneId && <PaneAgentButton paneId={paneId} />}
    <div className={css.paneTools}>
      {profile && <div ref={profilePicker} className={css.profileRouteControls}>{!session?.private && <button type="button" className={css.profileRoute} onClick={togglePaneProfile} aria-label={blank ? `Choose pane profile: ${profile.name}` : profileRouteLabel} title={blank ? `Choose pane profile: ${profile.name}` : profileRouteTitle}><ProfileAvatar id={profile.id} name={profile.name} />{customProfile && pane?.device && <ProfileDeviceIcon />}</button>}<button type="button" className={css.profileRoute} onClick={openExtensions} aria-label="Extensions" title="Extensions"><ExtensionsIcon /></button>{paneProxy?.proxy && <button type="button" className={css.profileRoute} onClick={openProxy} aria-label={proxyRouteLabel} title={proxyRouteTitle} data-proxy-failed={!!proxyFailure || undefined}><ProfileConnectionIcon proxy verified={!!proxyTest} /></button>}{blank && profilePickerOpen && <label className={css.paneProfilePicker}>Pane profile<select aria-label="Pane profile" value={profile.id} onChange={choosePaneProfile} autoFocus>{profileOptions}</select><button type="button" onClick={openProfile}>Profile settings</button></label>}</div>}
      {tab && <button type="button" className={`${css.navigationButton} ${css.adblockButton}`} data-plugin-pane={tab.id} data-plugin-button="adblock" data-enabled={blocking?.adblock ?? false} aria-label="Ad blocking" aria-haspopup="dialog" aria-expanded={control === 'adblock-popup' && client?.paneId === tab.id} title={`Ad blocking ${blocking?.adblock ? 'on' : 'off'}`} disabled={!blocking} onClick={openAdblock}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 13 3.5v4c0 3-2 5-5 7-3-2-5-4-5-7v-4Z" />{blocking?.adblock ? <path d="m5.5 8 1.5 1.5 3.5-3.5" /> : <path d="m5.5 5.5 5 5" />}</svg></button>}
      {tab && state.showDarkModeButton && <button type="button" className={`${css.navigationButton} ${css.adblockButton}`} data-plugin-pane={tab.id} data-plugin-button="dark-mode" data-enabled={!!blocking && blocking.darkMode !== 'off'} aria-label="Dark mode" aria-haspopup="dialog" aria-expanded={control === 'dark-mode-popup' && client?.paneId === tab.id} title={`Dark mode ${blocking?.darkMode ?? 'off'}`} disabled={!blocking} onClick={openDarkMode}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2a5.8 5.8 0 1 0 7 7.5Z" /></svg></button>}
    </div>
  </div>
}
let Branch = ({ node }: { node: Layout }) => {
  let { state, run } = useUI()
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (node.kind === 'split') ref.current?.style.setProperty('--ratio', String(node.ratio)) }, [node])
  let startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (selection(state).session?.remote || node.kind !== 'split' || !ref.current) return
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
  return <div ref={ref} className={css.branch} data-axis={node.axis}><div className={css.first}><Branch node={node.first} /></div><div className={css.gutter} role="separator" aria-disabled={!!selection(state).session?.remote} aria-label="Resize split" onPointerDown={startDrag} /><div className={css.second}><Branch node={node.second} /></div></div>
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
  let { state, run, control } = useUI()
  let { client, window: selectedWindow } = selection(state)
  let pane = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === paneId)!
  let tab = pane
  let remote = state.remoteViews?.[paneId]
  let ref = useRef<HTMLDivElement>(null)
  let [deviceSize, setDeviceSize] = useState({ width: 0, height: 0 })
  let remoteSize = selectedWindow?.lockedViewports?.[paneId] ?? state.remoteSizes?.[paneId]
  useViewportPan(ref, paneId, !!remoteSize)
  useLayoutEffect(() => {
    if (!ref.current || !remoteSize) return
    ref.current.style.setProperty('--remote-width', `${remoteSize.width}px`)
    ref.current.style.setProperty('--remote-height', `${remoteSize.height}px`)
  }, [remoteSize?.width, remoteSize?.height])
  let frame = pane.device ? frameGeometry(pane.device, deviceSize) : null
  useLayoutEffect(() => {
    let publish = () => bridge.bounds([...document.querySelectorAll<HTMLElement>('[data-browser-content]')].map(element => { let rect = element.getBoundingClientRect(), pane = element.closest('[data-pane-content]')!.getBoundingClientRect(), remote = element.hasAttribute('data-remote-viewport'); return { paneId: element.dataset.contentPaneId!, x: rect.x, y: rect.y, width: remote ? element.clientWidth : rect.width, height: remote ? element.clientHeight : rect.height, scrollX: remote ? element.scrollLeft : 0, scrollY: remote ? element.scrollTop : 0, paneBounds: { x: pane.x, y: pane.y, width: pane.width, height: pane.height } } }))
    let observer = new ResizeObserver(publish)
    if (ref.current) observer.observe(ref.current)
    let screen = ref.current?.querySelector<HTMLElement>('[data-browser-content]')
    if (screen && screen !== ref.current) observer.observe(screen)
    if (ref.current) ref.current.addEventListener('scroll', publish)
    let element = ref.current
    publish()
    return () => { observer.disconnect(); element?.removeEventListener('scroll', publish) }
  }, [tab.id, client!.windowId, state.statusBar, pane.device, remoteSize?.width, remoteSize?.height])
  useLayoutEffect(() => {
    if (!pane.device || !ref.current) return
    let element = ref.current
    let measure = () => {
      let portrait = pane.device!.orientation === 'portrait'
      let width = portrait ? pane.device!.width : pane.device!.height
      let height = portrait ? pane.device!.height : pane.device!.width
      let geometry = frameGeometry(pane.device!, { width, height })
      let scale = Math.min(1, Math.max(1, element.clientWidth - 16) / geometry.width, Math.max(1, element.clientHeight - 16) / geometry.height)
      setDeviceSize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) })
    }
    let observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    return () => observer.disconnect()
  }, [pane.device])
  let focus = () => { if (client!.paneId !== pane.id) void run('select-pane', { client: client!.id, pane: pane.id }) }
  let menu = (event: MouseEvent<HTMLElement>) => { event.preventDefault(); if (!remote) void run('pane.menu', { pane: pane.id }) }
  let reload = () => { void run('reload', { tab: tab.id }) }
  let snapshot = state.snapshots[tab.id]
  let fallback = state.crashes[tab.id] ? <NavigationFailure error={state.crashes[tab.id]} hint={state.navigationProxyHints?.[tab.id]} reload={reload} /> : tab.url === 'about:blank' && !remote ? <EmptyPane paneId={pane.id} /> : !pane.device && snapshot ? <img className={css.preview} src={snapshot.image} alt="Page preview" /> : <div className={css.empty} />
  return <section className={css.pane} data-pane-id={pane.id} data-focused-pane={client!.paneId === pane.id} onContextMenu={menu}><PaneAddress paneId={pane.id} /><div className={`${css.content} ${remoteSize ? css.remoteViewport : ''}`} ref={ref} data-remote-viewport={remoteSize ? true : undefined} data-live-page={tab.url !== 'about:blank' && !state.crashes[tab.id] || undefined} data-pane-content data-browser-content={!remoteSize && pane.device ? undefined : true} data-content-pane-id={!remoteSize && pane.device ? undefined : pane.id} onMouseDown={focus}>
    {control === 'command' && client!.paneId === pane.id && <CommandPrompt key={`${client!.windowId}:${pane.id}`} />}
    {remoteSize ? <div className={css.remoteCanvas}>{fallback}</div> : pane.device && frame ? <div className={css.deviceFrame} data-platform={pane.device.platform} data-preset={pane.device.preset} data-orientation={pane.device.orientation} style={{ width: frame.width, height: frame.height }}><img className={css.deviceFrameImage} src={frameAsset(pane.device).image} alt="" draggable={false} style={{ width: pane.device.orientation === 'portrait' ? frame.width : frame.height, height: pane.device.orientation === 'portrait' ? frame.height : frame.width, transform: `translate(-50%, -50%)${pane.device.orientation === 'landscape' ? ' rotate(90deg)' : ''}` }} /><div className={css.deviceScreen} data-browser-content data-content-pane-id={pane.id} style={{ left: frame.screenLeft, top: frame.screenTop, width: deviceSize.width, height: deviceSize.height, borderRadius: deviceScreenShape(pane.device, deviceSize).radius }}>{fallback}</div></div> : fallback}
  </div></section>
}

let PluginQuickSettings = ({ feature, back, hidden }: { back: PanelBack | null; hidden: boolean; feature: 'adblock' | 'dark-mode' }) => {
  let { state, run, show, dismiss } = useUI()
  let { tab, pane } = selection(state)
  let current = tab && state.browserTools?.tabs[tab.id]
  let [scope, setScope] = useSettingsState(`${feature}:scope`, feature === 'adblock' ? 'pane' : 'profile')
  let popup = useRef<HTMLDivElement>(null)
  let setting: 'adblock' | 'darkMode' = feature === 'adblock' ? 'adblock' : 'darkMode'
  let value = scope === 'profile' ? current?.profileDefaults[setting] : scope === 'site' ? current?.siteDefaults?.[setting] ?? current?.[setting] : current?.[setting]
  let enabled = feature === 'adblock' ? value === true : !!value && value !== 'off'
  let unavailable = !tab || !current || (scope === 'site' && !current.origin)
  let changeScope = (event: ChangeEvent<HTMLSelectElement>) => setScope(event.target.value)
  let toggle = () => { if (tab) void run('browser.set', { tab: tab.id, setting, scope, value: feature === 'adblock' ? !enabled : enabled ? 'off' : 'dark' }) }
  let reset = () => { if (tab) void run('browser.set', { tab: tab.id, setting, scope, value: 'inherit' }) }
  let settings = () => show('plugins', undefined, undefined, feature)
  let outside = (event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) (back?.run ?? dismiss)() }
  useLayoutEffect(() => {
    let position = () => {
      if (!tab || !popup.current) return
      let anchor = document.querySelector<HTMLElement>(`[data-plugin-pane="${CSS.escape(tab.id)}"][data-plugin-button="${feature}"]`)
      if (!anchor) return
      let bounds = anchor.getBoundingClientRect(), box = popup.current.getBoundingClientRect()
      let left = Math.max(8, Math.min(bounds.right - box.width, innerWidth - box.width - 8))
      let top = bounds.bottom + 6 + box.height <= innerHeight - 8 ? bounds.bottom + 6 : Math.max(8, bounds.top - box.height - 6)
      popup.current.style.setProperty('--popup-left', `${left}px`)
      popup.current.style.setProperty('--popup-top', `${top}px`)
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [tab?.id, feature])
  return <div className={css.overlay} style={hidden ? { display: 'none' } : undefined} onClick={outside}><div ref={popup} className={css.pluginPopup} role="dialog" aria-modal="true" aria-label={feature === 'adblock' ? 'Ad blocking' : 'Dark mode'}>
    <PanelHeader back={back} dismiss={dismiss}><strong>{feature === 'adblock' ? 'Ad blocking' : 'Dark mode'}</strong></PanelHeader>
    <label>Apply to<select aria-label="Apply to" value={scope} onChange={changeScope}>{feature === 'adblock' && <option value="pane">This pane</option>}<option value="site">This site</option><option value="profile">This profile</option></select></label>
    <button type="button" role="switch" aria-label="Enabled" aria-checked={enabled} onClick={toggle} disabled={unavailable} autoFocus>Enabled: {enabled ? 'on' : 'off'}</button>
    <button type="button" onClick={reset} disabled={unavailable}>Use inherited setting</button>
    {feature === 'adblock' && scope !== 'pane' && pane?.adblock !== undefined && <p>This pane has a separate blocking override.</p>}
    <button type="button" onClick={settings}>Plugin settings</button>
  </div></div>
}

let SecondaryPanel = ({ type, closeToSessions, hidden }: { type: Control; closeToSessions: boolean; hidden: boolean }) => {
  let { dismiss, panelBack } = useUI()
  let opener = useRef(document.activeElement as HTMLElement | null)
  let ref = useRef<HTMLDivElement>(null)
  useEffect(() => () => { opener.current?.focus({ preventScroll: true }) }, [])
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); (panelBack?.run ?? dismiss)() }
    if (event.key !== 'Tab') return
    let buttons = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length)
    let index = buttons.indexOf(document.activeElement as HTMLElement)
    if (buttons.length && (event.shiftKey ? index <= 0 : index === buttons.length - 1)) { event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0].focus() }
  }
  return <div ref={ref} onKeyDown={keys}><Panel key={type} type={type} closeToParent={closeToSessions} hidden={hidden} /></div>
}
let Panel = ({ type, hidden = false, inactive = false, closeToParent = false }: { type: Control; hidden?: boolean; inactive?: boolean; closeToParent?: boolean }) => {
  let { state, dismiss, panelBack, control } = useUI()
  let [detailBack, setDetailBack] = useState<PanelBack | null>(null)
  let navigation = inactive ? null : type === 'plugin-dialog' ? isPanel(control) ? { label: 'Back', run: dismiss } : null : detailBack ?? panelBack
  let leave = navigation?.run ?? dismiss
  let ref = useRef<HTMLDivElement>(null), lastFocused = useRef<HTMLElement | null>(null), wasHidden = useRef(false)
  let rememberFocus = (event: FocusEvent<HTMLDivElement>) => { lastFocused.current = event.target }
  useEffect(() => {
    if (wasHidden.current && !hidden) lastFocused.current?.focus()
    wasHidden.current = hidden
  }, [hidden])
  let [sessionTab, setSessionTab] = useState(() => localStorage.getItem('session-picker-tab') === 'remote' ? 'remote' : 'local')
  let chooseLocalSessions = () => { setSessionTab('local'); localStorage.setItem('session-picker-tab', 'local') }
  let chooseRemoteSessions = () => { setSessionTab('remote'); localStorage.setItem('session-picker-tab', 'remote') }
  useEffect(() => { if (!hidden && !['help', 'sessions', 'bookmark', 'bookmarks', 'history', 'plugin-dialog', 'plugins', 'settings'].includes(type)) ref.current?.focus() }, [type, hidden])
  if (type === 'adblock-popup' || type === 'dark-mode-popup') return <PluginQuickSettings hidden={hidden} back={panelBack} feature={type === 'adblock-popup' ? 'adblock' : 'dark-mode'} />
  let cycleTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (sessionPicker && detailBack) return
    if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
    let target = event.target as HTMLElement
    if (target.closest('form[aria-label="Cursor and timing"]') && !target.closest('[role="tablist"]')) return
    let group = target.closest('[role="tablist"]') ?? ref.current?.querySelector('[role="tablist"][aria-label="Bot sections"]') ?? ref.current
    let tabs = [...(group?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [])].filter(tab => tab.getClientRects().length)
    if (tabs.length < 2) return
    let selected = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true')
    let next = tabs[(selected + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length]
    event.preventDefault(); event.stopPropagation()
    next.click(); next.focus()
  }
  let sessionPicker = type === 'sessions'
  let title = sessionPicker ? 'Sessions' : type === 'agent-info' ? 'Agent information' : type === 'anti-bot-settings' ? 'Bot settings' : type === 'site-info' ? 'Site information' : type === 'plugin-dialog' ? 'Plugin' : type === 'profiles' ? 'Profile' : type === 'proxy' ? 'Proxy' : type.charAt(0).toUpperCase() + type.slice(1)
  let dismissBackground = (event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) leave() }
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && (detailBack || type === 'plugin-dialog')) { event.preventDefault(); event.stopPropagation(); leave() }
  }
  let content = <div className={css.overlay} style={hidden ? { display: 'none' } : undefined} onClick={dismissBackground} inert={inactive}><div className={`${css.panel} ${type === 'extensions' || type === 'plugins' ? css.extensionsPanel : type === 'settings' ? css.settingsPanel : type === 'profiles' ? css.profilePanel : type === 'proxy' ? css.proxyPanel : type === 'bookmarks' ? css.bookmarksPanel : sessionPicker ? css.sessionsPanel : ''}`} role="dialog" aria-label={title} aria-modal={!inactive} tabIndex={-1} ref={ref} onKeyDownCapture={cycleTabs} onKeyDown={keys} onFocusCapture={rememberFocus}>
    <PanelHeader back={sessionPicker || closeToParent ? null : navigation} dismiss={closeToParent ? leave : dismiss}>{sessionPicker ? <div className={css.panelTabs} role="tablist" aria-label="Sessions">
      <button type="button" role="tab" aria-selected={sessionTab === 'local'} onClick={chooseLocalSessions}>Local</button>
      <button type="button" role="tab" aria-selected={sessionTab === 'remote'} onClick={chooseRemoteSessions}>Remote</button>
    </div> : <strong>{title}</strong>}</PanelHeader>
    <div className={css.panelBody}>
      {sessionPicker && navigation && !closeToParent && <div className={css.sessionNavigation} data-session-navigation><BackButton back={navigation} /></div>}
      {type === 'help' && <HelpContent />}
      {type === 'plugins' && <PluginList />}
      {type === 'plugin-dialog' && state.pluginPrompt && <PluginDialog key={state.pluginPrompt.id} />}
      {type === 'site-info' && <SiteInformation />}
      {type === 'agent-info' && <AgentInformation />}
      {type === 'anti-bot-settings' && <GeneralBotSettings />}
      {type === 'settings' && <SettingsContent />}
      {sessionPicker && (sessionTab === 'remote' ? <RemoteSessionPicker /> : <SessionPicker />)}
      {type === 'profiles' && <ProfileInfo />}
      {type === 'proxy' && <ProxyInfo />}
      {type === 'bookmark' && <BookmarkEditor />}
      {type === 'bookmarks' && <BookmarkPicker />}
      {type === 'history' && <HistoryPicker />}
      {type === 'downloads' && <DownloadManager />}
      {type === 'extensions' && <ExtensionsContent />}
      {type === 'activity' && <><PluginActivity /><p>Permissions</p>{state.permissions.length ? state.permissions.map(permission => <PermissionRow key={permission.id} permission={permission} />) : <p>No pending requests.</p>}<DownloadManager /></>}
    </div>
  </div></div>
  return <PanelBackContext.Provider value={setDetailBack}>{content}</PanelBackContext.Provider>
}
let AgentInformation = () => {
  let { agentDetails, state, run, show } = useUI()
  let panes = state.model.sessions.filter(session => !('sessionId' in agentDetails) || session.id === agentDetails.sessionId).flatMap(session => session.windows.filter(window => !('windowId' in agentDetails) || window.id === agentDetails.windowId).flatMap(window => window.panes))
  let actors = 'paneId' in agentDetails ? panes.filter(pane => pane.id === agentDetails.paneId).flatMap(pane => lastPaneAgent(pane, state.activeAgents) ?? []) : 'actors' in agentDetails ? agentDetails.actors : paneAgents(panes, state.activeAgents)
  let [busy, setBusy] = useState<string | null>(null)
  let focus = async (actor: AutomationActor) => {
    setBusy(actor.paneId)
    try { await run('agent.focus', { pane: actor.paneId, agentId: actor.agentId, agentOrigin: actor.agentOrigin }) } finally { setBusy(null) }
  }
  let toggleCursor = async (actor: AutomationActor) => {
    setBusy(actor.paneId)
    try { await run('agent.cursor.set', { pane: actor.paneId, agentId: actor.agentId, hidden: !state.hiddenAgentCursors?.includes(actor.paneId) }) } finally { setBusy(null) }
  }
  let toggleLock = async (actor: AutomationActor) => {
    setBusy(actor.paneId)
    try { await run('agent.input-lock.override', { pane: actor.paneId, enabled: !state.agentLockOverrides?.[actor.paneId] }) } finally { setBusy(null) }
  }
  let settings = () => show('anti-bot-settings')
  return <div className={css.agentInformation}>{!actors.length && <p>No agent interaction in this pane.</p>}{actors.map(actor => {
    let definition = actor.agentType ? state.automationAgents?.definitions[actor.agentType] : undefined
    let sessionField = Object.keys(actor.agentData ?? {}).find(key => definition?.fields[key]?.type === 'session' || key === 'sessionId')
    let fields = Object.entries(actor.agentData ?? {}).filter(([key]) => key !== 'sessionName' || !sessionField)
    let hidden = state.hiddenAgentCursors?.includes(actor.paneId)
    let override = state.agentLockOverrides?.[actor.paneId]
    let locked = state.lockedAgentPanes?.includes(actor.paneId)
    let toggleVisibility = () => { void toggleCursor(actor) }
    let toggleInputLock = () => { void toggleLock(actor) }
    return <section key={`${actor.paneId}:${actor.agentId}`}>
      <dl>{actor.agentName && actor.agentName !== actor.agentId && <><dt>Name</dt><dd>{actor.agentName}</dd></>}{actor.agentId && <><dt>Agent ID</dt><dd>{actor.agentId}</dd></>}{actor.agentPurpose && <><dt>Browsing reason</dt><dd>{actor.agentPurpose}</dd></>}
        <AgentInteractionField actor={actor} />
        {actor.agentType && <><dt>Type</dt><dd>{actor.agentType}</dd></>}
        {fields.map(([key, value]) => <Fragment key={key}><dt>{definition?.fields[key]?.label ?? ({ sessionId: 'Session', sessionName: 'Session', windowId: 'Window ID', windowIndex: 'Window number', paneId: 'Pane ID' }[key] ?? key)}</dt><dd>{key === sessionField ? actor.agentData?.sessionName ?? value : value}</dd></Fragment>)}
      </dl>
      <div className={css.agentActions}>
        {definition?.focusCommand && <button className={css.agentAction} type="button" disabled={busy !== null} onClick={() => { void focus(actor) }}><FocusAgentIcon />Focus agent</button>}
        <button className={css.agentAction} type="button" disabled={busy !== null} onClick={toggleVisibility}><AgentCursorIcon hidden={hidden} />{hidden ? 'Show agent cursor' : 'Hide agent cursor'}</button>
        {(locked || override) && <button className={css.agentAction} type="button" disabled={busy !== null} title={override ? `Override ends at ${new Date(override).toLocaleTimeString()}` : 'Allow page input for 5 minutes'} onClick={toggleInputLock}><AgentLockIcon unlocked={!override} />{override ? 'Restore agent lock' : 'Override agent lock (5 min)'}</button>}
      </div>
    </section>
  })}<div className={`${css.agentActions} ${css.agentSettings}`}><button className={css.agentAction} type="button" onClick={settings}><SettingsIcon />Bot settings</button></div></div>
}

let FocusAgentIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7 9M6 3H2v11h11v-4" /></svg>
let AgentCursorIcon = ({ hidden }: { hidden?: boolean }) => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 2 1 11 3-3 2 4 2-1-2-4h4Z" />{hidden && <path d="m2 14 12-12" />}</svg>
let AgentLockIcon = ({ unlocked }: { unlocked: boolean }) => <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" /><path d={unlocked ? 'M5 7V5a3 3 0 0 1 6 0' : 'M5 7V5a3 3 0 0 1 6 0v2'} /></svg>

let AgentRequirementSwitch = ({ setting, label }: { setting: 'requireId' | 'requireType'; label: string }) => {
  let { state, run } = useUI()
  let savedRequired = state.automationAgents?.[setting] ?? setting === 'requireId'
  let [required, setRequired] = useState(savedRequired), [busy, setBusy] = useState(false)
  useEffect(() => { setRequired(savedRequired) }, [savedRequired])
  let changeIdentity = async (event: ChangeEvent<HTMLInputElement>) => {
    let next = event.target.checked
    setRequired(next); setBusy(true)
    try { if (!await run('automation.agents.set', { [setting]: next })) setRequired(savedRequired) } finally { setBusy(false) }
  }
  return <label className={css.settingsRow}><span>{label}</span><input type="checkbox" role="switch" aria-label={label} checked={required} disabled={busy} onChange={changeIdentity} /></label>
}

let GeneralBotSettings = () => {
  let { state, run } = useUI()
  let { profile: selectedProfile } = selection(state)
  let stack = usePanelStack(null, 'Back to Bot settings')
  if (stack.selected === 'cursor') return <AgentFeedbackSettings profileId={selectedProfile?.id} value={state.agentFeedback ?? DEFAULT_AGENT_FEEDBACK} save={value => run('settings.set', { key: 'agentFeedback', value })} />
  let profile = state.model.profiles.find(profile => profile.id === stack.selected)
  let panes = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes))
  let pane = profile && (panes.find(pane => pane.id === selection(state).pane?.id && pane.profileId === profile.id) ?? panes.find(pane => pane.profileId === profile.id))
  if (profile) return <section aria-label={`${profile.name} bot settings`}><h2>{profile.name}</h2><ProfileBotSettings key={profile.id} profile={profile} pane={pane || undefined} /></section>
  return <div className={css.agentInformation}>
    <AgentRequirementSwitch setting="requireId" label="Require agent ID" />
    <AgentRequirementSwitch setting="requireType" label="Require agent type" />
    <section ref={stack.list} tabIndex={-1}><button type="button" className={css.listRow} data-details="cursor" onClick={stack.open}>Cursor and timing</button>
    <section aria-label="Profile limits">
      <h2>Profile limits</h2><p>Choose a profile to edit its limits. Each website has its own session timer.</p>
      {state.model.profiles.map(profile => <button key={profile.id} type="button" className={css.listRow} data-details={profile.id} onClick={stack.open}>{profile.name}</button>)}
    </section></section>
  </div>
}

let SiteInformation = () => {
  let { state, run } = useUI()
  let { tab, profile } = selection(state)
  let [busy, setBusy] = useState(false)
  let [notice, setNotice] = useState('')
  useEffect(() => { setNotice('') }, [tab?.id, tab?.url])
  if (!tab) return <p>Open a page to see its connection.</p>
  let security = state.security?.[tab.id] ?? initialSecurity(tab.url)
  let origin = (() => { try { let parsed = new URL(security.url); return parsed.origin === 'null' ? parsed.protocol : parsed.origin } catch { return security.url } })()
  let certificate = security.certificate
  let date = (seconds: number) => Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : 'Unavailable'
  let clearSiteData = async () => {
    setBusy(true); setNotice('')
    try {
      let result = await run('site-data.clear', { tab: tab.id, origin })
      if (result !== undefined) setNotice('Cookies and site data cleared. Page reloaded.')
    } finally { setBusy(false) }
  }
  return <section aria-label="Connection details">
    <p><strong>{origin}</strong><br />{profile?.name}</p>
    <p role="status">{connectionLabels[security.status]}</p>
    {security.error && <p>{security.error}</p>}
    {security.status === 'certificate-error' && <p>This connection was blocked because its certificate could not be verified.</p>}
    {security.status === 'mixed' && <p>This page includes or requests content over an unencrypted connection.</p>}
    <p>Encryption protects the connection. It does not establish that a website is trustworthy.</p>
    {certificate && <dl><dt>Subject</dt><dd>{certificate.subject || 'Unavailable'}</dd><dt>Issuer</dt><dd>{certificate.issuer || 'Unavailable'}</dd><dt>Valid from</dt><dd>{date(certificate.validFrom)}</dd><dt>Valid until</dt><dd>{date(certificate.validTo)}</dd>{certificate.protocol && <><dt>Protocol</dt><dd>{certificate.protocol}</dd></>}</dl>}
    {/^https?:\/\//i.test(origin) && <button onClick={clearSiteData} disabled={busy}>{busy ? 'Clearing…' : 'Clear cookies and site data'}</button>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
let ExtensionInfoIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 9v5m0-8v.5" /></svg>
let ExtensionsContent = () => {
  let [tab, setTab] = useSettingsState<'extensions' | 'plugins'>('extensions:tab', 'plugins')
  let extensions = () => setTab('extensions'), plugins = () => setTab('plugins')
  return <>
    <div className={css.panelTabs} role="tablist" aria-label="Extensions sections">
      <button type="button" role="tab" aria-selected={tab === 'plugins'} onClick={plugins}>Plugins</button>
      <button type="button" role="tab" aria-selected={tab === 'extensions'} onClick={extensions}>Chrome extensions</button>
    </div>
    <div role="tabpanel" aria-label={tab === 'extensions' ? 'Chrome extensions' : 'Plugins'}>{tab === 'extensions' ? <ExtensionManager /> : <PluginList compact />}</div>
  </>
}
let ExtensionManager = () => {
  let { state, run, dismiss } = useUI()
  let { profile, session } = selection(state)
  let [listing, setListing] = useState<ExtensionList | null>(null)
  let { selected: selectedPath, setSelected: setSelectedPath, list: listRef, open: showDetails, keys } = usePanelStack(null, 'Back to extensions')
  let [busy, setBusy] = useState(false)
  let [notice, setNotice] = useState('')
  let extensionKey = session?.private ? session.id : profile?.id
  let currentProfile = useRef(extensionKey)
  currentProfile.current = extensionKey
  useEffect(() => {
    setListing(null)
    setSelectedPath(null)
    setNotice('')
    if (!profile) return
    let cancelled = false
    void run('extension.list', { profile: profile.id, ...(session?.private ? { session: session.id } : {}) }).then(result => {
      if (!cancelled && result) setListing(result as ExtensionList)
    })
    return () => { cancelled = true }
  }, [profile?.id, session?.id, session?.private, run])
  let action = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!profile || busy) return
    let { action, id, path } = event.currentTarget.dataset
    let profileId = profile.id, sessionId = session?.private ? session.id : undefined
    setBusy(true)
    try {
      let result = await run(`extension.${action}`, { profile: profileId, id, path, ...(sessionId ? { session: sessionId } : {}) })
      if (!result || currentProfile.current !== (sessionId ?? profileId)) return
      if (action === 'open' || action === 'options') { dismiss(); return }
      let updated = await run('extension.list', { profile: profileId, ...(sessionId ? { session: sessionId } : {}) })
      if (updated && currentProfile.current === (sessionId ?? profileId)) {
        setListing(updated as ExtensionList)
        if (action === 'remove') setSelectedPath(null)
        setNotice('Reload open pages to apply extension changes.')
      }
    } finally { setBusy(false) }
  }
  let selected = listing?.extensions.find(extension => extension.path === selectedPath)
  let details = selected && <section aria-label="Extension details" className={css.extensionDetails}>
    <h2>{selected.name}</h2>
    {selected.description && <p>{selected.description}</p>}
    <dl className={css.extensionMetadata}>
      <div><dt>Version</dt><dd>{selected.version || 'Unavailable'}</dd></div>
      <div><dt>ID</dt><dd>{selected.id === selected.path ? 'Unavailable' : selected.id}</dd></div>
      <div><dt>{session?.private ? 'Session' : 'Profile'}</dt><dd>{session?.private ? session.name : profile?.name}</dd></div>
      <div><dt>Package location</dt><dd>{selected.path}</dd></div>
      {selected.manifestVersion && <div><dt>Manifest version</dt><dd>{selected.manifestVersion}</dd></div>}
    </dl>
    {selected.error && <p className={css.error}>{selected.error}</p>}
    {selected.manifestAvailable ? <>
      <h3>Permissions</h3>
      <p>Declared by the extension. Availability depends on bmux support.</p>
      <dl className={css.extensionMetadata}>
        <div><dt>Required permissions</dt><dd>{selected.permissions.join(', ') || 'None'}</dd></div>
        <div><dt>Requested site access</dt><dd>{selected.hostPermissions.join(', ') || 'None'}</dd></div>
        {!!selected.contentScriptMatches.length && <div><dt>Content script sites</dt><dd>{selected.contentScriptMatches.join(', ')}</dd></div>}
        {!!selected.optionalPermissions.length && <div><dt>Optional permissions</dt><dd>{selected.optionalPermissions.join(', ')} (not granted)</dd></div>}
        {!!selected.optionalHostPermissions.length && <div><dt>Optional site access</dt><dd>{selected.optionalHostPermissions.join(', ')} (not granted)</dd></div>}
      </dl>
    </> : <p>Manifest unavailable. Permissions could not be read.</p>}
    {selected.hasOptions && <button data-id={selected.id} data-action="options" onClick={action} disabled={busy || !selected.enabled}>Options</button>}
    <section className={css.extensionDanger} aria-label="Danger zone">
      <h3>Danger zone</h3>
      <p>{session?.private ? 'Disable in this private session. Extension data is discarded when the session closes.' : `Remove from ${profile?.name}. Other profiles, package files, and saved extension data are kept.`}</p>
      <button data-id={selected.id} data-action="remove" onClick={action} disabled={busy}>{session?.private ? 'Disable extension' : 'Remove extension'}</button>
    </section>
    {notice && <p role="status">{notice}</p>}
  </section>
  return <div className={css.extensionWorkspace} data-details-open={!!selected} onKeyDown={keys}>
    <section aria-label="Profile extensions" className={css.extensionList} ref={listRef} tabIndex={-1}><p>{session?.private ? `Private session: ${session.name}. Extension choices and data last only for this session.` : `Profile: ${profile?.name ?? 'No selected pane'}. Changes apply only to this profile.`}</p>
    {!listing && <p>Loading extensions…</p>}
    {listing && !listing.extensions.length && <p>{session?.private ? 'No extensions enabled in this private session.' : 'No extensions in this profile.'}</p>}
    {listing?.extensions.map(extension => <div key={extension.path} data-panel-row className={css.extensionRow}>
      <button className={css.extensionName} data-id={extension.id} data-action="open" onClick={action} disabled={busy || !extension.enabled || !extension.hasPopup}><strong>{extension.name}</strong>{extension.error && <span className={css.error}>Failed to load</span>}</button>
      <button className={css.extensionInfo} data-details={extension.path} aria-current={selectedPath === extension.path || undefined} onClick={showDetails} aria-label={`Details for ${extension.name}`} title="Extension details"><ExtensionInfoIcon /></button>
      <button className={css.extensionToggle} role="switch" aria-checked={extension.enabled} aria-label={`Enable ${extension.name}`} data-id={extension.id} data-action={extension.enabled ? 'disable' : 'enable'} onClick={action} disabled={busy} />
    </div>)}
    {!!listing?.available.length && <p>{session?.private ? 'Installed extensions' : 'Available from other profiles'}</p>}
    {listing?.available.map(extension => <button key={extension.path} className={css.listRow} disabled={busy} data-action="load" data-path={extension.path} onClick={action}><strong>Enable {extension.name}</strong><span className={css.pluginDescription}>Version {extension.version}</span></button>)}
    {notice && <p role="status">{notice}</p>}
    {listing?.errors.map(error => <p key={`${error.path}:${error.error}`} className={css.error}>{error.error}</p>)}
    </section>
    {details || <p className={css.extensionPlaceholder}>Select an extension to see its details.</p>}
  </div>
}

let BUILTIN_TOOLS = [
  { id: 'dark-mode', name: 'Dark mode', description: 'Recolor websites with Dark Reader or follow the system.' },
  { id: 'adblock', name: 'Ad and tracker blocking', description: 'Block ads and trackers and update filter lists.' },
  { id: 'userscripts', name: 'Userscripts and styles', description: 'Configure local JavaScript and CSS for websites.' },
] as const

type BuiltinTool = typeof BUILTIN_TOOLS[number]['id']
let PluginList = ({ compact = false, matches }: { compact?: boolean; matches?: Set<string> }) => {
  let { state, run, initialPlugin, panelBack } = useUI()
  let stack = usePanelStack(!compact && initialPlugin ? `builtin:${initialPlugin}` : null, 'Back to plugins', !compact && initialPlugin ? panelBack : null)
  let [query, setQuery] = useState(''), [changing, setChanging] = useState<string[]>([])
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  let reload = () => { void run('plugin.reload') }
  let toggle = async (event: MouseEvent<HTMLButtonElement>) => {
    let plugin = state.plugins?.find(plugin => plugin.id === event.currentTarget.dataset.id)
    if (!plugin || changing.includes(plugin.id)) return
    setChanging(current => [...current, plugin.id])
    try { await run('plugin.enable', { id: plugin.id, enabled: !plugin.enabled }) }
    finally { setChanging(current => current.filter(id => id !== plugin.id)) }
  }
  let builtin = BUILTIN_TOOLS.find(tool => `builtin:${tool.id}` === stack.selected)
  let plugin = state.plugins?.find(plugin => `plugin:${plugin.id}` === stack.selected)
  if (matches) return <>
    {BUILTIN_TOOLS.map(tool => <BuiltinPluginSettings key={tool.id} feature={tool.id} matches={matches} />)}
    <PluginConfiguration compact={compact} matches={matches} />
  </>
  let details = (builtin || plugin) && <section aria-label="Plugin details" className={css.extensionDetails}>
    <h2>{builtin?.name ?? plugin?.name}</h2>
    {builtin ? <><p>{builtin.description}</p><BuiltinPluginSettings key={builtin.id} feature={builtin.id} /></> : <><p>Version {plugin!.version || 'unavailable'}</p><PluginConfiguration pluginId={plugin!.id} compact /></>}
  </section>
  let includes = (text: string) => text.toLowerCase().includes(query.toLowerCase())
  let builtins = BUILTIN_TOOLS.filter(tool => includes(`${tool.name} ${tool.description}`))
  let plugins = [...(state.plugins ?? [])].filter(plugin => includes(`${plugin.name} ${plugin.actions.map(action => `${action.title} ${action.description ?? ''}`).join(' ')}`)).sort((a, b) => a.name.localeCompare(b.name))
  let row = (plugin: NonNullable<typeof state.plugins>[number]) => <div key={plugin.id} data-panel-row className={css.extensionRow}>
    <button className={css.extensionName} data-details={`plugin:${plugin.id}`} aria-current={stack.selected === `plugin:${plugin.id}` || undefined} onClick={stack.open}><strong>{plugin.name}</strong>{plugin.error && <span className={css.error}>{plugin.error}</span>}</button>
    <button type="button" role="switch" className={css.extensionToggle} aria-label={`Enable ${plugin.name}`} aria-checked={plugin.enabled} data-id={plugin.id} onClick={toggle} disabled={changing.includes(plugin.id)} />
  </div>
  return <div className={css.extensionWorkspace} data-details-open={!!details} onKeyDown={stack.keys}>
    <section aria-label="Plugin list" className={css.extensionList} ref={stack.list} tabIndex={-1}>
    <SearchInput aria-label="Find plugin action" value={query} onChange={change} autoFocus={!compact} />
    <h2>Built-in</h2>
    {builtins.map(tool => <div key={tool.id} data-panel-row><button className={css.listRow} data-details={`builtin:${tool.id}`} aria-current={stack.selected === `builtin:${tool.id}` || undefined} onClick={stack.open}><strong>{tool.name}</strong></button></div>)}
    {plugins.filter(plugin => plugin.bundled).map(row)}
    <h2>Custom</h2>
    {plugins.filter(plugin => !plugin.bundled).map(row)}
    {!plugins.some(plugin => !plugin.bundled) && <p>{query ? 'No matching custom plugins.' : 'Add folders containing plugin.yaml beside your config, in plugins/.'}</p>}
    <button onClick={reload}>Reload plugins</button>
    </section>
    {details || <p className={css.extensionPlaceholder}>Select a plugin to see its details.</p>}
  </div>
}

let PluginConfiguration = ({ compact = false, matches, pluginId }: { compact?: boolean; matches?: Set<string>; pluginId?: string }) => {
  let { state, run } = useUI()
  let [query, setQuery] = useState('')
  let choose = (event: MouseEvent<HTMLButtonElement>) => { void run('plugin.run', { action: event.currentTarget.dataset.action }) }
  let toggle = (event: ChangeEvent<HTMLInputElement>) => { void run('plugin.enable', { id: event.target.dataset.id, enabled: event.target.checked }) }
  let toggleHooks = (event: ChangeEvent<HTMLInputElement>) => { void run('plugin.hooks', { id: event.target.dataset.id, enabled: event.target.checked }) }
  let reload = () => { void run('plugin.reload') }
  let change = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  let show = (target: string) => !matches || matches.has(target)
  return <>{!pluginId && !compact && <h2>Installed plugins</h2>}{!pluginId && !matches && <SearchInput aria-label="Find plugin action" value={query} onChange={change} autoFocus={!compact} />}
    {!matches && !state.plugins?.length && <p>{compact ? 'No plugins installed.' : 'No plugins found. Add folders containing plugin.yaml beside your config, in plugins/.'}</p>}
    {state.plugins?.filter(plugin => (!pluginId || plugin.id === pluginId)).filter(plugin => show(`[data-setting-plugin="${CSS.escape(plugin.id)}"]`) || plugin.actions.some(action => show(`[data-setting-plugin-action="${CSS.escape(`${plugin.id}/${action.id}`)}"]`))).map(plugin => <div key={plugin.id}>
      {show(`[data-setting-plugin="${CSS.escape(plugin.id)}"]`) && <label><input type="checkbox" data-id={plugin.id} data-setting-plugin={plugin.id} checked={plugin.enabled} onChange={toggle} />{plugin.name} · {plugin.enabled ? 'enabled' : 'disabled'}{plugin.error ? ` · ${plugin.error}` : ''}</label>}
      {plugin.hasHooks && show(`[data-setting-plugin="${CSS.escape(plugin.id)}"]`) && <label><input type="checkbox" data-id={plugin.id} checked={plugin.hooks} disabled={!plugin.enabled} onChange={toggleHooks} aria-label={`Automatic hooks for ${plugin.name}`} />Automatic hooks · {plugin.hooks ? 'on' : 'off'} (reload open pages after changing)</label>}
      {plugin.actions.filter(action => `${plugin.name} ${action.title}`.toLowerCase().includes(query.toLowerCase()) && show(`[data-setting-plugin-action="${CSS.escape(`${plugin.id}/${action.id}`)}"]`)).map(action => <button key={action.id} className={css.listRow} disabled={!plugin.enabled} data-action={`${plugin.id}/${action.id}`} data-setting-plugin-action={`${plugin.id}/${action.id}`} onClick={choose}>{action.title}{action.description && <span className={css.pluginDescription}>{action.description}</span>}</button>)}</div>)}
    {!compact && <p>Scripts run with your OS user privileges.</p>}{show('[data-setting-id="reload-plugins"]') && <button data-setting-id="reload-plugins" onClick={reload}>Reload plugins</button>}</>
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
let usePickerNavigation = (onMetaEnter?: (row: HTMLElement) => void, initialQuery = '', onQueryChange?: (query: string) => void, clearOnEscape = true, rowSelector = 'button:not(:disabled):not([aria-disabled="true"]):not([data-picker-action])', activateRow = (row: HTMLElement) => row.click(), searchRowSelector = rowSelector) => {
  let [query, setCurrentQuery] = useState(initialQuery)
  let setQuery = (value: string) => { setCurrentQuery(value); onQueryChange?.(value) }
  let ref = useRef<HTMLDivElement>(null)
  let input = useRef<HTMLInputElement>(null)
  useEffect(() => { (ref.current?.querySelector<HTMLElement>('[data-active="true"]') ?? input.current)?.focus() }, [])
  useEffect(() => {
    let picker = ref.current
    let updateSelection = () => {
      let rows = picker?.querySelectorAll<HTMLElement>(rowSelector)
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
    let rows = [...ref.current!.querySelectorAll<HTMLElement>(editing && query ? searchRowSelector : rowSelector)].filter(row => row.getClientRects().length && !row.closest('details:not([open]) > :not(summary)'))
    if (event.key === 'Enter' && event.metaKey && onMetaEnter) {
      event.preventDefault()
      let selected = rows.find(row => row === document.activeElement) ?? rows[0]
      if (selected) onMetaEnter(selected)
      return
    }
    if (event.metaKey || event.ctrlKey) return
    if (event.key === 'Escape' && query && clearOnEscape) { event.preventDefault(); event.stopPropagation(); setQuery(''); input.current?.focus(); return }
    if (event.key === '/' && !editing) { event.preventDefault(); input.current?.focus(); input.current?.select(); return }
    if (!editing && event.key.length === 1 && event.key !== ' ') { event.preventDefault(); setQuery(query + event.key); input.current?.focus(); return }
    if (editing && event.key === 'Enter') { event.preventDefault(); if (rows[0]) activateRow(rows[0]); return }
    if (editing && ['Home', 'End'].includes(event.key)) return
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    let index = editing && query ? 0 : rows.findIndex(row => row === document.activeElement)
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index < 0 && event.key === 'ArrowUp' ? -1 : index + ({ ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key] ?? 0)
    let arrow = event.key === 'ArrowUp' || event.key === 'ArrowDown'
    let nextIndex = arrow && rows.length ? (next + rows.length) % rows.length : Math.max(0, Math.min(rows.length - 1, next)), row = rows[nextIndex]
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
    let panel = ref.current?.querySelector<HTMLElement>('[data-session-list], [data-bookmark-scroll]') ?? ref.current?.closest<HTMLElement>('[role="dialog"]')
    if (panel && nextIndex === 0) panel.scrollTop = 0
    else if (panel && nextIndex === rows.length - 1) panel.scrollTop = panel.scrollHeight
  }
  return { ref, keys, input, query, setQuery, change }
}
let PrivateIcon = () => <svg className={`${css.statusIcon} ${css.privateIcon}`} viewBox="0 0 20 20" aria-label="Private session" role="img"><rect x="5" y="9" width="10" height="8" rx="1" /><path d="M7 9V6a3 3 0 0 1 6 0v3" /></svg>
let useSessionNavigation = (toggleSort: () => void) => {
  let { ref, keys, input, query, setQuery, change } = usePickerNavigation(undefined, '', undefined, false)
  let [count, setCount] = useState(''), [mode, setMode] = useState('NORMAL')
  let normalRow = useRef<HTMLButtonElement | null>(null)
  let pendingG = useRef(false)
  let restoreNormalFocus = useRef(false)
  let focusMode = (event: FocusEvent<HTMLDivElement>) => { pendingG.current = false; setMode(event.target === input.current ? 'INSERT' : 'NORMAL') }
  useLayoutEffect(() => {
    if (!restoreNormalFocus.current) return
    restoreNormalFocus.current = false
    let row = normalRow.current?.isConnected ? normalRow.current : ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled):not([data-picker-action])')
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
  }, [query])
  useLayoutEffect(() => {
    let picker = ref.current!
    let updateNumbers = () => {
      let rows = [...picker.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([data-picker-action])')]
      let selected = rows.indexOf(document.activeElement as HTMLButtonElement)
      if (selected < 0) selected = document.activeElement === input.current ? 0 : rows.findIndex(row => row.dataset.active === 'true')
      rows.forEach((row, index) => {
        let number = row.querySelector<HTMLElement>('[data-session-number]')
        let value = String(Math.abs(index - Math.max(0, selected)))
        if (number && number.textContent !== value) number.textContent = value
      })
    }
    let observer = new MutationObserver(changes => { if (changes.some(change => !(change.target instanceof Element) || !change.target.closest('[data-session-number]'))) updateNumbers() })
    observer.observe(picker, { childList: true, subtree: true })
    picker.addEventListener('focusin', updateNumbers); updateNumbers()
    return () => { observer.disconnect(); picker.removeEventListener('focusin', updateNumbers) }
  })
  let sessionKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) { setCount(''); pendingG.current = false; return }
    if (event.nativeEvent.isComposing || event.metaKey || event.altKey) return
    let target = event.target as HTMLElement
    if (target.closest('[role="alertdialog"], select') || (target.tagName === 'INPUT' && target !== input.current)) return
    let editing = target === input.current
    if (!editing && !event.ctrlKey && event.key === 's') { event.preventDefault(); setCount(''); pendingG.current = false; toggleSort(); return }
    let rows = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([data-picker-action])')]
    let index = rows.indexOf(target as HTMLButtonElement)
    let focus = (position: number) => {
      let index = Math.max(0, Math.min(rows.length - 1, position)), row = rows[index], list = ref.current?.querySelector<HTMLElement>('[data-session-list]')
      row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
      if (list && index === 0) list.scrollTop = 0
      else if (list && index === rows.length - 1) list.scrollTop = list.scrollHeight
    }
    if (event.key === 'Escape' && (editing || count || pendingG.current)) {
      event.preventDefault(); event.stopPropagation(); setCount(''); pendingG.current = false
      if (editing) { if (normalRow.current?.isConnected) normalRow.current.focus(); else focus(0) }
      return
    }
    if (event.key === 'Escape' && query) {
      event.preventDefault(); event.stopPropagation(); restoreNormalFocus.current = true; setQuery(''); return
    }
    if (!editing && !event.ctrlKey && event.key === 'g') {
      event.preventDefault()
      if (pendingG.current) { focus(Number(count || 1) - 1); setCount(''); pendingG.current = false } else pendingG.current = true
      return
    }
    pendingG.current = false
    if (!editing && !event.ctrlKey && event.key === 'G') { event.preventDefault(); focus(count ? Number(count) - 1 : rows.length - 1); setCount(''); return }
    if (target.closest('[data-picker-action]')) return
    if (!editing && !event.ctrlKey && /^\d$/.test(event.key)) { event.preventDefault(); setCount((count + event.key).slice(0, 6)); return }
    if ((!editing && ['j', 'k'].includes(event.key)) || (event.ctrlKey && ['n', 'p', 'f', 'b'].includes(event.key))) {
      event.preventDefault()
      let direction = ['j', 'n', 'f'].includes(event.key) ? 1 : -1
      focus(Math.max(0, index) + direction * (event.ctrlKey ? ['f', 'b'].includes(event.key) ? 10 : 1 : Number(count || 1)))
      setCount(''); return
    }
    if ((!editing && event.key === 'x') || (event.ctrlKey && event.key === 'x')) {
      event.preventDefault(); setCount('')
      let row = editing ? rows[0] : target
      row?.closest('[data-session-target], [data-page-target]')?.querySelector<HTMLButtonElement>('button[aria-label^="Close "]')?.click()
      return
    }
    if (!editing && !event.ctrlKey && ['i', 'a', '/'].includes(event.key)) {
      event.preventDefault(); normalRow.current = target as HTMLButtonElement; setCount(''); input.current?.focus(); return
    }
    setCount('')
    keys(event)
  }
  return { ref, input, query, change, sessionKeys, focusMode, mode, count }
}
type SessionDrop = { id: string; position: 'before' | 'after' }
let SessionOrderContext = createContext<{ enabled: boolean; start: (id: string) => void; end: () => void; over: (event: DragEvent<HTMLElement>, id: string) => void; drop: (event: DragEvent<HTMLElement>, id: string) => void; target: SessionDrop | null } | null>(null)
let SessionPicker = () => {
  let { state, run } = useUI()
  let [previewId, setPreviewId] = useState<string | undefined>(() => selection(state).client?.windowId)
  let [busy, setBusy] = useState(false)
  let [creatingProfile, setCreatingProfile] = useState(false)
  let [newProfileName, setNewProfileName] = useState('')
  let [recent, setRecent] = useState(() => localStorage.getItem('session-sort-recent') === 'true')
  let [reordering, setReordering] = useState(false)
  let dragSource = useRef<string | null>(null)
  let [dropTarget, setDropTarget] = useState<SessionDrop | null>(null)
  let endDrag = () => { dragSource.current = null; setDropTarget(null) }
  let toggleReordering = () => { endDrag(); setReordering(!reordering); setRecent(false); localStorage.setItem('session-sort-recent', 'false') }
  let focusWindow = useRef<string | undefined>(undefined)
  let toggleSort = () => { endDrag(); setReordering(false); focusWindow.current = (document.activeElement as HTMLElement)?.dataset.windowRow ?? selection(state).client?.windowId; setRecent(!recent); localStorage.setItem('session-sort-recent', String(!recent)) }
  let { ref, input, query, change, sessionKeys, focusMode, mode, count } = useSessionNavigation(toggleSort)
  useLayoutEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLButtonElement>(`[data-window-row="${focusWindow.current}"]`)?.focus({ preventScroll: true })
  }, [recent])
  let [now, setNow] = useState(Date.now)
  useEffect(() => { let timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  let client = selection(state).client
  let previousSession = state.model.sessions.find(session => !session.ephemeral && session.id === client?.sessionHistory?.find(id => id !== client.sessionId && state.model.sessions.some(session => session.id === id && !session.ephemeral)))
  let backSession = previousSession && fuzzyMatch(query, `go back ${previousSession.name}`) ? previousSession : undefined
  let backFirst = !!backSession && !!query.trim() && (!!fuzzyMatch(query, 'back') || query.trim().toLowerCase() === 'go back')
  let localSessions = state.model.sessions.filter(session => !session.ephemeral)
  let sessions = searchSessions(localSessions, query)
  if (reordering) sessions.sort((a, b) => state.model.sessions.indexOf(a.session) - state.model.sessions.indexOf(b.session))
  let dragPosition = (event: DragEvent<HTMLElement>): SessionDrop['position'] => event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after'
  let dragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!reordering || !dragSource.current || dragSource.current === id) return
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
    setDropTarget({ id, position: dragPosition(event) })
  }
  let drop = (event: DragEvent<HTMLElement>, id: string) => {
    if (!reordering || !dragSource.current || dragSource.current === id) return
    event.preventDefault(); event.stopPropagation()
    void run('session.move', { session: dragSource.current, target: id, position: dragPosition(event) })
    endDrag()
  }
  let windows = recent ? searchRecentWindows(localSessions, query, client) : []
  let previewWindow = state.model.sessions.flatMap(session => session.windows).find(window => window.id === previewId)
  let previewRow = (target: Element) => {
    let row = target.closest<HTMLElement>('[data-preview-window], [data-preview-session]')
    let session = state.model.sessions.find(session => session.id === row?.dataset.previewSession)
    let window = session?.windows.find(window => window.id === client?.windowId) ?? session?.windows.slice().sort((a, b) => (windowVisitTime(b) ?? 0) - (windowVisitTime(a) ?? 0))[0]
    setPreviewId(row?.dataset.previewWindow ?? window?.id)
  }
  let previewFocus = (event: FocusEvent<HTMLDivElement>) => { focusMode(event); if (event.target !== input.current && !event.target.closest('[data-picker-action]')) previewRow(event.target) }
  let previewHover = (event: MouseEvent<HTMLDivElement>) => { if (event.target instanceof Element && event.target.closest('[data-preview-window], [data-preview-session]')) previewRow(event.target) }
  useLayoutEffect(() => {
    if (document.activeElement !== input.current) return
    let first = ref.current?.querySelector('[data-session-list] button:not([data-picker-action])')
    if (first) previewRow(first); else setPreviewId(undefined)
  }, [query, recent])
  let goBack = () => { if (client && previousSession) void run('switch-client', { client: client.id, session: previousSession.id }) }
  let backRow = backSession && <button className={`${css.listRow} ${css.sessionBack} ${css.sessionLabelRow}`} data-session-back data-preview-session={backSession.id} onClick={goBack} title={`go back: ${backSession.name}`}><SessionNumber /><span className={css.sessionLabelText}>go back: {backSession.name}</span>{backSession.private && <PrivateIcon />}</button>
  let create = async (privateSession: boolean) => {
    if (busy) return
    setBusy(true)
    await run('new-session', { client: state.clientId, private: privateSession, workspace: 'local' })
    setBusy(false)
  }
  let createRegular = () => { void create(false) }
  let createPrivate = () => { void create(true) }
  let changeNewProfileName = (event: ChangeEvent<HTMLInputElement>) => setNewProfileName(event.target.value)
  let openNewProfile = () => setCreatingProfile(true)
  let cancelNewProfile = () => { setCreatingProfile(false); setNewProfileName('') }
  let createProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !newProfileName.trim()) return
    setBusy(true)
    let profile = await run('profile.create', { name: newProfileName.trim() }) as Profile | undefined
    if (profile) { await run('session.new-profile.set', { profile: profile.id }); cancelNewProfile() }
    setBusy(false)
  }
  let picker = <div ref={ref} data-picker className={css.sessionPicker} onKeyDown={sessionKeys} onFocusCapture={previewFocus} onMouseOver={previewHover} role="group" aria-label="Choose session">
    <div className={css.sessionSearch}><span className={css.sessionMode} data-session-mode aria-label="Navigation mode">{mode}{count && ` ${count}`}&gt;</span><SearchInput ref={input} aria-label="Search sessions" value={query} onChange={change} /><button type="button" data-picker-action className={css.bookmarkReorder} aria-label="Reorder sessions" title="Reorder sessions" aria-pressed={reordering} onClick={toggleReordering}><BookmarkReorderIcon /></button><button className={css.sessionSort} data-picker-action aria-label="Sort by recently visited" aria-pressed={recent} title="Sort by recently visited (s)" onClick={toggleSort}>Recent <kbd>s</kbd></button></div>
    <div className={css.sessionList} data-session-list data-session-recent={recent || undefined}>
    {(backFirst || (!recent && !query.trim())) && backRow}
    {recent ? windows.map(window => <SessionWindowRow key={window.id} window={window} now={now} />) : sessions.map(result => <SessionTree key={result.session.id} result={result} now={now} query={query} />)}
    {!recent && !!query.trim() && !backFirst && backRow}
    {!!query && (recent ? !backFirst && !windows.length : !backSession && !sessions.length) && <p role="status">{recent ? 'No matching windows.' : 'No matching sessions.'}</p>}
    </div>
    <div className={css.sessionFooter}>
    {creatingProfile && <form className={css.sessionCreate} onSubmit={createProfile} aria-label="Create profile"><label>Profile name<input value={newProfileName} onChange={changeNewProfileName} autoFocus required /></label><div className={css.sessionCreateActions}><button type="submit" data-picker-action disabled={busy || !newProfileName.trim()}>Create profile</button><button type="button" data-picker-action onClick={cancelNewProfile}>Cancel</button></div></form>}
    <div className={css.sessionNewRow}><button className={`${css.listRow} ${css.newSession}`} onClick={createRegular} disabled={busy}><SessionNumber />new session</button><NewSessionProfile onCreate={openNewProfile} /></div>
    <button className={`${css.listRow} ${css.newSession} ${css.sessionLabelRow}`} onClick={createPrivate} disabled={busy} aria-label="new private session"><SessionNumber /><span className={css.sessionLabelText}>new private session</span><PrivateIcon /></button>
    </div>
  </div>
  let order = { enabled: reordering, start: (id: string) => { dragSource.current = id }, end: endDrag, over: dragOver, drop, target: dropTarget }
  return <SessionOrderContext.Provider value={order}><div className={css.sessionWorkspace}>{picker}<SessionPreview window={previewWindow} /></div></SessionOrderContext.Provider>
}
let SessionPreview = ({ window }: { window?: InternalWindow }) => <aside className={css.sessionPreview} aria-label="Session preview" data-preview-window={window?.id}>
  <div className={css.sessionPreviewTitle} title={window?.name}>{window?.name}</div>
  <div className={css.sessionPreviewPages}>{window?.layout && <SessionPreviewLayout node={window.layout} window={window} />}{window?.floating?.map(item => <SessionPreviewPage key={item.paneId} paneId={item.paneId} window={window} />)}</div>
</aside>
let SessionPreviewLayout = ({ node, window, snapshots }: { node: Layout; window: InternalWindow; snapshots?: Record<string, Snapshot> }) => {
  if (node.kind === 'pane') return <SessionPreviewPage paneId={node.paneId} window={window} snapshots={snapshots} />
  let tracks = `minmax(0, ${node.ratio}fr) minmax(0, ${1 - node.ratio}fr)`
  return <div className={css.sessionPreviewSplit} style={node.axis === 'horizontal' ? { gridTemplateColumns: tracks } : { gridTemplateRows: tracks }}><SessionPreviewLayout node={node.first} window={window} snapshots={snapshots} /><SessionPreviewLayout node={node.second} window={window} snapshots={snapshots} /></div>
}
let SessionPreviewPage = ({ paneId, window, snapshots }: { paneId: string; window: InternalWindow; snapshots?: Record<string, Snapshot> }) => {
  let { state } = useUI()
  let snapshot = (snapshots ?? state.snapshots)[paneId], pane = window.panes.find(pane => pane.id === paneId), title = pane?.title || pane?.url
  return <div className={css.sessionPreviewPage} data-preview-pane={paneId} title={title}>{snapshot && <img src={snapshot.image} alt={`Preview of ${title}`} />}</div>
}
let NewSessionProfile = ({ onCreate }: { onCreate: () => void }) => {
  let { state, run } = useUI()
  let change = (event: ChangeEvent<HTMLSelectElement>) => { void run('session.new-profile.set', { profile: event.target.value }) }
  let keys = (event: KeyboardEvent<HTMLSelectElement>) => { if (event.key !== 'Escape') event.stopPropagation() }
  return <div className={css.sessionProfilePreference}><select id="new-session-profile" aria-label="Profile for new regular sessions" value={state.model.newSessionProfileId ?? 'profile_default'} onChange={change} onKeyDown={keys}>{state.model.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button type="button" data-picker-action onClick={onCreate} aria-label="New profile" title="New profile">+</button></div>
}
let SessionTree = ({ result: { session, windows, matched }, now, query }: { result: ReturnType<typeof searchSessions>[number]; now: number; query: string }) => {
  let order = useContext(SessionOrderContext)!
  let dragOver = (event: DragEvent<HTMLDivElement>) => order.over(event, session.id)
  let drop = (event: DragEvent<HTMLDivElement>) => order.drop(event, session.id)
  return <SessionTreeView id={session.id} name={session.name} query={query} heading={matched ? <SessionRow id={session.id} name={session.name} privateSession={session.private === true} /> : <div className={css.sessionSearchParent}>{session.name}</div>} handle={order.enabled && <SessionDragHandle id={session.id} name={session.name} />} headingProps={{ 'data-drop-position': order.target?.id === session.id ? order.target.position : undefined, onDragOver: dragOver, onDrop: drop } as HTMLAttributes<HTMLDivElement>}>
    {windows.map(window => <SessionWindowRow key={window.id} window={window} now={now} />)}
  </SessionTreeView>
}
let SessionTreeView = ({ id, name, query, heading, handle, headingProps, remote, children }: { id: string; name: string; query: string; heading: ReactNode; handle?: ReactNode; headingProps?: HTMLAttributes<HTMLDivElement>; remote?: boolean; children: ReactNode }) => {
  let [expanded, setExpanded] = useState(true), ref = useRef<HTMLDivElement>(null)
  useEffect(() => setExpanded(true), [query])
  let changeExpanded = (next: boolean) => {
    if (!next && ref.current?.querySelector('[data-session-windows]')?.contains(document.activeElement)) ref.current.querySelector<HTMLButtonElement>('[data-session-row]')?.focus({ preventScroll: true })
    setExpanded(next)
  }
  let toggle = () => { changeExpanded(!expanded); ref.current?.querySelector<HTMLButtonElement>('[data-session-row]')?.focus({ preventScroll: true }) }
  let toggleMouse = (event: MouseEvent<HTMLDivElement>) => { if (event.target instanceof HTMLElement && event.target.closest('[role="alertdialog"]')) return; event.preventDefault(); toggle() }
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.altKey || event.ctrlKey || !(event.target instanceof HTMLElement) || event.target.closest('input, [role="alertdialog"], [data-picker-action]:not([data-session-toggle])') || !['h', 'l', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); changeExpanded(event.key === 'ArrowRight' ? !expanded : event.key === 'l')
  }
  return <div ref={ref} data-session-tree={id} data-remote-tree={remote ? id : undefined} onKeyDown={keys} onContextMenu={toggleMouse}>
    <div className={css.sessionTreeHeading} data-session-heading={id} {...headingProps}>{handle}<div className={css.sessionTreeHeader}>
      {heading}<button type="button" className={css.sessionToggle} data-picker-action data-session-toggle aria-label={`${expanded ? 'Collapse' : 'Expand'} windows in ${name}`} aria-expanded={expanded} onClick={toggle}><SessionTreeChevron /></button>
    </div></div>
    {expanded && <div className={css.sessionWindows} data-session-windows data-remote-pages={remote || undefined} role="group" aria-label={`Windows in ${name}`}>{children}</div>}
  </div>
}
let SessionDragHandle = ({ id, name }: { id: string; name: string }) => {
  let { run } = useUI(), order = useContext(SessionOrderContext)!
  let start = (event: DragEvent<HTMLButtonElement>) => { event.stopPropagation(); order.start(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }
  let keys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    void run('session.reorder', { session: id, direction: event.key === 'ArrowUp' ? 'up' : 'down' })
  }
  return <button type="button" data-picker-action className={css.bookmarkDragHandle} draggable onDragStart={start} onDragEnd={order.end} onKeyDown={keys} aria-label={`Drag session ${name} to reorder`} title="Drag to reorder; Option+Up/Down also moves one place"><svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1" /><circle cx="9" cy="3" r="1" /><circle cx="3" cy="8" r="1" /><circle cx="9" cy="8" r="1" /><circle cx="3" cy="13" r="1" /><circle cx="9" cy="13" r="1" /></svg></button>
}
let RemotePreviewSettings = () => {
  let { state, run } = useUI(), settings = state.remotePreviews ?? DEFAULT_REMOTE_PREVIEWS
  let updateMode = (event: ChangeEvent<HTMLSelectElement>) => { void run('settings.set', { key: 'remotePreviews.updates', value: event.target.value }) }
  let save = (event: ChangeEvent<HTMLInputElement>) => { void run('settings.set', { key: 'remotePreviews.saveLocally', value: event.target.checked }) }
  return <div className={css.remotePreviewSettings} role="group" aria-label="Remote preview settings"><label>Fetch previews<select aria-label="Fetch remote previews" value={settings.updates} onChange={updateMode}><option value="missing">When missing locally</option><option value="open">Refresh while open</option><option value="manual">Manually</option></select></label><label><input type="checkbox" checked={settings.saveLocally} onChange={save} />Save previews on this device</label><p>Private session previews stay in memory.</p></div>
}
let RemoteSessionPicker = () => {
  let [view, setView] = useState<'relay' | 'boxes' | 'settings' | null>(null)
  let origin = useRef<'relay' | 'boxes' | 'settings' | null>(null)
  let backToSessions = useCallback(() => setView(null), [])
  let back = useMemo(() => view ? { label: 'Back to remote sessions', run: backToSessions } : null, [view, backToSessions])
  usePanelBack(back)
  let open = (next: 'relay' | 'boxes' | 'settings') => { origin.current = next; setView(next) }
  if (view) return <div className={css.remoteAccountPage}>{view === 'settings' ? <><h3>Remote settings</h3><RemotePreviewSettings /></> : <DesktopRemoteAccount view={view} rent={view === 'boxes'} />}</div>
  return <RemoteSessionLibrary open={open} returnFocus={origin.current} />
}
let useRemotePreviewImages = (all: { host: RemoteHost; session: RemoteSession }[], settings: RemotePreviewSettings) => {
  let [images, setImages] = useState<Record<string, Record<string, Snapshot>>>({})
  let [refreshing, setRefreshing] = useState(false)
  let listingKey = JSON.stringify(all.map(({ host, session }) => [host.id, session.id, session.panes.map(pane => pane.id)]))
  useEffect(() => {
    let active = true, busy = false
    let save = (id: string, value: Record<string, Snapshot>) => { if (active) setImages(current => ({ ...current, [id]: value })) }
    let refresh = async () => {
      if (busy) return
      busy = true
      try {
        for (let { host, session } of all) {
          if (!active) return
          let cached = await bridge.remoteSessionPreviews(host.id, session.id, 'cache')
          save(`${host.id}:${session.id}`, cached)
        }
        if (settings.updates === 'manual') return
        for (let { host, session } of all) {
          if (!active) return
          let snapshots = await bridge.remoteSessionPreviews(host.id, session.id, settings.updates === 'open' ? 'refresh' : 'missing')
          save(`${host.id}:${session.id}`, snapshots)
        }
      } catch { /* Retain saved images when the connection is unavailable. */ }
      finally { busy = false }
    }
    void refresh()
    let timer = settings.updates === 'open' ? setInterval(() => { void refresh() }, 15000) : undefined
    return () => { active = false; clearInterval(timer) }
  }, [listingKey, settings.updates, settings.saveLocally])
  let refreshPreview = (host: string, session: string) => {
    if (refreshing) return
    setRefreshing(true)
    void bridge.remoteSessionPreviews(host, session, 'refresh').then(value => setImages(current => ({ ...current, [`${host}:${session}`]: value }))).catch(() => undefined).finally(() => setRefreshing(false))
  }
  return { images, refreshing, refreshPreview }
}
let useRemoteSessions = () => {
  let [remote, setRemote] = useState<RemoteSessionListing>()
  let refresh = () => bridge.remoteSessions().then(setRemote)
  useEffect(() => {
    let active = true
    let load = () => { void bridge.remoteSessions().then(listing => { if (active) setRemote(listing) }).catch(() => { if (active) setRemote(undefined) }) }
    load()
    let timer = setInterval(load, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return { remote, refresh }
}
let RemoteSessionLibrary = ({ open, returnFocus }: { open: (view: 'relay' | 'boxes' | 'settings') => void; returnFocus: 'relay' | 'boxes' | 'settings' | null }) => {
  let { state, dismiss, onMessage } = useUI()
  let settings = state.remotePreviews ?? DEFAULT_REMOTE_PREVIEWS
  let { remote, refresh } = useRemoteSessions()
  let [openingSignIn, setOpeningSignIn] = useState(false)
  let [recent, setRecent] = useState(() => localStorage.getItem('remote-session-sort-recent') === 'true')
  let [reordering, setReordering] = useState(false)
  let [order, setOrder] = useState<string[]>(() => { try { let value = JSON.parse(localStorage.getItem('remote-session-order') ?? '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [] } catch { return [] } })
  let [collapsed, setCollapsed] = useState<string[]>([])
  let [previewId, setPreviewId] = useState(() => localStorage.getItem('remote-session-last-active')), [previewWindowId, setPreviewWindowId] = useState<string>()
  let dragSource = useRef<string | null>(null)
  let [dropTarget, setDropTarget] = useState<SessionDrop | null>(null)
  let endDrag = () => { dragSource.current = null; setDropTarget(null) }
  let toggleSort = () => { endDrag(); setReordering(false); setRecent(!recent); localStorage.setItem('remote-session-sort-recent', String(!recent)) }
  let toggleReordering = () => { endDrag(); setReordering(!reordering); setRecent(false); localStorage.setItem('remote-session-sort-recent', 'false') }
  let { ref, input, query, change, sessionKeys, focusMode, mode, count } = useSessionNavigation(toggleSort)
  let machineView = useRemoteMachines(remote?.hosts ?? [], ref), machine = machineView.selected
  useEffect(() => { if (returnFocus) ref.current?.querySelector<HTMLButtonElement>(`[data-remote-action="${returnFocus}"]`)?.focus({ preventScroll: true }) }, [])
  let [lastActive, setLastActive] = useState(() => localStorage.getItem('remote-session-last-active'))
  let [now, setNow] = useState(Date.now)
  let restored = useRef(false)
  useEffect(() => { let timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  useLayoutEffect(() => {
    if (!remote || restored.current) return
    restored.current = true
    let row = ref.current?.querySelector<HTMLButtonElement>('[data-active="true"]')
    if (!returnFocus && row && document.activeElement === input.current) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }) }
  }, [remote])
  let all = remote?.hosts.flatMap(host => host.sessions.map(session => ({ host, session }))) ?? []
  let { images, refreshing, refreshPreview } = useRemotePreviewImages(all, settings)
  let sessions = all.filter(({ host, session }) => fuzzyMatch(query, `${session.name} ${host.service} ${host.machine?.name ?? ''} ${session.panes.map(pane => `${pane.title} ${pane.agentName ?? ''} ${pane.agentId ?? ''} ${pane.agentType ?? ''} ${pane.agentPurpose ?? ''} ${Object.values(pane.agentData ?? {}).join(' ')}`).join(' ')}`))
  let sessionKey = (host: string, session: string) => JSON.stringify(['session', host, session])
  let machineKey = (host: RemoteHost) => JSON.stringify(['machine', host.id])
  let rank = (key: string) => order.indexOf(key) < 0 ? order.length : order.indexOf(key)
  sessions.sort((a, b) => rank(sessionKey(a.host.id, a.session.id)) - rank(sessionKey(b.host.id, b.session.id)))
  let visited = (session: { lastActivityAt?: number }) => session.lastActivityAt
  if (recent) sessions.sort((a, b) => (visited(b.session) ?? 0) - (visited(a.session) ?? 0))
  let machineRank = (host: RemoteHost) => rank(order.includes(machineKey(host)) ? machineKey(host) : JSON.stringify(['service', host.service]))
  let machines = (remote?.hosts ?? []).filter(host => !query || sessions.some(item => item.host.id === host.id)).sort((a, b) => machineRank(a) - machineRank(b))
  let preview = all.find(({ host, session }) => `${host.id}:${session.id}` === previewId) ?? sessions[0]
  let move = (source: string, target: string, position: SessionDrop['position'], siblings: string[]) => {
    if (!siblings.includes(source) || source === target) return
    let next = siblings.filter(id => id !== source)
    next.splice(next.indexOf(target) + (position === 'after' ? 1 : 0), 0, source)
    let updated = [...order.filter(id => !siblings.includes(id)), ...next]
    setOrder(updated); localStorage.setItem('remote-session-order', JSON.stringify(updated)); endDrag()
  }
  let dragPosition = (event: DragEvent<HTMLElement>): SessionDrop['position'] => event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after'
  let dragProps = (id: string, siblings: string[]) => ({
    'data-drop-position': dropTarget?.id === id ? dropTarget.position : undefined,
    onDragOver: (event: DragEvent<HTMLElement>) => { if (!dragSource.current || !siblings.includes(dragSource.current) || dragSource.current === id) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget({ id, position: dragPosition(event) }) },
    onDrop: (event: DragEvent<HTMLElement>) => { if (!dragSource.current || !siblings.includes(dragSource.current)) return; event.preventDefault(); event.stopPropagation(); move(dragSource.current, id, dragPosition(event), siblings) },
  })
  let handle = (id: string, name: string, siblings: string[]) => reordering && <RemoteOrderHandle id={id} name={name} start={value => { dragSource.current = value }} end={endDrag} move={direction => { let target = siblings[siblings.indexOf(id) + direction]; if (target) move(id, target, direction < 0 ? 'before' : 'after', siblings) }} />
  let previewRow = (target: Element) => { let row = target.closest<HTMLElement>('[data-remote-session]'); if (row) { machineView.select(undefined); setPreviewId(row.dataset.remoteSession!); setPreviewWindowId(row.dataset.previewWindow) } }
  let previewFocus = (event: FocusEvent<HTMLDivElement>) => { focusMode(event); if (!event.target.closest('[data-picker-action]')) previewRow(event.target) }
  let previewHover = (event: MouseEvent<HTMLDivElement>) => { if (event.target instanceof Element && !event.target.closest('[data-picker-action]')) previewRow(event.target) }
  useLayoutEffect(() => { if (document.activeElement === input.current) { machineView.select(undefined); setPreviewId(sessions[0] ? `${sessions[0].host.id}:${sessions[0].session.id}` : null) } }, [query, recent])
  let openRemote = (host: string, session: string, pane?: string) => { void bridge.openRemote(host, session, pane).then(() => { rememberRemoteSession(host, session, pane); setLastActive(`${host}:${session}`); dismiss() }).catch(error => onMessage(error instanceof Error ? error.message : String(error))) }
  let signIn = () => {
    if (openingSignIn) return
    setOpeningSignIn(true)
    void bridge.openRemote().then(dismiss).catch(error => onMessage(error instanceof Error ? error.message : String(error))).finally(() => setOpeningSignIn(false))
  }
  let remoteKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'g' && event.target instanceof HTMLElement && !event.target.closest('input, select, [role="alertdialog"]')) { event.preventDefault(); open('relay'); return }
    if (event.key === 'Escape' && event.target === input.current && !query && !sessions.length) { event.preventDefault(); event.stopPropagation(); dismiss(); return }
    if (!event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && event.target instanceof HTMLElement && !event.target.closest('input, [role="alertdialog"]') && ['h', 'l', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      let group = event.target.closest<HTMLElement>('[data-remote-machine]'), host = group?.dataset.remoteMachine
      if (host) { event.preventDefault(); let close = event.key === 'h' || event.key === 'ArrowLeft'; if (close) group?.querySelector<HTMLButtonElement>('[data-machine-toggle]')?.focus(); setCollapsed(values => close ? [...new Set([...values, host])] : values.filter(value => value !== host)); return }
    }
    sessionKeys(event)
  }
  let picker = <div ref={ref} data-picker className={css.sessionPicker} onKeyDown={remoteKeys} onFocusCapture={previewFocus} onMouseOver={previewHover} role="group" aria-label="Choose remote session">
    <RemoteSessionActions open={open} />
    <div className={css.sessionSearch}><span className={css.sessionMode} data-session-mode aria-label="Navigation mode">{mode}{count && ` ${count}`}&gt;</span><SearchInput ref={input} aria-label="Search remote sessions" value={query} onChange={change} /><button type="button" data-picker-action className={css.bookmarkReorder} aria-label="Reorder remote sessions" title="Reorder remote sessions" aria-pressed={reordering} onClick={toggleReordering}><BookmarkReorderIcon /></button><button className={css.sessionSort} data-picker-action aria-label="Sort by recently visited" aria-pressed={recent} title="Sort by recently visited (s)" onClick={toggleSort}>Recent <kbd>s</kbd></button></div>
    <div className={css.sessionList} data-session-list>
    {machines.map(host => {
      let children = sessions.filter(item => item.host.id === host.id), expanded = !!query || !collapsed.includes(host.id), name = remoteMachineName(host, remote?.hosts ?? [])
      let siblings = children.map(({ host, session }) => sessionKey(host.id, session.id))
      let toggle = () => setCollapsed(values => expanded ? [...values, host.id] : values.filter(value => value !== host.id))
      let details = () => machineView.select(host.id), chevron = <SessionTreeChevron />
      return <div key={host.id} data-remote-machine={host.id} data-remote-service={host.service}>
        <div className={css.sessionTreeHeading} {...dragProps(machineKey(host), machines.map(machineKey))}>
          {handle(machineKey(host), `machine ${name}`, machines.map(machineKey))}
          <RemoteMachineHeading host={host} name={name} color={machineView.color(host.id)} expanded={expanded} toggle={toggle} details={details} chevron={chevron} />
        </div>
        {expanded && <div role="group" aria-label={`Sessions on ${name}`}>{children.map(({ host, session }) => <RemoteSessionTree key={`${host.id}:${session.id}`} host={host} session={session} active={lastActive === `${host.id}:${session.id}`} now={now} query={query} onSelect={openRemote} onClosed={refresh} dragProps={dragProps(sessionKey(host.id, session.id), siblings)} handle={handle(sessionKey(host.id, session.id), session.name, siblings)} />)}</div>}
      </div>
    })}
    {remote && !remote.authenticated && <button className={css.listRow} data-picker-action onClick={signIn} disabled={openingSignIn}>Sign in with Google</button>}
    {remote?.authenticated && !sessions.length && !query && <p className={css.sessionGroupEmpty}>No remote sessions.</p>}
    {remote?.authenticated && !sessions.length && !!query && <p role="status">No matching sessions.</p>}
    </div>
  </div>

  let changeMachineColor = (color: string) => { if (machine) machineView.save(machine.id, color) }
  let previewPanel = machine ? <aside className={css.sessionPreview} aria-label="Remote machine details"><RemoteMachineDetails host={machine} name={remoteMachineName(machine, remote?.hosts ?? [])} color={machineView.color(machine.id)} changeColor={changeMachineColor} back={machineView.back} /></aside> : <RemoteSessionPreview session={preview?.session} windowId={previewWindowId} snapshots={preview ? images[`${preview.host.id}:${preview.session.id}`] ?? {} : {}} refreshing={refreshing} refresh={() => { if (preview) refreshPreview(preview.host.id, preview.session.id) }} />
  return <div className={css.sessionWorkspace}>{picker}{previewPanel}</div>
}
let DesktopRemoteAccount = ({ rent = false, view = 'account' }: { rent?: boolean; view?: 'account' | 'relay' | 'boxes' }) => {
  let { dismiss } = useUI()
  let signIn = async () => { await bridge.openRemote(); dismiss() }
  let visit = async (url: string) => { await bridge.openRemoteBilling(url); dismiss() }
  let openBox = async (service: string) => {
    let listing = await bridge.remoteSessions(), host = listing.hosts.find(host => host.service === service), session = host?.sessions.find(session => session.panes.length)
    if (!host || !session) throw new Error('Box is connecting. Try again shortly.')
    await bridge.openRemote(host.id, session.id); rememberRemoteSession(host.id, session.id); dismiss()
  }
  return <RemoteAccount api={bridge.remoteAccount} visit={visit} signIn={signIn} openBox={openBox} rent={rent} view={view} local />
}
let RemoteSessionActions = ({ open }: { open: (view: 'relay' | 'boxes' | 'settings') => void }) => {
  let [computer, setComputer] = useState<RemoteComputer>()
  useEffect(() => {
    let active = true
    let load = () => { void bridge.remoteAccount<RemoteComputer>('/local/state').then(value => { if (active) setComputer(value) }).catch(() => { if (active) setComputer(undefined) }) }
    load()
    let timer = setInterval(load, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  let relay = () => open('relay'), boxes = () => open('boxes'), settings = () => open('settings')
  return <div className={css.remoteToolbar} role="group" aria-label="Remote actions"><button type="button" data-picker-action data-remote-action="relay" data-connected={!!computer?.connected} aria-label="Relay" title={computer?.connected ? 'Connected to relay (g)' : 'Relay (g)'} onClick={relay}><svg viewBox="0 0 16 16" role="img" aria-label={computer?.connected ? 'Connected to relay' : 'Relay disconnected'}><circle cx="8" cy="8" r="4" /></svg>Relay <kbd>g</kbd></button><button type="button" data-picker-action data-remote-action="boxes" onClick={boxes}>Add box</button><button type="button" data-picker-action data-remote-action="settings" className={css.remoteSettingsButton} aria-label="Remote session settings" title="Remote session settings" onClick={settings}><SettingsIcon /></button></div>
}
let RemoteOrderHandle = ({ id, name, start, end, move }: { id: string; name: string; start: (id: string) => void; end: () => void; move: (direction: number) => void }) => {
  let drag = (event: DragEvent<HTMLButtonElement>) => { event.stopPropagation(); start(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }
  let keys = (event: KeyboardEvent<HTMLButtonElement>) => { if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowUp' ? -1 : 1) } }
  return <button type="button" data-picker-action className={css.bookmarkDragHandle} draggable onDragStart={drag} onDragEnd={end} onKeyDown={keys} aria-label={`Drag remote ${name} to reorder`} title="Drag to reorder; Option+Up/Down also moves one place"><svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1" /><circle cx="9" cy="3" r="1" /><circle cx="3" cy="8" r="1" /><circle cx="9" cy="8" r="1" /><circle cx="3" cy="13" r="1" /><circle cx="9" cy="13" r="1" /></svg></button>
}
let remoteWindowModel = (window: RemoteWindow): InternalWindow => ({ ...window, panes: window.panes.map(pane => ({ ...pane, url: '', profileId: '', zoom: 1 })) })
let RemoteSessionTree = ({ host, session, active, now, query, onSelect, onClosed, dragProps, handle }: { host: RemoteHost; session: RemoteSession; active: boolean; now: number; query: string; onSelect: (host: string, session: string, pane?: string) => void; onClosed: () => Promise<unknown>; dragProps: HTMLAttributes<HTMLDivElement>; handle: ReactNode }) => <SessionTreeView id={`${host.id}:${session.id}`} name={session.name} query={query} remote headingProps={dragProps} handle={handle} heading={<RemoteSessionRow host={host.id} service={host.service} session={session.id} name={session.name} canClose={host.permission === 'control'} active={active} visitedAt={session.lastActivityAt} now={now} onSelect={onSelect} onClosed={onClosed} />}>
  {session.windows ? session.windows.map(window => <SessionWindowRow key={window.id} window={remoteWindowModel(window)} now={now} remote={{ host: host.id, session: session.id, active, select: onSelect }} />) : session.panes.map(pane => <RemotePageRow key={pane.id} host={host.id} session={session.id} pane={pane} active={active && localStorage.getItem('remote-session-last-pane') === pane.id} now={now} select={onSelect} canClose={host.permission === 'control'} onClosed={onClosed} />)}
</SessionTreeView>
let SessionTreeChevron = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
let RemotePageRow = ({ host, session, pane, active, now, select, canClose, onClosed }: { host: string; session: string; pane: RemoteSession['panes'][number]; active: boolean; now: number; select: (host: string, session: string, pane: string) => void; canClose: boolean; onClosed: () => Promise<unknown> }) => {
  let open = () => select(host, session, pane.id)
  let closing = useRemoteSessionClosing(host, session, onClosed, pane.id), name = pane.title || 'Blank page'
  return <div className={css.sessionRow} data-page-target data-remote-session={`${host}:${session}`} data-remote-pane={pane.id}>
    {closing.confirming ? <RemoteSessionConfirmation name={name} closing={closing} kind="page" /> : <><button ref={closing.row} type="button" className={`${css.listRow} ${css.remoteSession}`} data-session-row data-active={active} aria-current={active || undefined} onClick={open} title={pane.agentPurpose ?? pane.title}><SessionNumber /><span className={css.sessionBranch} data-session-branch aria-hidden="true" /><PageIcon /><span className={css.sessionWindowName}>{name}</span>{pane.lastActivityAt && <time className={css.sessionWindowActivity} data-age={activityAge(pane.lastActivityAt, now)} dateTime={new Date(pane.lastActivityAt).toISOString()} title={`Last used ${new Date(pane.lastActivityAt).toLocaleString()}`}>{activityLabel(pane.lastActivityAt, now)}</time>}</button>{canClose && <button className={css.sessionClose} data-picker-action onClick={closing.ask} aria-label={`Close remote page ${name}`}>x</button>}</>}
  </div>
}
let RefreshIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .5 5M16 3v5h-5" /></svg>
let RemoteSessionPreview = ({ session, windowId, snapshots, refreshing, refresh }: { session?: RemoteSession; windowId?: string; snapshots: Record<string, Snapshot>; refreshing: boolean; refresh: () => void }) => {
  let window = session?.windows?.find(window => window.id === windowId) ?? session?.windows?.[0]
  let previewWindow = window && remoteWindowModel(window)
  let [details, setDetails] = useState(false)
  let info = useRef<HTMLButtonElement>(null)
  let openDetails = () => setDetails(true)
  let closeDetails = useCallback(() => { setDetails(false); requestAnimationFrame(() => info.current?.focus({ preventScroll: true })) }, [])
  let back = useMemo(() => ({ label: 'Back to preview', run: closeDetails }), [closeDetails])
  useEffect(() => setDetails(false), [session?.id])
  let actors = session?.panes.filter(pane => pane.agentId || pane.agentName || pane.agentPurpose || pane.agentType || Object.keys(pane.agentData ?? {}).length) ?? []
  let keys = (event: KeyboardEvent<HTMLElement>) => { if (details && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDetails() } }
  return <aside className={css.sessionPreview} aria-label="Remote session preview" data-preview-session={session?.id} onKeyDown={keys}>
    <div className={css.remotePreviewHeading}>{details && <BackButton back={back} />}<span className={css.sessionPreviewTitle}>{details ? 'Agent info' : session?.name}</span>{!details && <><button type="button" className={css.remoteSettingsButton} aria-label="Refresh remote previews" title="Refresh remote previews" disabled={!session || refreshing} onClick={refresh}><RefreshIcon /></button>{!!actors.length && <button ref={info} type="button" aria-label="Show remote agent details" onClick={openDetails}>Agent info</button>}</>}</div>
    {details && !!actors.length ? <div className={`${css.agentInformation} ${css.remoteAgentDetails}`}>{actors.map(pane => <RemoteAgentDetails key={pane.id} pane={pane} />)}</div> : <div className={css.sessionPreviewPages}>{previewWindow ? <>{previewWindow.layout && <SessionPreviewLayout node={previewWindow.layout} window={previewWindow} snapshots={snapshots} />}{previewWindow.floating?.map(item => <SessionPreviewPage key={item.paneId} paneId={item.paneId} window={previewWindow} snapshots={snapshots} />)}</> : session?.panes.map(pane => <RemotePreviewPane key={pane.id} pane={pane} snapshot={snapshots[pane.id]} />)}</div>}
  </aside>
}
let RemoteAgentDetails = ({ pane }: { pane: RemoteSession['panes'][number] }) => <section aria-label={`Agent for ${pane.title}`}><strong>{pane.title}</strong><dl>{[['Name', pane.agentName], ['Agent ID', pane.agentId], ['Type', pane.agentType], ['Purpose', pane.agentPurpose], ...Object.entries(pane.agentData ?? {}).map(([key, value]) => [pane.agentFields?.[key] ?? key, value])].filter(([, value]) => value).map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl></section>
let RemotePreviewPane = ({ pane, snapshot }: { pane: RemoteSession['panes'][number]; snapshot?: Snapshot }) => <div className={css.remotePreviewPane} data-preview-pane={pane.id}>
  <div className={css.remotePreviewCaption} title={pane.agentPurpose}><span>{pane.title}</span>{(pane.agentName || pane.agentId) && <span className={css.remoteService}>{pane.agentName ?? pane.agentId}{pane.agentType && ` · ${pane.agentType}`}</span>}{pane.agentPurpose && <span>{pane.agentPurpose}</span>}</div>
  <div className={css.sessionPreviewPage}>{snapshot && <img src={snapshot.image} alt={`Preview of ${pane.title}`} title={`Captured ${new Date(snapshot.capturedAt).toLocaleString()}`} />}</div>
</div>
let rememberRemoteSession = (host: string, session: string, pane?: string) => {
  if (pane) localStorage.setItem('remote-session-last-pane', pane)
  localStorage.setItem('remote-session-last-active', `${host}:${session}`)
}
let useRemoteSessionClosing = (host: string, session: string, onClosed?: () => Promise<unknown>, pane?: string) => {
  let { onMessage } = useUI()
  let [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  let row = useRef<HTMLButtonElement>(null), confirmButton = useRef<HTMLButtonElement>(null), restoreRow = useRef(false)
  useLayoutEffect(() => {
    if (confirming) confirmButton.current?.focus()
    else if (restoreRow.current) { restoreRow.current = false; row.current?.focus({ preventScroll: true }) }
  }, [confirming])
  let restore = useRef<() => void>(() => {})
  let ask = () => { restore.current = pickerRemovalFocus(row.current, row.current?.closest(pane ? '[data-remote-pane]' : '[data-remote-tree]') ?? row.current?.closest('[data-session-target]')); setConfirming(true) }
  let cancel = () => { restoreRow.current = true; setConfirming(false) }
  let close = async () => {
    if (busy) return
    setBusy(true)
    try { if (pane) await bridge.closeRemotePage(host, session, pane); else await bridge.closeRemoteSession(host, session); await onClosed?.(); setConfirming(false); restore.current() }
    catch (error) { onMessage((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); cancel() }
    finally { setBusy(false) }
  }
  let confirmKeys = (event: KeyboardEvent<HTMLDivElement>) => { event.stopPropagation(); if (event.key === 'Escape' || event.key === 'n') { event.preventDefault(); cancel() } else if (event.key === 'y') { event.preventDefault(); void close() } }
  return { confirming, busy, row, confirmButton, ask, cancel, close, confirmKeys }
}
let RemoteSessionConfirmation = ({ name, closing, kind = 'session' }: { name: string; closing: ReturnType<typeof useRemoteSessionClosing>; kind?: 'session' | 'page' }) => <div className={css.sessionConfirm} onKeyDown={closing.confirmKeys} role="alertdialog" aria-label={`Close remote ${kind} ${name}?`}><span>Close remote {kind} "{name}"?</span><button ref={closing.confirmButton} data-picker-action onClick={closing.close} disabled={closing.busy}>yes</button><button data-picker-action onClick={closing.cancel} disabled={closing.busy}>no</button></div>
let RemoteSessionRow = ({ host, service, session, name, active, canClose, visitedAt, now, onSelect, onClosed }: { host: string; service: string; session: string; name: string; active: boolean; canClose: boolean; visitedAt?: number; now: number; onSelect: (host: string, session: string, pane?: string) => void; onClosed: () => Promise<unknown> }) => {
  let select = () => onSelect(host, session)
  let closing = useRemoteSessionClosing(host, session, onClosed)
  return <div className={`${css.sessionRow} ${css.remoteSessionRow}`} data-session-target data-preview-session={session} data-remote-session={`${host}:${session}`}>
    {closing.confirming ? <RemoteSessionConfirmation name={name} closing={closing} /> : <><button ref={closing.row} className={`${css.listRow} ${css.sessionLabelRow} ${css.remoteSession}`} data-session-row data-active={active} aria-current={active || undefined} onClick={select} title={`${name} on ${service}${active ? ' · Last active' : ''}`}><SessionNumber /><span className={css.sessionChevronSpace} aria-hidden="true" /><span className={css.sessionWindowName}>{name}</span>{visitedAt && <time className={css.sessionWindowActivity} data-age={activityAge(visitedAt, now)} dateTime={new Date(visitedAt).toISOString()} title={`Last used ${new Date(visitedAt).toLocaleString()}`}>{activityLabel(visitedAt, now)}</time>}</button>
    {canClose && <button className={css.sessionClose} data-picker-action onClick={closing.ask} aria-label={`Close remote session ${name}`}>x</button>}
    </>}
  </div>
}
let SessionNumber = () => <span className={css.sessionNumber} data-session-number aria-hidden="true" />
let SessionAgent = ({ window, sessionId }: { window?: InternalWindow; sessionId?: string }) => {
  let { state, show, setAgentDetails } = useUI()
  let session = state.model.sessions.find(session => session.id === sessionId)
  let actors = paneAgents(window?.panes ?? session?.windows.flatMap(window => window.panes) ?? [], state.activeAgents)
  if (!actors.length) return null
  let active = actors.some(actor => actor.active)
  let label = `${active ? 'Active agent' : 'Last agent'} in ${window?.name ?? session?.name}`
  let title = `${label}: ${actors.map(actor => actor.agentName ?? actor.agentId).join(', ')}`
  let open = () => { setAgentDetails(window ? { windowId: window.id } : { sessionId: sessionId! }); show('agent-info') }
  return <button type="button" className={css.sessionAgent} data-picker-action data-agent-active={active} aria-label={label} title={title} onClick={open}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="6" width="14" height="11" rx="2" /><path d="M10 2v4M7 10v2m6-2v2M7 15h6M1 10v4m18-4v4" /></svg></button>
}
let SessionAudio = ({ window, sessionId }: { window?: InternalWindow; sessionId?: string }) => {
  let { state, run } = useUI()
  let session = state.model.sessions.find(session => session.id === sessionId)
  let panes = window?.panes ?? session?.windows.flatMap(window => window.panes) ?? []
  let playing = panes.filter(pane => state.audio[pane.id]?.playing)
  if (!playing.length) return null
  let muted = playing.every(pane => state.audio[pane.id].muted)
  let label = `${muted ? 'Unmute' : 'Mute'} ${window ? 'window' : 'session'} ${window?.name ?? session?.name}`
  let toggle = () => { void run(window ? 'window.audio.toggle' : 'session.audio.toggle', window ? { window: window.id } : { session: sessionId }) }
  return <button type="button" className={css.sessionAudio} data-picker-action onClick={toggle} aria-label={label} title={label} data-muted={muted}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" />{muted ? <path d="m11 6 4 4m0-4-4 4" /> : <path d="M11 5c1.5 1 1.5 5 0 6m2-8c3 2 3 8 0 10" />}</svg></button>
}
let SessionRow = ({ id, name, privateSession }: { id: string; name: string; privateSession: boolean }) => {
  let { state, run, dismiss } = useUI()
  let locked = state.model.sessions.some(session => session.id === id && sessionIsLocked(session))
  let [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  let active = selection(state).client?.sessionId === id
  let select = async () => { if (await run('switch-client', { client: state.clientId, session: id }) && active) dismiss() }
  let row = useRef<HTMLButtonElement>(null)
  let confirmButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (confirming) confirmButton.current?.focus() }, [confirming])
  let restore = useRef<() => void>(() => {})
  let ask = () => { restore.current = pickerRemovalFocus(row.current, row.current?.closest('[data-session-tree]')); setConfirming(true) }
  let cancel = () => { setConfirming(false); requestAnimationFrame(() => row.current?.focus()) }
  let confirmKeys = (event: KeyboardEvent<HTMLDivElement>) => { event.stopPropagation(); if (event.key === 'Escape' || event.key === 'n') { event.preventDefault(); cancel() } else if (event.key === 'y') { event.preventDefault(); void close() } }
  let close = async () => {
    if (busy) return
    setBusy(true)
    let result = await run('kill-session', { session: id, confirm: true }) as { closed?: string } | undefined
    setBusy(false); setConfirming(false)
    if (!result?.closed) cancel(); else restore.current()
  }
  let confirmation = <div className={css.sessionConfirm} onKeyDown={confirmKeys} role="alertdialog" aria-label={`Close session ${name}?`}><span>Close session "{name}"?</span><button ref={confirmButton} data-picker-action onClick={close} disabled={busy}>yes</button><button data-picker-action onClick={cancel} disabled={busy}>no</button></div>
  return <div className={css.sessionRow} data-session-target data-preview-session={id}>{confirming ? confirmation : <><button className={`${css.listRow} ${css.sessionLabelRow}`} ref={row} data-session-row onClick={select} title={name}><SessionNumber /><span className={css.sessionChevronSpace} aria-hidden="true" /><span className={css.sessionLabelText}>{name}</span>{privateSession && <PrivateIcon />}</button><SessionAudio sessionId={id} /><SessionAgent sessionId={id} /><button className={css.sessionClose} data-picker-action onClick={ask} disabled={locked} aria-label={`Close session ${name}`} title={locked ? 'Unlock windows to close session' : undefined}>x</button></>}</div>
}
let SessionWindowRow = ({ window, now, remote }: { window: InternalWindow; now: number; remote?: { host: string; session: string; active: boolean; select: (host: string, session: string, pane: string) => void } }) => {
  let { state, run, dismiss } = useUI()
  let visitedAt = windowVisitTime(window)
  let pane = window.panes.find(pane => pane.id === (remote ? localStorage.getItem('remote-session-last-pane') : selection(state).client?.paneId)) ?? window.panes[0]
  let active = remote ? remote.active && window.panes.some(pane => pane.id === localStorage.getItem('remote-session-last-pane')) : selection(state).client?.windowId === window.id
  let name = window.automaticName === true ? pane?.title || pane?.url || window.name : window.name.trim() || pane?.title || pane?.url || 'Blank page'
  let [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  let row = useRef<HTMLButtonElement>(null)
  let confirmButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (confirming) confirmButton.current?.focus() }, [confirming])
  let select = async () => { if (remote && pane) { remote.select(remote.host, remote.session, pane.id); return }; if (await run('select-window', { client: state.clientId, window: window.id })) dismiss() }
  let restore = useRef<() => void>(() => {})
  let ask = () => { restore.current = pickerRemovalFocus(row.current, row.current?.closest('[data-remote-tree]') ?? row.current?.closest('[data-session-target]')); setConfirming(true) }
  let cancel = () => { setConfirming(false); requestAnimationFrame(() => row.current?.focus()) }
  let close = async () => { if (busy) return; setBusy(true); let result = await run('kill-window', { window: window.id, confirm: true }) as { closed?: string } | undefined; setBusy(false); setConfirming(false); if (!result?.closed) cancel(); else restore.current() }
  let confirmKeys = (event: KeyboardEvent<HTMLDivElement>) => { event.stopPropagation(); if (event.key === 'Escape' || event.key === 'n') { event.preventDefault(); cancel() } else if (event.key === 'y') { event.preventDefault(); void close() } }
  let confirmation = <div className={css.sessionConfirm} onKeyDown={confirmKeys} role="alertdialog" aria-label={`Close window ${name}?`}><span>Close window "{name}"?</span><button ref={confirmButton} data-picker-action onClick={close} disabled={busy}>yes</button><button data-picker-action onClick={cancel} disabled={busy}>no</button></div>
  return <div className={css.sessionRow} data-session-target data-preview-window={window.id} data-remote-session={remote && `${remote.host}:${remote.session}`} data-remote-pane={remote && pane?.id}>{confirming ? confirmation : <>
    <button ref={row} className={css.listRow} data-window-row={window.id} data-session-row={remote || undefined} data-active={active} aria-current={active || undefined} onClick={select}>
      <SessionNumber /><span className={css.sessionBranch} data-session-branch aria-hidden="true" /><PageIcon paneId={remote ? undefined : pane?.id} /><span className={css.sessionWindowName} data-window-label title={name}>{name}</span>
      {visitedAt && <time className={css.sessionWindowActivity} data-age={activityAge(visitedAt, now)} dateTime={new Date(visitedAt).toISOString()} title={`Last visited ${new Date(visitedAt).toLocaleString()}`}>{activityLabel(visitedAt, now)}</time>}
    </button>{!remote && <><SessionAudio window={window} /><SessionAgent window={window} /><button className={css.sessionClose} data-picker-action onClick={ask} disabled={window.locked} aria-label={`Close window ${name}`} title={window.locked ? 'Unlock window to close' : undefined}>x</button></>}
  </>}</div>
}
type DeviceSettingsProps = { profile: Profile; pane: { id: string; device?: Profile['device'] }; session: { device?: Profile['device'] } }
let DevicePresetSelect = ({ value, onChange }: { value: DevicePreset; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) => <select aria-label="Device" value={value} onChange={onChange}><option value="pixel-8">Pixel 8</option><option value="galaxy-s24">Galaxy S24</option><option value="iphone-15-pro">iPhone 15 Pro</option><option value="iphone-15-pro-max">iPhone 15 Pro Max</option><option value="custom">Custom</option></select>
let DeviceOrientationSelect = ({ value, onChange }: { value: DevicePersona['orientation']; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) => <select aria-label="Orientation" value={value} onChange={onChange}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
let DevicePlatformSelect = ({ value, onChange }: { value: DevicePlatform; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) => <select aria-label="Platform" value={value} onChange={onChange}><option value="android">Android</option><option value="ios">iOS</option></select>
type DeviceAutoSaveProps = { current?: DevicePersona; sessionDevice?: DevicePersona; draft: { device?: DevicePersona; error?: string }; newPanes: boolean; busy: boolean; form: RefObject<HTMLFormElement | null>; profileId: string; paneId: string; saveDevice: (device: DevicePersona, newPanes: boolean) => Promise<unknown> }
let useDeviceAutoSave = ({ current, sessionDevice, draft, newPanes, busy, form, profileId, paneId, saveDevice }: DeviceAutoSaveProps) => {
  let { run, onMessage } = useUI()
  let [focusRevision, setFocusRevision] = useState(0)
  let lastAutoSave = useRef('')
  let editingText = useRef(false)
  let pendingSave = useRef<{ device: DevicePersona; newPanes: boolean } | undefined>(undefined)
  let deviceKey = JSON.stringify(draft.device), currentKey = JSON.stringify(current), sessionKey = JSON.stringify(sessionDevice)
  let pendingSaveKey = `${deviceKey}:${newPanes}`
  let hasChanges = deviceKey !== currentKey || (newPanes ? sessionKey !== deviceKey : !!sessionKey)
  useEffect(() => {
    pendingSave.current = current && draft.device && hasChanges && !busy && form.current?.checkValidity() ? { device: draft.device, newPanes } : undefined
  })
  useEffect(() => () => {
    let pending = pendingSave.current
    if (pending) void run('profile.device.set', { profile: profileId, pane: paneId, ...pending })
  }, [profileId, paneId, run])
  useEffect(() => {
    if (!current || !draft.device || busy || !form.current?.checkValidity()) return
    if (!hasChanges || lastAutoSave.current === pendingSaveKey) return
    if (editingText.current) return
    let timer = setTimeout(() => { pendingSave.current = undefined; lastAutoSave.current = pendingSaveKey; void saveDevice(draft.device!, newPanes) }, 400)
    return () => clearTimeout(timer)
  }, [currentKey, draft.device, busy, hasChanges, pendingSaveKey, newPanes, saveDevice, focusRevision])
  let commitField = (event: FocusEvent<HTMLFormElement>) => {
    editingText.current = false
    setFocusRevision(revision => revision + 1)
    if (!current || busy || !form.current?.checkValidity()) return
    if (draft.error) { onMessage(draft.error); return }
    if (hasChanges && !form.current.contains(event.relatedTarget as Node | null)) {
      pendingSave.current = undefined
      lastAutoSave.current = pendingSaveKey
      void saveDevice(draft.device!, newPanes)
    }
  }
  let queueField = (event: ChangeEvent<HTMLFormElement>) => { editingText.current = event.target instanceof HTMLInputElement && event.target.type !== 'checkbox' }
  return { commitField, queueField }
}
let ProfileSection = ({ title, children }: { title: string; children: ReactNode }) => <section className={css.profileSection} aria-label={title}><div className={css.profileSectionHeading}><h2>{title}</h2></div>{children}</section>

let ProfileDeviceSettings = ({ profile, pane, session }: DeviceSettingsProps) => {
  let { run, onMessage } = useUI()
  let form = useRef<HTMLFormElement>(null)
  let current = pane.device
  let [active, setActive] = useState(!!current)
  let [preset, setPreset] = useSettingsState<DevicePreset>(`device:${pane.id}:preset`, current?.preset ?? 'pixel-8')
  let [platform, setPlatform] = useSettingsState<DevicePlatform>(`device:${pane.id}:platform`, current?.platform ?? 'android')
  let [width, setWidth] = useSettingsState(`device:${pane.id}:width`, String(current?.width ?? 412)), [height, setHeight] = useSettingsState(`device:${pane.id}:height`, String(current?.height ?? 915)), [dpr, setDpr] = useSettingsState(`device:${pane.id}:dpr`, String(current?.deviceScaleFactor ?? 2.625))
  let [orientation, setOrientation] = useSettingsState(`device:${pane.id}:orientation`, current?.orientation ?? 'portrait')
  let [locale, setLocale] = useSettingsState(`device:${pane.id}:locale`, current?.locale ?? navigator.language ?? 'en-US')
  let [timezone, setTimezone] = useSettingsState(`device:${pane.id}:timezone`, current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
  let [locationEnabled, setLocationEnabled] = useSettingsState(`device:${pane.id}:locationEnabled`, !!current?.geolocation)
  let [latitude, setLatitude] = useSettingsState(`device:${pane.id}:latitude`, String(current?.geolocation?.latitude ?? '')), [longitude, setLongitude] = useSettingsState(`device:${pane.id}:longitude`, String(current?.geolocation?.longitude ?? '')), [accuracy, setAccuracy] = useSettingsState(`device:${pane.id}:accuracy`, String(current?.geolocation?.accuracy ?? 100))
  let [busy, setBusy] = useState(false)
  let [newPanes, setNewPanes] = useSettingsState(`device:${pane.id}:newPanes`, !!session.device)
  let draft = useMemo(() => {
    try { return { device: parseDevicePersona({ preset, platform, width: Number(width), height: Number(height), deviceScaleFactor: Number(dpr), orientation, locale, timezone, ...(locationEnabled ? { geolocation: { latitude: Number(latitude), longitude: Number(longitude), accuracy: Number(accuracy) } } : {}) }) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [preset, platform, width, height, dpr, orientation, locale, timezone, locationEnabled, latitude, longitude, accuracy])
  let saveDevice = useCallback(async (device: DevicePersona, newPanes: boolean) => {
    setBusy(true)
    try { return await run('profile.device.set', { profile: profile.id, pane: pane.id, newPanes, device }) }
    finally { setBusy(false) }
  }, [profile.id, pane.id, run])
  useEffect(() => { if (!busy) setActive(!!current) }, [current, busy])
  let { commitField, queueField } = useDeviceAutoSave({ current, sessionDevice: session.device, draft, newPanes, busy, form, profileId: profile.id, paneId: pane.id, saveDevice })
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
  let changeNewPanes = (event: ChangeEvent<HTMLInputElement>) => setNewPanes(event.target.checked)
  let changeActive = async (event: ChangeEvent<HTMLInputElement>) => {
    if (busy) return
    if (event.target.checked) {
      if (!form.current?.reportValidity()) return
      if (!draft.device) { onMessage(draft.error ?? 'Check the device settings'); return }
      setActive(true)
      if (!await saveDevice(draft.device, newPanes)) setActive(!!current)
      return
    }
    setActive(false); setBusy(true)
    try { if (await run('profile.device.clear', { profile: profile.id, pane: pane.id })) setNewPanes(false); else setActive(!!current) }
    finally { setBusy(false) }
  }
  let preventSubmit = (event: FormEvent) => { event.preventDefault(); if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur() }
  let deviceFields = <fieldset className={css.deviceFields} disabled={busy}>
    <ProfileSection title="Screen"><div className={css.profileDeviceGrid}>
      <label>Device<DevicePresetSelect value={preset} onChange={changePreset} /></label>
      <label>Orientation<DeviceOrientationSelect value={orientation} onChange={changeOrientation} /></label>
    </div>
    {preset === 'custom' && <div className={css.profileDeviceGrid}>
      <label>Platform<DevicePlatformSelect value={platform} onChange={changePlatform} /></label>
      <label>Width<input className={css.pluginInput} type="number" min="240" max="1440" value={width} onChange={changeWidth} required /></label>
      <label>Height<input className={css.pluginInput} type="number" min="320" max="2560" value={height} onChange={changeHeight} required /></label>
      <label>DPR<input className={css.pluginInput} type="number" min="1" max="4" step="0.125" value={dpr} onChange={changeDpr} required /></label>
    </div>}
    </ProfileSection>
    <ProfileSection title="Language and location"><div className={css.profileDeviceGrid}>
      <label>Locale<input className={css.pluginInput} value={locale} onChange={changeLocale} required spellCheck={false} /></label>
      <label>Timezone<input className={css.pluginInput} value={timezone} onChange={changeTimezone} required spellCheck={false} /></label>
    </div>
    <label className={css.profileProxyAuthentication}><input type="checkbox" checked={locationEnabled} onChange={changeLocationEnabled} />Set geolocation</label>
    {locationEnabled && <div className={css.profileDeviceLocation}><label>Latitude<input className={css.pluginInput} type="number" min="-90" max="90" step="any" value={latitude} onChange={changeLatitude} required /></label><label>Longitude<input className={css.pluginInput} type="number" min="-180" max="180" step="any" value={longitude} onChange={changeLongitude} required /></label><label>Accuracy<input className={css.pluginInput} type="number" min="0" max="100000" step="any" value={accuracy} onChange={changeAccuracy} required /></label></div>}
    </ProfileSection>
    <ProfileSection title="New panes"><label className={css.profileProxyAuthentication}><input type="checkbox" checked={newPanes} onChange={changeNewPanes} />Enable for all new panes</label></ProfileSection>
    </fieldset>
  return <form ref={form} className={css.deviceSettings} onSubmit={preventSubmit} onBlur={commitField} onChange={queueField}>
    <ProfileSection title="Device emulation"><label className={css.deviceActive}><input className={css.proxyToggle} type="checkbox" role="switch" checked={active} onChange={changeActive} disabled={busy} />Mobile device</label>
    </ProfileSection>
    {deviceFields}
    {draft.device && <ProfileSection title="Emulation details"><DeviceEmulationDetails device={draft.device} active={!!current} /></ProfileSection>}
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

let ProxyProviderSelect = ({ value, entries, onChange }: { value: string; entries: ProxyProviderEntry[]; onChange: (event: ChangeEvent<HTMLSelectElement>) => void }) => <select aria-label="Provider" value={value} onChange={onChange}><option value="custom">Custom</option>{entries.map(entry => <option key={entry.key} value={entry.key}>{entry.provider.title}</option>)}</select>

let ProxyHostOption = ({ region, entry, onChoose }: { region: PluginProxyRegion; entry: ProxyProviderEntry; onChoose: (region: PluginProxyRegion, entry: ProxyProviderEntry) => void }) => {
  let choose = () => onChoose(region, entry)
  return <button type="button" onClick={choose}><span>{region.label}</span><small>{region.host}:{region.port}</small></button>
}

let ProxyHostPicker = ({ protocol, entries, onChoose, onClose }: { protocol: PluginProxyRegion['protocol']; entries: ProxyProviderEntry[]; onChoose: (region: PluginProxyRegion, entry: ProxyProviderEntry) => void; onClose: () => void }) => {
  let dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { let element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  let handleKey = (event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault()
  }
  let [query, setQuery] = useState('')
  let [providerKey, setProviderKey] = useState('')
  let available = entries.filter(entry => entry.provider.regions.some(region => region.protocol === protocol))
  let selected = available.find(entry => entry.key === providerKey)
  let regions = selected?.provider.regions.filter(region => region.protocol === protocol && `${region.group} ${region.label} ${region.host}`.toLowerCase().includes(query.toLowerCase())) ?? []
  let groups = [...new Set(regions.map(region => region.group))]
  let changeQuery = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  let chooseProvider = (event: ChangeEvent<HTMLSelectElement>) => setProviderKey(event.target.value)
  return <dialog ref={dialog} className={css.proxyHostPicker} aria-label="Proxy providers" onKeyDown={handleKey} onCancel={onClose}>
    <PanelHeader back={{ label: 'Back to proxy settings', run: onClose }} dismiss={onClose}><strong>Choose a {protocol.toUpperCase()} host</strong></PanelHeader>
    <label>Provider<select aria-label="Host provider" value={providerKey} onChange={chooseProvider}><option value="">Choose provider</option>{available.map(entry => <option key={entry.key} value={entry.key}>{entry.provider.title}</option>)}</select></label>
    {!available.length && <p>No providers available for this protocol.</p>}
    {selected && <><input aria-label="Search proxy locations" placeholder="Search country, city or host" value={query} onChange={changeQuery} />
      <div className={css.proxyHostResults}>{groups.map(group => <section key={group} aria-label={group}><h3>{group}</h3>{regions.filter(region => region.group === group).map(region => <ProxyHostOption key={region.host} region={region} entry={selected} onChoose={onChoose} />)}</section>)}{!regions.length && <p>No matching locations.</p>}</div></>}
  </dialog>
}

let useProxyDefault = (args: Record<string, unknown>, onSaved: (profile: Profile) => void) => {
  let { run, onMessage } = useUI()
  let [saving, setSaving] = useState(false)
  let changeNewPanes = async (event: ChangeEvent<HTMLInputElement>) => {
    let enabled = event.target.checked
    if (saving || enabled && !event.target.form?.reportValidity()) return
    onMessage(''); setSaving(true)
    try {
      if (!enabled) { await run('profile.proxy.clear', { profile: args.profile }); return }
      let result = await run('profile.proxy.set', args)
      if (result) onSaved(result as Profile)
    } finally { setSaving(false) }
  }
  return { saving, changeNewPanes }
}

let ProxySettings = ({ profile, paneCount, showRegion = false }: { profile: Profile; paneCount: number; showRegion?: boolean }) => {
  let { state, run, onMessage } = useUI()
  let providers = proxyProviderEntries(state)
  let configuredProvider = providers.find(entry => entry.provider.regions.some(region => matchesProxyRegion(region, profile)))
  let configuredRegion = configuredProvider?.provider.regions.find(region => matchesProxyRegion(region, profile))?.host ?? ''
  let [providerKey, setProviderKey] = useSettingsState(`proxy:${profile.id}:providerKey`, configuredProvider?.key ?? 'custom')
  let [providerRegion, setProviderRegion] = useSettingsState(`proxy:${profile.id}:providerRegion`, configuredRegion)
  let [protocol, setProtocol] = useSettingsState(`proxy:${profile.id}:protocol`, profile?.proxy?.protocol ?? 'https')
  let [host, setHost] = useSettingsState(`proxy:${profile.id}:host`, profile?.proxy?.host ?? '')
  let [port, setPort] = useSettingsState(`proxy:${profile.id}:port`, String(profile?.proxy?.port ?? 443))
  let [authenticated, setAuthenticated] = useSettingsState(`proxy:${profile.id}:authenticated`, profile?.proxy?.authenticated ?? true)
  let [username, setUsername] = useSettingsState(`proxy:${profile.id}:username`, ''), [password, setPassword] = useSettingsState(`proxy:${profile.id}:password`, '')
  let [testing, setTesting] = useState(false)
  let form = useRef<HTMLFormElement>(null)
  let [credentialProfile, setCredentialProfile] = useSettingsState(`proxy:${profile.id}:credentialProfile`, defaultConnectionId(profile)), [savedUsername, setSavedUsername] = useSettingsState(`proxy:${profile.id}:savedUsername`, '')
  let [pickerOpen, setPickerOpen] = useSettingsState(`proxy:${profile.id}:pickerOpen`, false)
  let savedProfiles = savedProxyProfiles(state.model)
  useEffect(() => {
    if (!credentialProfile) return
    let cancelled = false
    void run('profile.proxy.username', { profile: credentialProfile }).then(result => {
      if (!cancelled && result) { let value = (result as { username: string }).username; setUsername(current => current === savedUsername ? value : current); setSavedUsername(value) }
    })
    return () => { cancelled = true }
  }, [credentialProfile, run])
  let reuseCredentials = (source: Profile | undefined) => { let next = source?.id ?? ''; if (next !== credentialProfile) setUsername(''); setCredentialProfile(next); setPassword('') }
  let applyRegion = (region: PluginProxyRegion, entry: ProxyProviderEntry) => {
    setProviderKey(entry.key); setProviderRegion(region.host); setHost(region.host); setProtocol(region.protocol); setPort(String(region.port)); setAuthenticated(entry.provider.authenticated)
    reuseCredentials(savedProfiles.find(item => item.proxy?.authenticated && entry.provider.regions.some(candidate => matchesProxyRegion(candidate, item))))
  }
  let chooseRegion = (region: PluginProxyRegion, entry: ProxyProviderEntry) => { applyRegion(region, entry); setPickerOpen(false) }
  let openProviders = () => { if (!host) setPickerOpen(true) }
  let closeProviders = () => setPickerOpen(false)
  let changeSavedProxy = (event: ChangeEvent<HTMLSelectElement>) => {
    let source = savedProfiles.find(item => item.id === event.target.value)
    if (!source?.proxy) return
    let entry = providers.find(item => item.provider.regions.some(region => matchesProxyRegion(region, source)))
    setProviderKey(entry?.key ?? 'custom'); setProviderRegion(entry ? source.proxy.host : '')
    setProtocol(source.proxy.protocol); setHost(source.proxy.host); setPort(String(source.proxy.port)); setAuthenticated(source.proxy.authenticated)
    reuseCredentials(source)
  }
  let [tested, setTested] = useState<{ ip: string; region?: string }>(), testRevision = useRef(0)
  useEffect(() => { testRevision.current++; setTested(undefined) }, [protocol, host, port, authenticated, username, password, credentialProfile])
  let savedEndpoint = protocol === profile.proxy?.protocol && host === profile.proxy?.host && Number(port) === profile.proxy?.port && authenticated === profile.proxy?.authenticated && !password && username === savedUsername && credentialProfile === defaultConnectionId(profile)
  let proxyTest = tested ?? (savedEndpoint ? state.profileProxyTests[defaultConnectionId(profile)] : undefined)
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
    reuseCredentials(savedProfiles.find(item => item.proxy?.authenticated && selectedProvider?.regions.some(candidate => matchesProxyRegion(candidate, item))))
  }
  let changeProviderRegion = (event: ChangeEvent<HTMLSelectElement>) => {
    let region = provider?.regions.find(item => item.host === event.target.value)
    if (!region) return
    if (providerEntry) applyRegion(region, providerEntry)
  }
  let changeProtocol = (event: ChangeEvent<HTMLSelectElement>) => { let value = event.target.value as 'http' | 'https' | 'socks5'; setProtocol(value); if (!profile.proxy) setPort(value === 'http' ? '80' : value === 'https' ? '443' : '1080') }
  let changeHost = (event: ChangeEvent<HTMLInputElement>) => { setHost(event.target.value); if (event.target.value) setPickerOpen(false) }
  let changePort = (event: ChangeEvent<HTMLInputElement>) => setPort(event.target.value)
  let changeAuthenticated = (event: ChangeEvent<HTMLInputElement>) => setAuthenticated(event.target.checked)
  let changeUsername = (event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)
  let changePassword = (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)
  let proxyArgs = { profile: profile.id, protocol, host, port: Number(port), authenticated, username, password, credentialProfile }
  let proxySaved = (saved: Profile) => { setCredentialProfile(defaultConnectionId(saved)); setSavedUsername(username); setPassword('') }
  let { saving, changeNewPanes } = useProxyDefault(proxyArgs, proxySaved)
  let preventSubmit = (event: FormEvent) => event.preventDefault()
  let testProxy = async () => {
    if (testing || !form.current?.reportValidity()) return
    onMessage(''); setTesting(true); let revision = testRevision.current
    setTested(undefined)
    try {
      let result = await run('profile.proxy.test', proxyArgs)
      if (result && revision === testRevision.current) setTested(result as { ip: string; region?: string })
    } finally { setTesting(false) }
  }
  return <form ref={form} className={`${css.profileProxy} ${css.profileSection}`} aria-label="Proxy for new panes" onSubmit={preventSubmit}>
      <h2>Proxy for new panes</h2>
      <div className={css.proxyFields}>
      <p>{profile.proxy ? `${profile.proxy.protocol}://${profile.proxy.host}:${profile.proxy.port}` : 'Use the system connection'}. Used for new panes. {paneCount} existing pane{paneCount === 1 ? ' keeps' : 's keep'} their current connection.</p>
      {savedProfiles.length > 0 && <label className={css.savedProxy}>Saved proxies (all profiles)<select aria-label="Saved proxies" value="" onChange={changeSavedProxy}><option value="" disabled>Choose a saved proxy</option>{savedProfiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.proxy!.protocol}://{item.proxy!.host}:{item.proxy!.port}</option>)}</select></label>}
      <div className={css.profileProxyProvider}><label>Provider<ProxyProviderSelect value={providerEntry ? providerKey : 'custom'} entries={providers} onChange={changeProvider} /></label>{provider && <label>Region<ProxyRegionSelect regions={provider.regions} value={providerRegion} onChange={changeProviderRegion} /></label>}</div>
      {!provider && <div className={css.profileProxyEndpoint}><label>Protocol<ProxyProtocolSelect value={protocol} onChange={changeProtocol} /></label><label>Host<input className={css.pluginInput} value={host} onChange={changeHost} onClick={openProviders} autoComplete="off" spellCheck={false} required /></label><label>Port<input className={css.pluginInput} type="number" min="1" max="65535" value={port} onChange={changePort} required /></label></div>}
      {pickerOpen && <ProxyHostPicker protocol={protocol} entries={providers} onChoose={chooseRegion} onClose={closeProviders} />}
      {provider ? <p>Uses {protocol.toUpperCase()} proxy on port {port}. {provider.help}</p> : <label className={css.profileProxyAuthentication}><input type="checkbox" checked={authenticated} onChange={changeAuthenticated} />Proxy requires authentication</label>}
      {authenticated && <div className={css.profileProxyCredentials}><label>Username<input className={css.pluginInput} value={username} onChange={changeUsername} autoComplete="off" spellCheck={false} placeholder={savedProfiles.find(item => item.id === credentialProfile)?.proxy?.authenticated ? 'Leave blank to keep saved credentials' : ''} /></label><label>Password<input className={css.pluginInput} type="password" value={password} onChange={changePassword} autoComplete="new-password" placeholder={savedProfiles.find(item => item.id === credentialProfile)?.proxy?.authenticated ? 'Leave blank to keep saved credentials' : ''} /></label></div>}
      {proxyTest && <ProxyTestSuccess ip={proxyTest.ip} region={showRegion ? proxyTest.region : undefined} />}
      </div>
      <div className={`${css.profileProxyActions} ${css.proxyFooter}`}><label className={css.proxyDefault}><input className={css.proxyToggle} type="checkbox" role="switch" checked={savedEndpoint} onChange={changeNewPanes} disabled={saving} />Use for new panes</label><button type="button" aria-label="Test connection" onClick={testProxy} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</button></div>
    </form>
}

let ProxyInfo = () => {
  let { state } = useUI()
  let { profile, pane } = selection(state)
  if (!profile) return <p>No profile is selected.</p>
  let current = pane ? connectionProfile(state.model, paneConnectionId(pane)) : profile
  let paneCount = state.model.sessions.flatMap(item => item.windows.flatMap(item => item.panes)).filter(item => item.profileId === profile.id).length
  return <section className={css.profileInfo} aria-label={`${profile.name} proxy settings`}>
    <div className={css.profileHeading}><ProfileConnectionIcon proxy={!!current.proxy} verified={!!state.profileProxyTests[current.id]} /><strong>{profile.name}</strong></div>
    <p>This pane: {current.proxy ? `${current.proxy.protocol}://${current.proxy.host}:${current.proxy.port}` : 'system connection'}</p>
    <ProxySettings key={profile.id} profile={profile} paneCount={paneCount} showRegion />
  </section>
}

let useAutomationExpiry = (safety?: AutomationSafetyState) => {
  let [now, setNow] = useState(Date.now)
  useEffect(() => {
    let expiries = [
      ...Object.values(safety?.limits.sites ?? {}).flatMap(sites => Object.values(sites)).map(automationSiteExclusion).filter(rule => rule?.enabled && rule.expiresAt !== null).map(rule => rule!.expiresAt!),
      ...(safety?.profiles ?? []).flatMap(usage => usage.retryAfter ? [Date.parse(usage.retryAfter)] : []),
    ].filter(expiry => expiry > Date.now())
    if (!expiries.length) return
    let timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(1, Math.min(...expiries) - Date.now())))
    return () => clearTimeout(timer)
  }, [safety, now])
}

let AutomationWebsiteSelect = ({ profileId, host, resetSession }: { profileId: string; host: string; resetSession: boolean }) => {
  let { run } = useUI(), [busy, setBusy] = useState(false)
  let choose = async (event: ChangeEvent<HTMLSelectElement>) => {
    let action = event.target.value
    setBusy(true)
    try {
      if (action === 'reset') await run('automation.reset-session', { profile: profileId, host })
      else await run('profile.anti-bot.site.set', { profile: profileId, host, enabled: false, durationMinutes: action === 'permanent' ? null : Number(action) })
    } finally { setBusy(false) }
  }
  return <label className={css.notificationSiteExclusion}><span>{host}</span><span className={css.notificationSiteMenu}><select className={css.notificationAction} onChange={choose} value="" disabled={busy} aria-label={`Automation actions for ${host}`}><option value="" disabled hidden />{resetSession && <option value="reset">Reset session</option>}<optgroup label="Disable Bot protection"><option value="15">For 15 minutes</option><option value="60">For 1 hour</option><option value="permanent">Until removed</option></optgroup></select><AlertChevron collapsed /></span></label>
}

let SiteExclusionRow = ({ profileId, host, exclusion }: { profileId: string; host: string; exclusion: AutomationSiteExclusion }) => {
  let { run } = useUI(), [busy, setBusy] = useState(false)
  let temporary = exclusion.expiresAt !== null
  let status = temporary ? automationExclusionActive(exclusion) ? `Temporary · Until ${new Date(exclusion.expiresAt!).toLocaleString()}` : 'Expired · Bot protection is on' : undefined
  let remove = async () => {
    setBusy(true)
    try { await run('profile.anti-bot.site.remove', { profile: profileId, host }) } finally { setBusy(false) }
  }
  let keep = async () => {
    setBusy(true)
    try { await run('profile.anti-bot.site.set', { profile: profileId, host, enabled: false }) } finally { setBusy(false) }
  }
  return <div className={css.siteExclusion} role="group" aria-label={host}><span>{host}{status && <small>{status}</small>}</span>{temporary && <button type="button" onClick={keep} disabled={busy} aria-label={`Keep ${host} excluded`}>Keep excluded</button>}<button type="button" onClick={remove} disabled={busy} aria-label={`Remove exclusion for ${host}`}>Remove</button></div>
}

type BotProfileProps = { profile: Profile; pane?: ReturnType<typeof selection>['pane'] }

let profileSiteExclusions = (state: PublicState, profileId: string) => Object.entries(state.automationSafety?.limits.sites?.[profileId] ?? {}).flatMap(([host, entry]) => {
  let exclusion = automationSiteExclusion(entry)
  return exclusion?.enabled ? [{ host, exclusion }] : []
})

let ProfileExcludedWebsites = ({ profile, pane }: BotProfileProps) => {
  let { state, run } = useUI()
  let [website, setWebsite] = useSettingsState(`profile:${profile?.id}:excluded-website`, () => automationWebsiteHost(pane?.url) ?? '', false), [busy, setBusy] = useState(false)
  let [expanded, setExpanded] = useState(false), [query, setQuery] = useState('')
  let toggleButton = useRef<HTMLButtonElement>(null), editorId = useId()
  if (!profile) return null
  let exclusions = profileSiteExclusions(state, profile.id)
  let matching = exclusions.filter(({ host }) => host.toLowerCase().includes(query.trim().toLowerCase()))
  let toggle = () => { setExpanded(value => !value); setQuery('') }
  let search = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  let keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !expanded) return
    event.preventDefault(); event.stopPropagation()
    if (query) setQuery('')
    else { setExpanded(false); toggleButton.current?.focus() }
  }
  let change = (event: ChangeEvent<HTMLInputElement>) => { setWebsite(event.target.value); event.target.setCustomValidity('') }
  let add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    let input = event.currentTarget.elements.namedItem('website') as HTMLInputElement
    let host = automationWebsiteHost(website.includes('://') ? website.trim() : `https://${website.trim()}`)
    if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) { input.setCustomValidity('Enter a website hostname or URL'); input.reportValidity(); return }
    setBusy(true)
    try { if (await run('profile.anti-bot.site.set', { profile: profile.id, host, enabled: false })) setWebsite('') } finally { setBusy(false) }
  }
  let editor = <div id={editorId} className={css.siteExclusionEditor}>
    <p>Bot protection is off for these websites in this profile.</p>
    <form className={css.siteExclusionAdd} onSubmit={add}><label>Website<input className={css.pluginInput} name="website" value={website} onChange={change} placeholder="example.com" disabled={busy} required /></label><button type="submit" disabled={busy || !website.trim()}>Add</button></form>
    {(exclusions.length > 5 || query) && <SearchInput aria-label="Search excluded websites" value={query} onChange={search} />}
    <div className={css.siteExclusionList} role="group" aria-label="Excluded website list" tabIndex={0}>
      {matching.map(({ host, exclusion }) => <SiteExclusionRow key={host} profileId={profile.id} host={host} exclusion={exclusion} />)}
      {!matching.length && <p role="status">{query ? 'No matching websites.' : 'No excluded websites.'}</p>}
    </div>
  </div>
  return <section className={`${css.profileSection} ${css.siteExclusions}`} aria-label="Excluded websites" onKeyDown={keys}>
    <div className={css.siteExclusionSummary}>
      <div><h2>Excluded websites</h2><span>{exclusions.length ? `${exclusions.length} ${exclusions.length === 1 ? 'website' : 'websites'}` : 'No excluded websites'}</span></div>
      <button ref={toggleButton} type="button" onClick={toggle} aria-expanded={expanded} aria-controls={editorId}>{expanded ? 'Show less' : 'Show all'}</button>
    </div>
    {expanded && editor}
  </section>
}

let AutomationLimitInput = ({ profileId, setting, label, description, value, scale = 1, maximum }: { profileId: string; setting: AutomationSafetyLimitKey; label: string; description: string; value: number; scale?: number; maximum: number }) => {
  let { run } = useUI(), [text, setText] = useState(String(value / scale)), [busy, setBusy] = useState(false)
  useEffect(() => { setText(String(value / scale)) }, [value, scale])
  let change = (event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)
  let save = async (event: FocusEvent<HTMLInputElement>) => {
    if (!event.currentTarget.reportValidity()) return
    let next = Math.round(Number(text) * scale)
    if (next === value) return
    setBusy(true)
    try { await run('automation.safety.set', { profile: profileId, key: setting, value: next }) } finally { setBusy(false) }
  }
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault(); event.currentTarget.blur()
  }
  return <label><span>{label}<small>{description}</small></span><input className={css.pluginInput} aria-label={label} type="number" min={1 / scale} max={maximum} step={1 / scale} value={text} onChange={change} onBlur={save} onKeyDown={keys} disabled={busy} required /></label>
}

let AutomationLimitsEditor = ({ profile }: { profile: Profile }) => {
  let { state, run } = useUI()
  let [busy, setBusy] = useState(false)
  if (!profile) return null
  let toggleMouse = async (event: ChangeEvent<HTMLInputElement>) => {
    setBusy(true)
    try { await run('automation.safety.set', { profile: profile.id, key: 'simulateMouseMovement', value: event.target.checked }) } finally { setBusy(false) }
  }
  let limits = automationProfileLimits(state.automationSafety?.limits ?? DEFAULT_AUTOMATION.safety, profile.id)
  return <ProfileSection title="Limits"><div className={css.antiBotLimitFields}>
    <AutomationLimitInput profileId={profile.id} setting="maxSessionMinutes" label="Session limit (minutes)" description="Automation time before a break" value={limits.maxSessionMinutes} maximum={1440} />
    <AutomationLimitInput profileId={profile.id} setting="cooldownMinutes" label="Break (minutes)" description="Pause after the session limit" value={limits.cooldownMinutes} maximum={1440} />
    <AutomationLimitInput profileId={profile.id} setting="socialDelayMs" label="Social site delay (seconds)" description="Wait between social-site actions" value={limits.socialDelayMs} scale={1000} maximum={30} />
  </div><label className={css.profileControl}><span>Simulate mouse movement<small>Move a virtual pointer between clicks</small></span><input className={css.proxyToggle} type="checkbox" role="switch" aria-label="Simulate mouse movement" checked={limits.simulateMouseMovement !== false} onChange={toggleMouse} disabled={busy} /></label></ProfileSection>
}

let ProfileBotSettings = ({ profile, pane }: BotProfileProps) => {
  let { state, run } = useUI()
  let [busy, setBusy] = useState(false)
  let [tab, setTab] = useState<'protection' | FeedbackSection>('protection')
  let changeTab = (event: MouseEvent<HTMLButtonElement>) => setTab(event.currentTarget.dataset.botTab as typeof tab)
  let safety = state.automationSafety, limits = safety?.limits ?? DEFAULT_AUTOMATION.safety
  let savedEnabled = profile ? automationSafetyEnabled(limits, profile.id) : true
  let savedPaneEnabled = !!pane && automationSafetyEnabled(limits, pane.profileId, pane.id)
  let [paneEnabled, setPaneEnabled] = useState(savedPaneEnabled)
  let [enabled, setEnabled] = useState(savedEnabled)
  useEffect(() => { setEnabled(savedEnabled) }, [savedEnabled, profile?.id])
  useEffect(() => { setPaneEnabled(savedPaneEnabled) }, [savedPaneEnabled, pane?.id])
  if (!profile) return null
  let pauses = automationProfilePauses(state, profile.id)
  let profilePanes = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).filter(pane => pane.profileId === profile.id)
  let toggle = async (event: ChangeEvent<HTMLInputElement>) => {
    let next = event.target.checked
    setEnabled(next); setBusy(true)
    try { if (!await run('profile.anti-bot.set', { profile: profile.id, enabled: next })) setEnabled(savedEnabled) } finally { setBusy(false) }
  }
  let resume = async (paneId: string) => {
    setBusy(true)
    try {
      await resumeAutomation(state, run, paneId)
    } finally { setBusy(false) }
  }
  let resetSession = async (host?: string) => {
    setBusy(true)
    try { await run('automation.reset-session', { profile: profile.id, host }) } finally { setBusy(false) }
  }
  let resetProfileSessions = () => { void resetSession() }
  let togglePane = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!pane) return
    let next = event.target.checked
    setPaneEnabled(next); setBusy(true)
    try { if (!await run('pane.anti-bot.set', { pane: pane.id, enabled: next })) setPaneEnabled(savedPaneEnabled) } finally { setBusy(false) }
  }
  let protection = <>
    {(pauses.length > 0 || safety?.error) && <ProfileSection title="Paused automation">
      {safety?.error && <p role="status">{safety.error}</p>}
      {pauses.map(usage => {
        let host = usage.warningHost ?? usage.siteHost ?? profile.name
        let cooldown = !!usage.retryAfter && Date.parse(usage.retryAfter) > Date.now()
        let affectedPane = usage.warning && profilePanes.find(pane => automationWebsiteHost(pane.url)?.replace(/^www\./, '') === usage.warningHost?.replace(/^www\./, ''))
        let resetWebsite = () => { void resetSession(usage.siteHost) }
        let resumeWarning = () => { if (affectedPane) void resume(affectedPane.id) }
        return <div key={host} role="group" aria-label={host}>
          <div className={css.antiBotStatus} role="status"><span>{usage.warning ? `${automationWarningLabels[usage.warning]} on ${host}` : `${host} · Break ends at ${new Date(usage.retryAfter!).toLocaleTimeString()}`}</span>{cooldown && <button type="button" onClick={resetWebsite} disabled={busy}>Reset session</button>}{affectedPane && <button type="button" onClick={resumeWarning} disabled={busy}>Resume automation</button>}</div>
          {usage.warning && <p>Resolve the warning on the website, then resume automation.</p>}
        </div>
      })}
    </ProfileSection>}
    <ProfileSection title="Enable Bot protection">
      <p>Applies to automation on public websites. Files and local addresses are excluded.</p>
      <label className={css.profileControl}><span>This profile<small>{profile.name} · all panes</small></span><span className={css.profileToggleState}><span aria-hidden="true">{enabled ? 'On' : 'Off'}</span><input className={css.proxyToggle} type="checkbox" role="switch" aria-label="Enable Bot protection for this profile" checked={enabled} onChange={toggle} disabled={busy} /></span></label>
      {pane && <label className={css.profileControl}><span>This pane<small>{permissionPaneLabel(state.model, pane.id)}{pane.agentId ? ` · Agent ${pane.agentId}` : ''}</small></span><span className={css.profileToggleState}><span aria-hidden="true">{paneEnabled ? 'On' : 'Off'}</span><input className={css.proxyToggle} type="checkbox" role="switch" aria-label="Enable Bot protection for this pane" checked={paneEnabled} onChange={togglePane} disabled={busy || !enabled} /></span></label>}
      <button type="button" onClick={resetProfileSessions} disabled={busy}>Reset profile sessions</button>
    </ProfileSection>
    <AutomationLimitsEditor key={`limits:${profile.id}`} profile={profile} />
    <ProfileExcludedWebsites key={`exclusions:${profile.id}`} profile={profile} pane={pane} />
  </>
  return <div className={css.antiBotSections} role="tabpanel" aria-label="Bot settings">
    <div className={`${css.panelTabs} ${css.botTabs}`} role="tablist" aria-label="Bot sections">
      {(['protection', 'appearance', 'timing'] as const).map(item => <button key={item} type="button" role="tab" data-bot-tab={item} aria-selected={tab === item} onClick={changeTab}><FeedbackTabIcon tab={item} />{item.charAt(0).toUpperCase() + item.slice(1)}</button>)}
    </div>
    {tab === 'protection' ? protection : <AgentFeedbackSettings section={tab} profileId={profile.id} value={state.agentFeedback ?? DEFAULT_AGENT_FEEDBACK} save={value => run('settings.set', { key: 'agentFeedback', value })} />}
  </div>
}

let ProfileNameEditor = () => {
  let { state, run, onMessage } = useUI()
  let { profile } = selection(state)
  let [editing, setEditing] = useState(false), [name, setName] = useState(''), [saving, setSaving] = useState(false)
  let input = useRef<HTMLInputElement>(null), button = useRef<HTMLButtonElement>(null), wasEditing = useRef(false)
  useEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select() }
    else if (wasEditing.current) button.current?.focus()
    wasEditing.current = editing
  }, [editing])
  if (!profile) return null
  let edit = () => { setName(profile.name); onMessage(''); setEditing(true) }
  let cancel = () => { if (!saving) { onMessage(''); setEditing(false) } }
  let changeName = (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)
  let escape = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation(); cancel()
  }
  let save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || !name.trim()) return
    onMessage(''); setSaving(true)
    try { if (await run('profile.rename', { profile: profile.id, name: name.trim() })) setEditing(false) }
    finally { setSaving(false) }
  }
  if (!editing) return <button ref={button} type="button" className={css.profileName} onClick={edit} aria-label="Edit profile name">{profile.name}</button>
  return <form className={css.profileNameEditor} onSubmit={save} onKeyDown={escape}>
    <input ref={input} className={css.pluginInput} aria-label="Profile name" value={name} onChange={changeName} disabled={saving} required />
    <button type="submit" disabled={saving || !name.trim()}>Save</button><button type="button" onClick={cancel} disabled={saving}>Cancel</button>
  </form>
}

let ProfilePaneSettings = () => {
  let { state, run } = useUI()
  let { pane } = selection(state)
  let [busy, setBusy] = useState(false)
  let savedEnabled = pane?.keepAlive === true
  let [enabled, setEnabled] = useState(savedEnabled)
  useEffect(() => { setEnabled(savedEnabled) }, [savedEnabled, pane?.id])
  if (!pane) return <p>No pane is selected.</p>
  let toggle = async (event: ChangeEvent<HTMLInputElement>) => {
    let next = event.target.checked
    setEnabled(next); setBusy(true)
    try { if (!await run('pane.keep-alive', { pane: pane.id, enabled: next })) setEnabled(savedEnabled) } finally { setBusy(false) }
  }
  return <div className={css.profileSections} role="tabpanel" aria-label="Pane settings"><ProfileSection title="Current pane">
    <label className={css.profileControl}><span>Keep Page Loaded<small>Preserve this pane’s page state while inactive and load it on launch.</small></span><span className={css.profileToggleState}><span aria-hidden="true">{enabled ? 'On' : 'Off'}</span><input className={css.proxyToggle} type="checkbox" role="switch" aria-label="Keep Page Loaded" checked={enabled} onChange={toggle} disabled={busy} /></span></label>
  </ProfileSection></div>
}

type ProfileTab = 'overview' | 'pane' | 'device' | 'connection' | 'anti-bot'
let ProfileTabIcon = ({ tab }: { tab: ProfileTab }) => {
  let paths: Record<ProfileTab, string> = {
    overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    pane: 'M3 4h18v16H3zM3 8h18',
    device: 'M7 2h10v20H7zM10 18h4',
    connection: 'M8 2v5M16 2v5M6 7h12v3a6 6 0 0 1-12 0zM12 16v6',
    'anti-bot': 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 12l3 3 5-6',
  }
  return <svg className={css.profileTabIcon} data-profile-tab-icon={tab} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[tab]} /></svg>
}

let SettingsIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.88 10.44 21.88 13.56 19.29 13.75 18.39 15.92 20.09 17.88 17.88 20.09 15.92 18.39 13.75 19.29 13.56 21.88 10.44 21.88 10.25 19.29 8.08 18.39 6.12 20.09 3.91 17.88 5.61 15.92 4.71 13.75 2.12 13.56 2.12 10.44 4.71 10.25 5.61 8.08 3.91 6.12 6.12 3.91 8.08 5.61 10.25 4.71 10.44 2.12 13.56 2.12 13.75 4.71 15.92 5.61 17.88 3.91 20.09 6.12 18.39 8.08 19.29 10.25Z" /><circle cx="12" cy="12" r="3.25" /></svg>

let ProfileManagementRow = ({ profile }: { profile: Profile }) => {
  let { state, run } = useUI()
  let [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  let reason = profileDeletionReason(state.model, profile.id)
  let ask = () => setConfirming(true), cancel = () => setConfirming(false)
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation(); cancel()
  }
  let remove = async () => {
    if (busy) return
    setBusy(true)
    try { await run('profile.delete', { profile: profile.id, confirm: true }) } finally { setBusy(false) }
  }
  if (confirming && !reason) return <div className={css.profileManageRow} role="alertdialog" aria-label={`Delete profile ${profile.name}?`} onKeyDown={keys}><span>Delete “{profile.name}” and its browsing data?</span><button type="button" onClick={remove} disabled={busy}>Delete profile</button><button type="button" onClick={cancel} disabled={busy} autoFocus>Cancel</button></div>
  return <div className={css.profileManageRow}><span>{profile.name}{reason && <small>{reason}</small>}</span><button type="button" onClick={ask} disabled={!!reason || busy} aria-label={`Delete profile ${profile.name}`}>Delete</button></div>
}

let ProfileSelectActions = () => {
  let { state, run, onMessage } = useUI(), { session, profile } = selection(state)
  let [creating, setCreating] = useState(false), [managing, setManaging] = useState(false)
  let [name, setName] = useState(''), [busy, setBusy] = useState(false)
  let changeName = (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)
  let add = () => setCreating(true)
  let cancel = () => { setCreating(false); setName('') }
  let manage = () => { setManaging(!managing); cancel() }
  let change = async (event: ChangeEvent<HTMLSelectElement>) => {
    if (!session || busy) return
    setBusy(true)
    try { await run('session.profile.set', { session: session.id, profile: event.target.value }) } finally { setBusy(false) }
  }
  let create = async (event: FormEvent) => {
    event.preventDefault()
    if (!session || busy || !name.trim()) return
    onMessage(''); setBusy(true)
    try {
      let created = await run('profile.create', { name: name.trim() }) as Profile | undefined
      if (created && await run('session.profile.set', { session: session.id, profile: created.id })) cancel()
    } finally { setBusy(false) }
  }
  return <>
    <div className={css.profileSelectRow}><label className={css.sessionProfileChange}>Default profile for new windows<select aria-label="Default profile for new windows" value={session?.defaultProfileId ?? profile?.id} onChange={change} disabled={busy}>{state.model.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className={css.profileManageButton} onClick={manage} aria-label="Manage profiles" title="Manage profiles" aria-expanded={managing} disabled={busy}><SettingsIcon /></button></div>
    {managing && <div className={css.profileManager} role="group" aria-label="Manage profiles"><div className={css.profileManageHeading}><span>Profiles</span><button type="button" onClick={add} aria-label="New profile" title="New profile" disabled={busy || creating}>+</button></div>
    {creating && <form className={css.sessionCreate} onSubmit={create} aria-label="Create profile"><label>Profile name<input value={name} onChange={changeName} autoFocus disabled={busy} required /></label><div className={css.sessionCreateActions}><button type="submit" disabled={busy || !name.trim()}>Create profile</button><button type="button" onClick={cancel} disabled={busy}>Cancel</button></div></form>}
    {state.model.profiles.map(item => <ProfileManagementRow key={item.id} profile={item} />)}</div>}
  </>
}

let ProfileInfo = () => {
  let { state, run } = useUI()
  let { session, pane, profile } = selection(state)
  let [tab, setTab] = useSettingsState<ProfileTab>(`profile:${profile?.id}:tab`, () => profile && (state.automationSafety?.error || automationProfilePauses(state, profile.id).length) ? 'anti-bot' : 'overview', false)
  useEffect(() => { if (profile) void run('profile.cache.status', { profile: profile.id }) }, [profile?.id, run])
  if (!profile) return <p>No profile is selected.</p>
  let paneCount = state.model.sessions.flatMap(item => item.windows.flatMap(item => item.panes)).filter(item => item.profileId === profile.id).length
  let cache = state.profileCaches[profile.id]
  let clearCache = () => { void run('profile.cache.clear', { profile: profile.id }) }
  let currentProxy = pane ? connectionProfile(state.model, paneConnectionId(pane)).proxy : profile.proxy
  let canChangeProfile = !!session && !session.private
  let overview = () => setTab('overview'), paneTab = () => setTab('pane'), device = () => setTab('device'), connection = () => setTab('connection'), antiBot = () => setTab('anti-bot')
  let overviewContent = <div className={css.profileSections} role="tabpanel" aria-label="Profile overview">{canChangeProfile && <ProfileSection title="New windows"><ProfileSelectActions /></ProfileSection>}
    <ProfileSection title="HTTP cache">
      <p>{cache ? `${(cache.bytes / 1024 / 1024).toFixed(1)} MiB of ${(cache.limit / 1024 / 1024).toFixed(0)} MiB` : 'Checking size'}. Cookies and site storage are preserved.</p>
      <div className={css.profileProxyActions}><button type="button" onClick={clearCache}>Clear HTTP cache</button></div>
    </ProfileSection></div>
  return <section className={css.profileInfo} aria-label={`${profile.name} profile details`}>
    <div className={css.profileHeading}><ProfileAvatar id={profile.id} name={profile.name} /><ProfileNameEditor key={profile.id} /></div>
    <div className={css.panelTabs} role="tablist" aria-label="Profile settings"><button type="button" role="tab" aria-selected={tab === 'overview'} onClick={overview}><ProfileTabIcon tab="overview" />Overview</button><button type="button" role="tab" aria-selected={tab === 'pane'} onClick={paneTab}><ProfileTabIcon tab="pane" />Pane</button><button type="button" role="tab" aria-selected={tab === 'device'} onClick={device}><ProfileTabIcon tab="device" />Device</button><button type="button" role="tab" aria-selected={tab === 'connection'} onClick={connection}><ProfileTabIcon tab="connection" />Connection</button><button type="button" role="tab" aria-selected={tab === 'anti-bot'} onClick={antiBot}><ProfileTabIcon tab="anti-bot" />Bot</button></div>
    {tab === 'overview' && overviewContent}
    {tab === 'pane' && <ProfilePaneSettings key={pane?.id} />}
    {tab === 'device' && <div role="tabpanel" aria-label="Device settings">{pane && session && <ProfileDeviceSettings key={pane.id} profile={profile} pane={pane} session={session} />}</div>}
    {tab === 'connection' && <div className={css.profileSections} role="tabpanel" aria-label="Connection settings"><ProfileSection title="Current pane connection"><p>{currentProxy ? `${currentProxy.protocol}://${currentProxy.host}:${currentProxy.port}` : 'System connection'}</p></ProfileSection><ProxySettings key={profile.id} profile={profile} paneCount={paneCount} /></div>}
    {tab === 'anti-bot' && <ProfileBotSettings key={profile.id} profile={profile} pane={pane} />}
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
  let { state, run, dismiss, bookmarkDestination } = useUI()
  let { tab, profile: pageProfile } = selection(state)
  let profile = bookmarkDestination ? state.model.profiles.find(item => item.id === bookmarkDestination.profileId) : pageProfile
  let folders = bookmarkFolderOptions(profile?.bookmarks ?? [])
  let [title, setTitle] = useState(tab?.title && tab.title !== 'about:blank' ? tab.title : ''), [folder, setFolder] = useState(() => bookmarkDestination?.folderId ?? bookmarkFolderForUrl(profile?.bookmarks ?? [], tab?.url ?? '') ?? '')
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
    let result = await run('bookmark.folder.add', { tab: tab.id, profile: profile?.id, title: folderName, parent: folder }) as { folder: Bookmark } | undefined
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
    let result = await run('bookmark.add', { tab: tab.id, profile: profile?.id, title, folder })
    setBusy(false)
    if (result !== undefined) dismiss()
  }
  if (!profile || !tab) return <p>No page is selected.</p>
  return <form className={css.bookmarkEditor} onSubmit={submit} onKeyDown={editorKeys}>
    <p className={css.bookmarkUrl}>{tab.url}</p>
    {profile.id !== pageProfile?.id && <p>Profile: {profile.name}</p>}
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
type BookmarkDrag = { id: string; parentId: string; profileId: string }
type BookmarkDrop = { id: string; profileId: string; position: 'before' | 'after' }
let bookmarkKey = (profileId: string, bookmarkId: string) => JSON.stringify([profileId, bookmarkId])
let BookmarkExpansionContext = createContext<{ searching: boolean; canAdd: boolean; reordering: boolean; activate: (bookmark: Bookmark, profileId: string, sameTab?: boolean) => void; expandedBookmarkId: string | null; settingsClosed: boolean; setExpandedBookmarkId: (bookmarkId: string | null) => void; startDrag: (drag: BookmarkDrag) => void; endDrag: () => void; dragOver: (event: DragEvent<HTMLElement>, target: BookmarkDrag) => void; drop: (event: DragEvent<HTMLElement>, target: BookmarkDrag) => void; dropTarget: BookmarkDrop | null } | null>(null)

let useBookmarkNavigation = (onActivate: (row: HTMLElement, sameTab?: boolean) => void, initialQuery: string, onQueryChange: (query: string) => void, onNavigate: () => HTMLElement | null) => {
  let { state, dismiss } = useUI()
  let { ref, input, query, change, keys } = usePickerNavigation(onActivate, initialQuery, onQueryChange, false, '[data-bookmark-id]:not([aria-disabled="true"])', onActivate, 'div[data-bookmark-id]:not([aria-disabled="true"])')
  let [count, setCount] = useState(''), [searchFocused, setSearchFocused] = useState(false)
  let pendingG = useRef(false)
  let rows = () => [...(ref.current?.querySelectorAll<HTMLElement>('[data-bookmark-id]:not(:disabled):not([aria-disabled="true"])') ?? [])].filter(row => row.getClientRects().length && !row.closest('details:not([open]) > :not(summary)'))
  useLayoutEffect(() => {
    let picker = ref.current!
    let updateNumbers = () => {
      let items = rows(), selected = items.indexOf(document.activeElement as HTMLElement)
      if (selected < 0) selected = document.activeElement === input.current ? 0 : items.findIndex(row => row.dataset.active === 'true')
      let values = new Map(items.map((row, index) => [row.querySelector<HTMLElement>('[data-bookmark-number]'), String(Math.abs(index - Math.max(0, selected)))]))
      picker.querySelectorAll<HTMLElement>('[data-bookmark-number]').forEach(number => {
        let value = values.get(number) ?? ''
        if (number.textContent !== value) number.textContent = value
      })
    }
    let observer = new MutationObserver(changes => {
      if (changes.some(change => !(change.target instanceof Element) || !change.target.closest('[data-bookmark-number]'))) updateNumbers()
    })
    observer.observe(picker, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-disabled'] })
    picker.addEventListener('focusin', updateNumbers); updateNumbers()
    return () => { observer.disconnect(); picker.removeEventListener('focusin', updateNumbers) }
  })
  let focusRow = (position: number, items = rows()) => {
    onNavigate()
    let index = Math.max(0, Math.min(items.length - 1, position)), row = items[index]
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
  }
  let move = (direction: number) => {
    let hovered = onNavigate()
    let searching = document.activeElement === input.current && !!query
    let items = rows().filter(row => !searching || row.tagName !== 'SUMMARY'), index = items.indexOf(hovered ?? document.activeElement as HTMLElement)
    if (searching && !hovered) index = 0
    focusRow(index + direction, items)
  }
  let vim = useAddressVim(move, undefined, 'NORMAL', state.vimEditing !== false, input, dismiss)
  let focusMode = (event: FocusEvent<HTMLDivElement>) => {
    setSearchFocused(event.target === input.current)
    setCount(''); pendingG.current = false
  }
  let openKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || !['o', 'O'].includes(event.key)) return false
    let row = document.activeElement === input.current ? rows().find(row => row.dataset.active === 'true') ?? rows().find(row => row.tagName !== 'SUMMARY') : (event.target as HTMLElement).closest<HTMLElement>('[data-bookmark-id]')
    event.preventDefault(); event.stopPropagation(); setCount(''); pendingG.current = false
    if (row) onActivate(row, event.key === 'o')
    return true
  }
  let searchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (vim.enabled && vim.mode === 'NORMAL' && !vim.commandPending() && openKey(event)) return
    if (vim.enabled) vim.keys(event)
  }
  let bookmarkKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey) return
    if (event.metaKey) { keys(event); return }
    let target = event.target as HTMLElement, editing = target === input.current
    if (!editing && target.closest('input, textarea, select, [data-picker-action], [role="menu"]')) return
    if (!editing && openKey(event)) return
    let row = target.closest<HTMLElement>('[data-bookmark-id]')
    if (!editing && !event.ctrlKey && row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onActivate(row); return }
    if (!editing && !event.ctrlKey && row?.tagName === 'SUMMARY' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      let folder = row.parentElement as HTMLDetailsElement
      if (folder.open !== (event.key === 'ArrowRight')) row.click()
      return
    }
    if (!editing && !event.ctrlKey && event.key === 'Escape' && (count || pendingG.current)) {
      event.preventDefault(); event.stopPropagation(); setCount(''); pendingG.current = false; return
    }
    if (!editing && !event.ctrlKey && /^\d$/.test(event.key)) { event.preventDefault(); setCount((count + event.key).slice(0, 6)); return }
    if (!editing && !event.ctrlKey && event.key === 'g') {
      event.preventDefault()
      if (pendingG.current) { focusRow(Number(count || 1) - 1); setCount(''); pendingG.current = false } else pendingG.current = true
      return
    }
    pendingG.current = false
    if (!editing && !event.ctrlKey && event.key === 'G') { event.preventDefault(); focusRow(count ? Number(count) - 1 : rows().length - 1); setCount(''); return }
    if ((!editing && !event.ctrlKey && ['j', 'k'].includes(event.key)) || (event.ctrlKey && ['n', 'p', 'f', 'b'].includes(event.key))) {
      event.preventDefault()
      let direction = ['j', 'n', 'f'].includes(event.key) ? 1 : -1
      move(direction * (event.ctrlKey ? ['f', 'b'].includes(event.key) ? 10 : 1 : Number(count || 1)))
      setCount(''); return
    }
    if (!editing && !event.ctrlKey && ['i', 'a', '/'].includes(event.key)) {
      event.preventDefault(); setCount(''); vim.reset('INSERT'); input.current?.focus()
      if (event.key === '/') input.current?.select()
      return
    }
    if (!editing && !event.ctrlKey && event.key.length === 1 && event.key !== ' ') vim.reset('INSERT')
    if (!event.ctrlKey && ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) && (!editing || !['Home', 'End'].includes(event.key))) {
      let hovered = onNavigate()
      if (hovered && editing) {
        event.preventDefault()
        let items = rows().filter(row => !query || row.tagName !== 'SUMMARY'), index = items.indexOf(hovered)
        let direction = ['ArrowDown', 'PageDown'].includes(event.key) ? 1 : -1
        let next = index + direction * (event.key.startsWith('Page') ? 10 : 1)
        focusRow(event.key.startsWith('Arrow') ? (next + items.length) % items.length : next, items)
        setCount(''); return
      }
      hovered?.focus({ preventScroll: true })
    }
    setCount(''); keys(event)
  }
  return { ref, input, query, change, keys: bookmarkKeys, searchKeys, focusMode, vim, mode: searchFocused ? vim.mode : 'NORMAL', count }
}

let useBookmarkPreview = (list: RefObject<HTMLDivElement | null>, dragging: () => boolean, rememberSelection: (key: string) => void) => {
  let [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null)
  let [hoveredBookmarkId, setHoveredBookmarkId] = useState<string | null>(null)
  let [settingsClosed, setSettingsClosed] = useState(false)
  let pointer = useRef<{ x: number; y: number } | null>(null)
  let lastPointer = useRef<{ x: number; y: number } | null>(null)
  let keyboardNavigation = () => {
    let row = [...(list.current?.querySelectorAll<HTMLElement>('[data-bookmark-id]') ?? [])].find(item => bookmarkKey(item.dataset.bookmarkProfile ?? '', item.dataset.bookmarkId ?? '') === (hoveredBookmarkId ?? selectedBookmarkId))
    pointer.current = null; setHoveredBookmarkId(null)
    return row ?? null
  }
  let expandedBookmarkId = hoveredBookmarkId ?? selectedBookmarkId
  let setExpandedBookmarkId = (key: string | null) => {
    if (key === null) { setSettingsClosed(true); return }
    setSelectedBookmarkId(key); setSettingsClosed(false)
  }
  let hover = (target: Element | null) => {
    if (list.current?.querySelector('[data-menu-open="true"]') || dragging()) return
    let row = target?.closest<HTMLElement>('[data-bookmark-id]')
    if (row && list.current?.contains(row)) {
      let key = bookmarkKey(row.dataset.bookmarkProfile ?? '', row.dataset.bookmarkId ?? '')
      if (key !== hoveredBookmarkId) {
        // Focus handlers clear hover state; record this pointer selection after the handoff.
        // Keep row navigation in sync without taking focus from search or settings inputs.
        if (document.activeElement?.matches('[data-bookmark-id]') && list.current.contains(document.activeElement) && row.getAttribute('aria-disabled') !== 'true') row.focus({ preventScroll: true })
        setHoveredBookmarkId(key); setSelectedBookmarkId(key); setSettingsClosed(false); rememberSelection(key)
      }
    } else if (!target?.closest('[aria-label="Bookmark settings"]')) setHoveredBookmarkId(null)
  }
  let pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (lastPointer.current?.x === event.clientX && lastPointer.current?.y === event.clientY) return
    pointer.current = lastPointer.current = { x: event.clientX, y: event.clientY }; hover(event.target as Element)
  }
  let pointerLeave = () => { pointer.current = lastPointer.current = null; if (!list.current?.querySelector('[data-menu-open="true"]')) setHoveredBookmarkId(null) }
  let updateHover = () => { if (pointer.current) hover(document.elementFromPoint(pointer.current.x, pointer.current.y)) }
  return { selectedBookmarkId, setSelectedBookmarkId, hoveredBookmarkId, setHoveredBookmarkId, settingsClosed, setSettingsClosed, expandedBookmarkId, setExpandedBookmarkId, pointerMove, pointerLeave, updateHover, keyboardNavigation }
}

let BookmarkPicker = () => {
  let { state, run, show, dismiss, allBookmarkProfiles, setAllBookmarkProfiles, bookmarkSearches, rememberBookmarkSearch, bookmarkSelections, rememberBookmarkSelection, bookmarkViews, rememberBookmarkView } = useUI()
  let { profile, client, session, tab } = selection(state)
  let list = useRef<HTMLDivElement>(null)
  let [reordering, setReordering] = useState(false)
  let dragSource = useRef<BookmarkDrag | null>(null)
  let [dropTarget, setDropTarget] = useState<BookmarkDrop | null>(null)
  let { setSelectedBookmarkId, setHoveredBookmarkId, settingsClosed, setSettingsClosed, expandedBookmarkId, setExpandedBookmarkId, pointerMove, pointerLeave, updateHover, keyboardNavigation } = useBookmarkPreview(list, () => !!dragSource.current, key => { if (profile) rememberBookmarkSelection(profile.id, key) })
  let groups: { profile: Profile; bookmarks: Bookmark[] }[] = []
  let activate = async (bookmark: Bookmark, profileId: string, sameTab = false) => {
    if (!bookmark.url || !/^(https?:|file:)/i.test(bookmark.url) || !client?.paneId) return
    if (sameTab && (profileId !== profile?.id || !tab)) return
    if (profile) rememberBookmarkSelection(profile.id, bookmarkKey(profileId, bookmark.id))
    let result = await run('bookmark.open', { session: session?.id, profile: profileId, client: client.id, bookmark: bookmark.id, ...(sameTab ? { tab: tab?.id } : {}) })
    if (result !== undefined) dismiss()
  }
  let { ref, keys, input, query, change, searchKeys, focusMode, vim, mode, count } = useBookmarkNavigation((row, sameTab) => {
    let selected = expandedBookmarkId && [...(ref.current?.querySelectorAll<HTMLElement>('[data-bookmark-id]:not([aria-disabled="true"])') ?? [])].find(item => bookmarkKey(item.dataset.bookmarkProfile ?? '', item.dataset.bookmarkId ?? '') === expandedBookmarkId)
    let target = selected || row
    if (target.tagName === 'SUMMARY') { if (sameTab === undefined) target.click(); return }
    let group = groups.find(item => item.profile.id === target.dataset.bookmarkProfile)
    let bookmark = findBookmark(group?.bookmarks ?? [], target.dataset.bookmarkId ?? '')
    if (bookmark && group) void activate(bookmark, group.profile.id, sameTab)
  }, bookmarkSearches[profile?.id ?? ''] ?? '', value => { if (profile) rememberBookmarkSearch(profile.id, value) }, keyboardNavigation)
  useEffect(() => {
    let selected = [...(ref.current?.querySelectorAll<HTMLElement>('[data-bookmark-id]') ?? [])].find(row => bookmarkKey(row.dataset.bookmarkProfile ?? '', row.dataset.bookmarkId ?? '') === bookmarkSelections[profile?.id ?? ''])
    if (selected?.getClientRects().length && !selected.hasAttribute('aria-disabled')) selected.focus({ preventScroll: true })
    let scroll = bookmarkViews[profile?.id ?? '']?.scroll
    if (list.current && scroll !== undefined) list.current.scrollTop = scroll
    else selected?.scrollIntoView({ block: 'nearest' })
  }, [profile?.id])
  let changeQuery = (event: ChangeEvent<HTMLInputElement>) => { setSelectedBookmarkId(null); setHoveredBookmarkId(null); setSettingsClosed(false); if (list.current) list.current.scrollTop = 0; change(event) }
  let endDrag = () => { dragSource.current = null; setDropTarget(null) }
  let toggleReordering = () => { endDrag(); setReordering(current => !current) }
  let changeProfiles = (event: ChangeEvent<HTMLInputElement>) => { setAllBookmarkProfiles(event.target.checked); setSelectedBookmarkId(null); setHoveredBookmarkId(null); setSettingsClosed(false); endDrag(); input.current?.focus() }
  let addBookmark = () => show('bookmark')
  let dragPosition = (event: DragEvent<HTMLElement>): BookmarkDrop['position'] => event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? 'before' : 'after'
  let dragOver = (event: DragEvent<HTMLElement>, target: BookmarkDrag) => {
    let source = dragSource.current
    if (!reordering || !source || source.profileId !== target.profileId || source.id === target.id || source.parentId !== target.parentId) return
    event.preventDefault(); event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    let position = dragPosition(event)
    setDropTarget(current => current?.profileId === target.profileId && current.id === target.id && current.position === position ? current : { id: target.id, profileId: target.profileId, position })
  }
  let drop = (event: DragEvent<HTMLElement>, target: BookmarkDrag) => {
    let source = dragSource.current
    if (!reordering || !source || source.profileId !== target.profileId || source.id === target.id || source.parentId !== target.parentId) return
    event.preventDefault(); event.stopPropagation()
    let position = dragPosition(event)
    endDrag()
    void run('bookmark.move', { profile: source.profileId, bookmark: source.id, target: target.id, position })
  }
  let focus = (event: FocusEvent<HTMLDivElement>) => {
    focusMode(event)
    let row = event.target.closest<HTMLElement>('[data-bookmark-id]')
    let key = row ? bookmarkKey(row.dataset.bookmarkProfile ?? '', row.dataset.bookmarkId ?? '') : null
    if (key) {
      setHoveredBookmarkId(null); setSelectedBookmarkId(key); setSettingsClosed(false)
      if (profile) rememberBookmarkSelection(profile.id, key)
    }
    if (event.target === input.current) {
      let first = query && ref.current?.querySelector<HTMLElement>('div[data-bookmark-id]:not([aria-disabled="true"])')
      setSelectedBookmarkId(first ? bookmarkKey(first.dataset.bookmarkProfile ?? '', first.dataset.bookmarkId ?? '') : null); setSettingsClosed(false)
    }
  }
  useLayoutEffect(() => {
    if (document.activeElement !== input.current || !query) return
    let row = ref.current?.querySelector<HTMLElement>('div[data-bookmark-id]:not([aria-disabled="true"])')
    setSelectedBookmarkId(row ? bookmarkKey(row.dataset.bookmarkProfile ?? '', row.dataset.bookmarkId ?? '') : null)
  }, [query, allBookmarkProfiles])
  let profiles = profile ? [profile, ...(allBookmarkProfiles ? state.model.profiles.filter(item => item.id !== profile.id) : [])] : []
  groups = profiles.map(item => ({ profile: item, bookmarks: searchBookmarks(item.bookmarks ?? [], query, { preserveOrder: reordering }) })).filter(group => group.bookmarks.length)
  let canAdd = !!tab && /^(https?:|file:)/i.test(tab.url)
  let focusSearch = () => input.current?.focus()
  let scroll = () => { if (profile && list.current) rememberBookmarkView(profile.id, { scroll: list.current.scrollTop }); updateHover() }
  let preview = useRef<string | null>(null)
  let pages = groups.flatMap(group => flattenBookmarkPages(group.bookmarks).filter(bookmark => /^(https?:|file:)/i.test(bookmark.url ?? '')).map(bookmark => ({ bookmark, profileId: group.profile.id, key: bookmarkKey(group.profile.id, bookmark.id) })))
  let activePreview = pages.find(item => item.key === expandedBookmarkId)
  useLayoutEffect(() => { preview.current = null }, [query, allBookmarkProfiles])
  useLayoutEffect(() => { if (activePreview) preview.current = activePreview.key }, [activePreview?.key])
  let expanded = !settingsClosed && (activePreview ?? (expandedBookmarkId && pages.find(item => item.key === preview.current)))
  useLayoutEffect(() => {
    let panel = ref.current?.closest<HTMLElement>('[role="dialog"]'), results = list.current?.querySelector<HTMLElement>('[data-bookmark-results]')
    if (!panel || !results || !list.current) return
    // Search results size the panel; preview content and folder navigation cannot move it under the pointer.
    let chromeHeight = panel.getBoundingClientRect().height - list.current.getBoundingClientRect().height
    panel.style.setProperty('--bookmark-panel-height', `${Math.ceil(results.getBoundingClientRect().height + chromeHeight)}px`)
  }, [query, allBookmarkProfiles])
  let bookmarks = <BookmarkActions key={`${query}:${allBookmarkProfiles}`} run={run} focusSearch={focusSearch}>{groups.map(group => <div key={group.profile.id}>{allBookmarkProfiles && <h2 className={css.bookmarkProfile}>{group.profile.name}</h2>}{group.bookmarks.map(bookmark => <BookmarkRow key={bookmark.id} bookmark={bookmark} profileId={group.profile.id} parentId="" />)}</div>)}</BookmarkActions>
  let results = <div data-bookmark-results>{bookmarks}{!groups.length && <p role="status">{query ? 'No matching bookmarks.' : allBookmarkProfiles ? 'No bookmarks.' : 'No bookmarks in this profile.'}</p>}</div>
  return <BookmarkExpansionContext.Provider value={{ searching: !!query.trim(), canAdd, reordering, activate, expandedBookmarkId, settingsClosed, setExpandedBookmarkId, startDrag: drag => { dragSource.current = drag }, endDrag, dragOver, drop, dropTarget }}><div ref={ref} data-picker className={css.bookmarkPicker} data-bookmark-picker onPointerMove={pointerMove} onPointerLeave={pointerLeave} onFocusCapture={focus} onKeyDown={keys} role="group" aria-label="Choose bookmark">
    <div className={css.bookmarkToolbar}><VimMode mode={`${mode}${count && ` ${count}`}`} label="Bookmark navigation mode" /><div className={css.bookmarkSearch}><SearchInput ref={input} aria-label="Search bookmarks" data-vim-mode={vim.mode} value={query} onChange={changeQuery} onKeyDown={searchKeys} onMouseUp={vim.select} /><VimCursor input={input} mode={vim.mode} value={query} /></div><label><input type="checkbox" checked={allBookmarkProfiles} onChange={changeProfiles} />All profiles</label><button type="button" data-picker-action className={css.bookmarkReorder} aria-label="Reorder bookmarks" title="Reorder bookmarks" aria-pressed={reordering} onClick={toggleReordering}><BookmarkReorderIcon /></button>{canAdd && <button type="button" data-picker-action className={css.bookmarkAdd} aria-label="Bookmark current page" title="Bookmark current page" onClick={addBookmark}>+</button>}</div>
    <div className={css.bookmarkColumns} data-settings-open={!!expanded}><div ref={list} className={css.bookmarkList} data-bookmark-scroll onScroll={scroll}>{results}</div>
    {expanded && <BookmarkSettings key={expanded.key} bookmark={expanded.bookmark} profileId={expanded.profileId} />}</div>
  </div></BookmarkExpansionContext.Provider>
}
let BookmarkReorderIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 12V3m-3 3 3-3 3 3M11 4v9m-3-3 3 3 3-3" /></svg>
let flattenBookmarkPages = (bookmarks: Bookmark[]): Bookmark[] => bookmarks.flatMap(bookmark => bookmark.children ? flattenBookmarkPages(bookmark.children) : [bookmark])
let findBookmark = (bookmarks: Bookmark[], id: string): Bookmark | undefined => {
  for (let bookmark of bookmarks) {
    if (bookmark.id === id) return bookmark
    if (bookmark.children) {
      let found = findBookmark(bookmark.children, id)
      if (found) return found
    }
  }
}
let BookmarkRow = ({ bookmark, profileId, parentId }: { bookmark: Bookmark; profileId: string; parentId: string }) => {
  let { state, show, bookmarkViews, rememberBookmarkView } = useUI()
  let { searching, canAdd, reordering, expandedBookmarkId, settingsClosed, setExpandedBookmarkId, dragOver, drop, dropTarget } = useContext(BookmarkExpansionContext)!
  let key = bookmarkKey(profileId, bookmark.id)
  let { editing, menu, menuKeys } = useBookmarkActions()
  let contextMenu = (event: MouseEvent<HTMLElement>) => menu(event, { bookmark, profileId })
  let contextKeys = (event: KeyboardEvent<HTMLElement>) => menuKeys(event, { bookmark, profileId })
  let expanded = expandedBookmarkId === key
  let supported = !!bookmark.url && /^(https?:|file:)/i.test(bookmark.url)
  let toggle = () => setExpandedBookmarkId(key)
  let addToFolder = (event: MouseEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); show('bookmark', undefined, { profileId, folderId: bookmark.id }) }
  let drag = { id: bookmark.id, parentId, profileId }
  let dragProps = { onDragOver: (event: DragEvent<HTMLElement>) => dragOver(event, drag), onDrop: (event: DragEvent<HTMLElement>) => drop(event, drag), 'data-drop-position': dropTarget?.profileId === profileId && dropTarget.id === bookmark.id ? dropTarget.position : undefined }
  let handle = reordering ? <BookmarkDragHandle bookmark={bookmark} profileId={profileId} parentId={parentId} /> : null
  let [folderOpen, setFolderOpen] = useState(() => searching || bookmarkViews[profileId]?.folders?.[bookmark.id] !== false)
  let saveFolder = (open: boolean) => {
    setFolderOpen(open)
    if (!searching) rememberBookmarkView(profileId, { folders: { ...bookmarkViews[profileId]?.folders, [bookmark.id]: open } })
  }
  let toggleFolder = (event: React.SyntheticEvent<HTMLDetailsElement>) => { if (event.currentTarget.open !== folderOpen) saveFolder(event.currentTarget.open) }
  let clickFolder = (event: MouseEvent<HTMLElement>) => { event.preventDefault(); saveFolder(!folderOpen) }
  let depth = useContext(BookmarkDepthContext)
  let indentation = <span className={css.bookmarkIndent} aria-hidden="true">{'  '.repeat(depth)}</span>
  let number = <span className={css.bookmarkNumber} data-bookmark-number aria-hidden="true" />
  let rowProps = { 'data-bookmark-id': bookmark.id, 'data-bookmark-profile': profileId, 'data-active': expanded, 'aria-label': bookmark.title || bookmark.url || 'Untitled folder' }
  let canOpenSameTab = selection(state).profile?.id === profileId
  if (bookmark.children) return <details className={css.folder} open={folderOpen} onToggle={toggleFolder}><summary className={css.bookmarkRow} {...rowProps} aria-expanded={folderOpen} onClick={clickFolder} {...dragProps} onContextMenu={contextMenu} onKeyDown={contextKeys}>{number}{indentation}<svg className={css.folderChevron} data-bookmark-chevron viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>{handle}<BookmarkTitle bookmark={bookmark} profileId={profileId} />{canAdd && <button type="button" data-picker-action className={css.bookmarkAdd} aria-label={`Bookmark current page in ${bookmark.title || 'Untitled folder'}`} title="Bookmark current page in this folder" onClick={addToFolder}>+</button>}</summary><BookmarkDepthContext.Provider value={depth + 1}><div>{bookmark.children.map(child => <BookmarkRow key={child.id} bookmark={child} profileId={profileId} parentId={bookmark.id} />)}</div></BookmarkDepthContext.Provider></details>
  return <div className={css.bookmarkItem}>
    <div className={css.bookmarkRow} {...rowProps} role="button" tabIndex={supported ? 0 : -1} aria-disabled={!supported && editing !== key || undefined} {...dragProps} onContextMenu={contextMenu} onKeyDown={contextKeys}>{number}{indentation}{handle}<span className={css.bookmarkLabel} title={supported ? bookmark.url : 'Unsupported URL type'}><BookmarkTitle bookmark={bookmark} profileId={profileId} /></span>
      {supported && <><button type="button" data-picker-action className={css.bookmarkCustomize} aria-label={`Customize ${bookmark.title || bookmark.url}`} aria-expanded={expanded && !settingsClosed} onClick={toggle} title="Customize bookmark"><BookmarkSettingsIcon /></button><BookmarkOpenButtons bookmark={bookmark} profileId={profileId} sameTabEnabled={canOpenSameTab} /></>}
    </div>
  </div>
}
let BookmarkSettingsIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /><circle cx="6" cy="4" r="1.5" /><circle cx="10" cy="8" r="1.5" /><circle cx="5" cy="12" r="1.5" /></svg>
let BookmarkDepthContext = createContext(0)
let BookmarkOpenIcon = ({ sameTab = false }: { sameTab?: boolean }) => <svg viewBox="0 0 16 16" aria-hidden="true">{sameTab ? <path d="M3 8h10m-4-4 4 4-4 4" /> : <><path d="M9 3h4v4m0-4-7 7" /><path d="M7 3H3v10h10V9" /></>}</svg>
let BookmarkOpenButton = ({ label, tooltip, disabled = false, sameTab = false, onClick }: { label: string; tooltip: string; disabled?: boolean; sameTab?: boolean; onClick: () => void }) => {
  let tooltipId = useId(), button = useRef<HTMLButtonElement>(null), hint = useRef<HTMLSpanElement>(null)
  let [visible, setVisible] = useState(false)
  let show = () => setVisible(true), hide = () => setVisible(false)
  useLayoutEffect(() => {
    if (!visible || !button.current || !hint.current) return
    let bounds = button.current.getBoundingClientRect(), size = hint.current.getBoundingClientRect()
    hint.current.style.left = `${Math.max(8, Math.min(bounds.right - size.width, innerWidth - size.width - 8))}px`
    hint.current.style.top = `${Math.max(8, bounds.top - size.height - 4)}px`
  }, [visible, tooltip])
  return <><button ref={button} type="button" data-picker-action className={css.bookmarkOpen} aria-label={label} aria-describedby={visible ? tooltipId : undefined} disabled={disabled} onClick={onClick} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}><BookmarkOpenIcon sameTab={sameTab} /></button>{visible && createPortal(<span ref={hint} id={tooltipId} className={css.bookmarkOpenTooltip} role="tooltip">{tooltip}</span>, document.body)}</>
}
let BookmarkOpenButtons = ({ bookmark, profileId, sameTabEnabled, open }: { bookmark: Bookmark; profileId: string; sameTabEnabled: boolean; open?: (sameTab: boolean) => void }) => {
  let { activate } = useContext(BookmarkExpansionContext)!
  let sameTab = () => open ? open(true) : activate(bookmark, profileId, true)
  let newTab = () => open ? open(false) : activate(bookmark, profileId)
  let title = open ? '' : ` ${bookmark.title || bookmark.url}`
  let sameTabTooltip = sameTabEnabled ? 'Open in same tab (o)' : 'Open in same tab (o): requires the current profile'
  return <><BookmarkOpenButton label={`Open${title} in same tab`} tooltip={sameTabTooltip} disabled={!sameTabEnabled} sameTab onClick={sameTab} /><BookmarkOpenButton label={`Open${title} in new tab`} tooltip="Open in new window (Shift+O)" onClick={newTab} /></>
}
let BookmarkSettings = ({ bookmark, profileId }: { bookmark: Bookmark; profileId: string }) => {
  let { state, run } = useUI()
  let { activate, setExpandedBookmarkId } = useContext(BookmarkExpansionContext)!
  let [settings, setSettings] = useState<BookmarkParameters>(() => state.bookmarkParameters?.[profileId]?.[bookmark.id] ?? { values: {}, hidden: [] })
  let draft = useRef<{ settings: BookmarkParameters; dirty: boolean }>({ settings, dirty: false })
  useEffect(() => () => { if (draft.current.dirty) void run('bookmark.parameters.update', { profile: profileId, bookmark: bookmark.id, ...draft.current.settings }) }, [profileId, bookmark.id, run])
  let parameters = bookmark.url ? editableBookmarkParameters(bookmark.url, settings) : []
  let visible = parameters.filter(([key]) => !settings.hidden.includes(key))
  let persist = async (next: BookmarkParameters) => run('bookmark.parameters.update', { profile: profileId, bookmark: bookmark.id, ...next })
  let open = async (sameTab: boolean) => { if (parameters.length && await persist(settings) === undefined) return; activate(bookmark, profileId, sameTab) }
  let update = (key: string, value: string) => {
    let next = { ...settings, values: { ...settings.values, [key]: value } }
    draft.current = { settings: next, dirty: true }; setSettings(next)
  }
  let hide = (key: string) => {
    let next = { ...settings, hidden: [...settings.hidden, key] }
    draft.current = { settings: next, dirty: false }; setSettings(next); void persist(next)
  }
  let save = () => { draft.current.dirty = false; void persist(settings) }
  let close = () => setExpandedBookmarkId(null)
  return <aside className={css.bookmarkParameters} aria-label="Bookmark settings" data-picker-action><div className={css.bookmarkSettingsHeading}><strong>{bookmark.title || bookmark.url}</strong><CloseButton label="Close bookmark settings" onClick={close} /></div><div aria-label="Bookmark URL parameters">{visible.map(([key, initial]) => {
      let value = settings.values[key] ?? initial
      let { label, help } = bookmarkParameterPresentation(bookmark.url!, key)
      let numeric = /^-?\d+(?:\.\d+)?$/.test(initial) && Number.isFinite(Number(initial))
      let number = Number(initial), currentNumber = Number(value) || number
      let minimum = key === 'x:max_age_days' ? 0 : Math.min(0, Math.floor(number * 2), Math.floor(currentNumber * 2)), maximum = key === 'x:max_age_days' ? Math.max(365, currentNumber) : Math.max(100, Math.ceil(number * 2), Math.ceil(currentNumber * 2))
      let step = initial.includes('.') ? 10 ** -Math.min(initial.split('.')[1].length, 4) : 1
      let changeValue = (event: ChangeEvent<HTMLInputElement>) => update(key, event.target.value)
      let remove = () => hide(key)
      return <div className={css.bookmarkParameter} key={key}><label><span title={help ?? label}>{label}</span><input aria-label={label} title={help} type={numeric ? 'number' : 'text'} value={value} step={numeric ? step : undefined} onChange={changeValue} onBlur={save} autoComplete="off" spellCheck={false} /></label>{numeric && <input aria-label={`${label} slider`} title={help} type="range" min={minimum} max={maximum} step={step} value={value} onChange={changeValue} onPointerUp={save} onBlur={save} />}<button type="button" data-picker-action className={css.bookmarkRemoveParameter} aria-label={`Remove ${label} parameter`} title={`Remove ${label} from this bookmark URL`} onClick={remove}>×</button></div>
    })}</div><BookmarkPlugins state={state} profileId={profileId} bookmarkId={bookmark.id} url={bookmark.url!} run={run} /><div className={css.bookmarkSettingsFooter}><BookmarkOpenButtons bookmark={bookmark} profileId={profileId} sameTabEnabled={selection(state).profile?.id === profileId} open={open} /></div></aside>
}

let BookmarkDragHandle = ({ bookmark, profileId, parentId }: { bookmark: Bookmark; profileId: string; parentId: string }) => {
  let { run } = useUI()
  let { startDrag, endDrag } = useContext(BookmarkExpansionContext)!
  let dragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    startDrag({ id: bookmark.id, parentId, profileId })
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', bookmark.id)
  }
  let keys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault(); event.stopPropagation()
    void run('bookmark.reorder', { profile: profileId, bookmark: bookmark.id, direction: event.key === 'ArrowUp' ? 'up' : 'down' })
  }
  let click = (event: MouseEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation() }
  return <button type="button" data-picker-action className={css.bookmarkDragHandle} draggable onDragStart={dragStart} onDragEnd={endDrag} onClick={click} onKeyDown={keys} aria-label={`Drag ${bookmark.title || bookmark.url} to reorder`} title="Drag to reorder; Option+Up/Down also moves one place"><svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3" cy="3" r="1" /><circle cx="9" cy="3" r="1" /><circle cx="3" cy="8" r="1" /><circle cx="9" cy="8" r="1" /><circle cx="3" cy="13" r="1" /><circle cx="9" cy="13" r="1" /></svg></button>
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
  let { state, run, dismiss } = useUI()
  let paneLabel = permissionPaneLabel(state.model, permission.paneId)
  let selected = selection(state).pane?.id === permission.paneId
  let visit = async () => { if (await run('permission.visit', { id: permission.id, pane: permission.paneId }) !== undefined) dismiss() }
  let deny = () => { void run('permission.respond', { id: permission.id, allow: false }) }
  let allow = () => { void run('permission.respond', { id: permission.id, allow: true }) }
  return <div className={css.row}>{permission.origin}: {permission.permission}<div>{!selected && <button onClick={visit} title={paneLabel} disabled={!paneLabel}>Go to pane</button>}<button onClick={deny}>Deny</button><button onClick={allow}>Allow</button></div></div>
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

let BuiltinPluginSettings = ({ feature, matches }: { feature: BuiltinTool; matches?: Set<string> }) => {
  let { state, run } = useUI()
  let { tab, profile } = selection(state)
  let tools = state.browserTools, current = tab && tools?.tabs[tab.id]
  let [scope, setScope] = useState(feature === 'dark-mode' ? 'profile' : 'site')
  let settings = scope === 'global' ? tools?.defaults : scope === 'profile' ? current?.profileDefaults : current
  let included = (target: string) => {
    if (matches && !matches.has(target)) return false
    if (feature === 'dark-mode' && target === '[name="showDarkModeButton"]') return true
    if (feature === 'userscripts') return target.startsWith('[data-setting-script=') || target === '[data-setting-id="reload-scripts"]'
    return ['[data-setting-id="tool-scope"]', '[data-setting-id="reset-tools"]', `[data-setting-id="${feature}"]`, ...(feature === 'adblock' ? ['[data-setting-id="update-filters"]'] : [])].includes(target)
  }
  let changeScope = (event: ChangeEvent<HTMLSelectElement>) => setScope(event.target.value)
  let adblock = () => { void run('browser.set', { tab: tab?.id, setting: 'adblock', value: !settings?.adblock, scope }) }
  let dark = (event: ChangeEvent<HTMLSelectElement>) => { void run('browser.set', { tab: tab?.id, setting: 'darkMode', value: event.target.value, scope }) }
  let inherit = () => { void run('browser.set', { tab: tab?.id, setting: feature === 'adblock' ? 'adblock' : 'darkMode', value: 'inherit', scope }) }
  let update = () => { void run('browser.update-filters') }
  let reload = () => { void run('browser.reload-scripts') }
  let edit = () => { void run('settings.open') }
  let toggleScript = (event: ChangeEvent<HTMLInputElement>) => { void run('browser.script', { id: event.target.dataset.id, enabled: event.target.checked }) }
  let showInAddressBar = (event: ChangeEvent<HTMLInputElement>) => { void run('settings.set', { key: 'showDarkModeButton', value: event.target.checked }) }
  let filters = tools?.filters
  if (matches && !Array.from(matches).some(included)) return null
  return <>
    {included('[name="showDarkModeButton"]') && <label className={css.settingsRow}><span>Show next to URL bar</span><input type="checkbox" name="showDarkModeButton" checked={state.showDarkModeButton === true} onChange={showInAddressBar} /></label>}
    {matches && <h4>{BUILTIN_TOOLS.find(tool => tool.id === feature)?.name}</h4>}
    {!matches && <p>{profile?.name} · {current?.origin || 'Open a website to change its settings'}</p>}
    {(included('[data-setting-id="tool-scope"]') || included('[data-setting-id="adblock"]') || included('[data-setting-id="dark-mode"]') || included('[data-setting-id="reset-tools"]')) && <div className={css.toolOptions}>
      {included('[data-setting-id="tool-scope"]') && <label>Apply changes to<select data-setting-id="tool-scope" value={scope} onChange={changeScope}><option value="site">This site in this profile</option><option value="profile">This profile</option><option value="global">All profiles</option></select></label>}
      {included('[data-setting-id="adblock"]') && <button data-setting-id="adblock" onClick={adblock} disabled={!tab || (scope === 'site' && !current?.origin)} aria-pressed={settings?.adblock}>Ad and tracker blocking: {settings?.adblock ? 'on' : 'off'}</button>}
      {included('[data-setting-id="dark-mode"]') && <label>Website dark mode<select data-setting-id="dark-mode" value={settings?.darkMode ?? 'off'} onChange={dark} disabled={!tab || (scope === 'site' && !current?.origin)}><option value="off">Off</option><option value="dark">Dark Reader</option><option value="system">Follow system</option></select></label>}
      {included('[data-setting-id="reset-tools"]') && <button data-setting-id="reset-tools" onClick={inherit} disabled={!tab || (scope === 'site' && !current?.origin)}>Reset to inherited settings</button>}
    </div>}
    {!matches && current?.error && <p className={css.error}>{current.error}</p>}
    {!matches && feature === 'dark-mode' && scope !== 'site' && current?.origin && current.darkMode !== settings?.darkMode && <p>This site overrides the default: dark mode {current.darkMode}.</p>}
    {!matches && feature === 'adblock' && <>
      <p>Blocking {current?.adblock ? 'on' : 'off'} · {current?.blocked ?? 0} requests blocked since navigation. Reload to retry blocked resources.</p>
      <p>Filter lists: {!filters ? 'Loading' : filters.error ? 'Needs attention' : filters.updating ? 'Updating' : filters.network ? 'Ready' : 'Unavailable'} · {filters?.network ?? 0} network rules · {filters?.cosmetic ?? 0} cosmetic rules. Updated {filters?.updatedAt ? new Date(filters.updatedAt).toLocaleDateString() : 'never'}.</p>
      {!!current?.recent.length && <details><summary>Blocked requests</summary>{current.recent.map((request, index) => <div className={css.row} key={`${request.time}:${index}`}>{request.host} · {request.type} · {new Date(request.time).toLocaleTimeString()}</div>)}</details>}
      {filters?.error && <p className={css.error}>{filters.error}</p>}
    </>}
    {included('[data-setting-id="update-filters"]') && <button data-setting-id="update-filters" onClick={update} disabled={filters?.updating}>{filters?.updating ? 'Updating filters…' : 'Update filters'}</button>}
    {tools?.scripts.filter(script => included(`[data-setting-script="${CSS.escape(script.id)}"]`)).map(script => <label className={css.row} key={script.id}><input type="checkbox" data-id={script.id} data-setting-script={script.id} checked={script.enabled} onChange={toggleScript} />{script.name}{script.error && <span className={css.error}>{script.error}</span>}</label>)}
    {!matches && feature === 'userscripts' && !tools?.scripts.length && <p>No userscripts. Add local .js or .css files under browser.userscripts in the config.</p>}
    {included('[data-setting-id="reload-scripts"]') && <button data-setting-id="reload-scripts" onClick={reload}>Reload scripts</button>}
    {!matches && feature === 'userscripts' && <button onClick={edit}>Edit config</button>}
  </>
}

type SettingsTab = 'general' | 'appearance' | 'memory' | 'keyboard' | 'account'
type SettingsSearchItem = { tab: SettingsTab; label: string; section?: string; keywords?: string; target: string }
let SETTINGS_TABS: { id: SettingsTab; label: string }[] = [{ id: 'general', label: 'General' }, { id: 'appearance', label: 'Appearance' }, { id: 'memory', label: 'Memory' }, { id: 'keyboard', label: 'Keyboard' }, { id: 'account', label: 'Account' }]
let SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  { tab: 'account', label: 'Relay, boxes and billing', section: 'Remote account', keywords: 'rent server subscription payment connect computer live views streams', target: '[data-setting-id="remote-account"]' },
  { tab: 'general', label: 'About bmux', section: 'Build information', keywords: 'version build commit date timestamp', target: '[data-setting-id="build-info"]' },
  { tab: 'general', label: 'Normal session search app', section: 'Search apps', keywords: 'search engine', target: '[name="searchApps.normal"]' },
  { tab: 'general', label: 'Private session search app', section: 'Search apps', keywords: 'search engine', target: '[name="searchApps.private"]' },
  { tab: 'general', label: 'Vim editing', section: 'Text editing', keywords: 'URL address rename tabs sessions normal insert motions website fields Ctrl E', target: '[name="vimEditing"]' },
  { tab: 'general', label: 'Allow page inspection', section: 'Accessibility', keywords: 'screen readers', target: '[name="accessibility"]' },
  { tab: 'general', label: 'Default browser', section: 'Default browser', target: '[data-setting-id="default-browser"]' },
  { tab: 'appearance', label: 'Status bar', section: 'Browser layout', keywords: 'top bottom', target: '[name="statusBar"]' },
  { tab: 'appearance', label: 'Window close buttons', section: 'Browser layout', target: '[name="showTabCloseButtons"]' },
  { tab: 'appearance', label: 'Click mode', section: 'Click mode', keywords: 'enabled', target: '[name="clickMode.enabled"]' },
  { tab: 'appearance', label: 'Double tap to activate', section: 'Click mode', keywords: 'modifier', target: '[name="clickMode.doubleTapModifier"]' },
  { tab: 'memory', label: 'Load inactive sessions on demand', keywords: 'lazy restore', target: '[name="memory.lazyRestore"]' },
  { tab: 'memory', label: 'Unload idle pages', keywords: 'minutes', target: '[name="memory.idleUnloadMinutes"]' },
  { tab: 'keyboard', label: 'Keyboard prefix', target: '[aria-label="Keyboard prefix"]' },
  { tab: 'keyboard', label: 'Save prefix', target: '[data-setting-id="save-prefix"]' },
  { tab: 'keyboard', label: 'Edit shortcuts in config', target: '[data-setting-id="edit-shortcuts"]' },
]
let SearchAppOptions = () => <>{SEARCH_APPS.map(app => <option key={app} value={app}>{({ google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', brave: 'Brave Search' } as Record<string, string>)[app]}</option>)}</>
let BuildInformation = () => {
  let { state } = useUI()
  if (!state.buildInfo) return null
  let { version, revision, builtAt } = state.buildInfo
  return <section className={css.settingsGroup} data-setting-id="build-info" aria-label="About bmux"><h3>About bmux</h3>
    <dl className={css.buildDetails}><dt>Version</dt><dd>{version}</dd><dt>Commit</dt><dd>{revision}</dd><dt>Built at (UTC)</dt><dd>{builtAt}</dd></dl>
  </section>
}
let GeneralSettings = ({ changeSetting, makeDefault, matches }: { changeSetting: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; makeDefault: () => void; matches?: Set<string> }) => {
  let { state } = useUI()
  let show = (target: string) => !matches || matches.has(target)
  return <>
    {show('[data-setting-id="build-info"]') && <BuildInformation />}
    {(show('[name="searchApps.normal"]') || show('[name="searchApps.private"]')) && <section className={css.settingsGroup} aria-label="Search apps"><h3>Search apps</h3>
      {show('[name="searchApps.normal"]') && <label className={css.settingsRow}><span>Normal session search app</span><select name="searchApps.normal" value={state.searchApps?.normal ?? DEFAULT_SEARCH_APPS.normal} onChange={changeSetting}><SearchAppOptions /></select></label>}
      {show('[name="searchApps.private"]') && <label className={css.settingsRow}><span>Private session search app</span><select name="searchApps.private" value={state.searchApps?.private ?? DEFAULT_SEARCH_APPS.private} onChange={changeSetting}><SearchAppOptions /></select></label>}
    </section>}
    {show('[name="vimEditing"]') && <section className={css.settingsGroup} aria-label="Text editing"><h3>Text editing</h3>
      <label className={css.settingsRow}><span>Vim editing</span><input type="checkbox" name="vimEditing" checked={state.vimEditing !== false} onChange={changeSetting} /></label>
      <p className={css.settingsHint}>Use Vim motions in URL bars and tab/session names. Click the Vim hint in website text fields to open an editor. Customize the vim-editor shortcut in your keyboard configuration.</p>
    </section>}
    {show('[name="accessibility"]') && <section className={css.settingsGroup} aria-label="Accessibility"><h3>Accessibility</h3>
      <label className={css.settingsRow}><span>Allow page inspection</span><input type="checkbox" name="accessibility" checked={state.accessibility === true} onChange={changeSetting} /></label>
      <p className={css.settingsHint}>Lets screen readers and other accessibility tools inspect page controls.</p>
    </section>}
    {show('[data-setting-id="default-browser"]') && <section className={css.settingsGroup} aria-label="Default browser"><h3>Default browser</h3>
      <button data-setting-id="default-browser" className={css.settingsDefaultBrowser} onClick={makeDefault}>Make bmux the default browser</button>
    </section>}
  </>
}
let AppearanceSettings = ({ changeSetting, matches }: { changeSetting: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; matches?: Set<string> }) => {
  let { state } = useUI()
  let show = (target: string) => !matches || matches.has(target)
  return <>
    {(show('[name="statusBar"]') || show('[name="showTabCloseButtons"]')) && <section className={css.settingsGroup} aria-label="Browser layout"><h3>Browser layout</h3>
      {show('[name="statusBar"]') && <label className={css.settingsRow}><span>Status bar</span><select name="statusBar" value={state.statusBar ?? 'top'} onChange={changeSetting}><option value="top">Top</option><option value="bottom">Bottom</option></select></label>}
      {show('[name="showTabCloseButtons"]') && <label className={css.settingsRow}><span>Window close buttons</span><input type="checkbox" name="showTabCloseButtons" checked={state.showTabCloseButtons === true} onChange={changeSetting} /></label>}
    </section>}
    {(show('[name="clickMode.enabled"]') || show('[name="clickMode.doubleTapModifier"]')) && <section className={css.settingsGroup} aria-label="Click mode"><h3>Click mode</h3>
      {show('[name="clickMode.enabled"]') && <label className={css.settingsRow}><span>Enabled</span><input type="checkbox" name="clickMode.enabled" checked={state.clickMode?.enabled !== false} onChange={changeSetting} /></label>}
      {show('[name="clickMode.doubleTapModifier"]') && <label className={css.settingsRow}><span>Double tap to activate</span><select name="clickMode.doubleTapModifier" value={state.clickMode?.doubleTapModifier ?? 'none'} onChange={changeSetting} disabled={state.clickMode?.enabled === false}><option value="none">Off</option><option value="Option">Option</option><option value="Command">Command</option><option value="Control">Control</option><option value="Shift">Shift</option><option value="Escape">Escape</option></select></label>}
    </section>}
  </>
}
let MemorySettings = ({ changeSetting, matches }: { changeSetting: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; matches?: Set<string> }) => {
  let { state } = useUI()
  let minutes = state.memory?.idleUnloadMinutes ?? 0
  let show = (target: string) => !matches || matches.has(target)
  return <>
    {show('[name="memory.lazyRestore"]') && <><label className={css.settingsRow}><span>Load inactive sessions on demand</span><input type="checkbox" name="memory.lazyRestore" checked={state.memory?.lazyRestore !== false} onChange={changeSetting} /></label>
    <p className={css.settingsHint}>Applies on the next launch. Agent commands load pages when addressed. Background profiles still start normally.</p></>}
    {show('[name="memory.idleUnloadMinutes"]') && <><label className={css.settingsRow}><span>Unload idle pages</span><select name="memory.idleUnloadMinutes" value={minutes} onChange={changeSetting}><option value="0">Off</option><option value="5">After 5 minutes</option><option value="15">After 15 minutes</option><option value="30">After 30 minutes</option><option value="60">After 1 hour</option>{![0, 5, 15, 30, 60].includes(minutes) && <option value={minutes}>After {minutes} minutes</option>}</select></label>
    <p className={css.settingsHint}>Only hidden, inactive pages that pass safety checks are unloaded. Page memory and JavaScript state cannot always be restored; use Keep Page Loaded for important windows.</p></>}
  </>
}
let KeyboardSettings = ({ prefix, currentPrefix, changePrefix, savePrefix, edit, matches }: { prefix: string; currentPrefix?: string; changePrefix: (event: ChangeEvent<HTMLInputElement>) => void; savePrefix: () => void; edit: () => void; matches?: Set<string> }) => <>
  {(!matches || matches.has('[aria-label="Keyboard prefix"]')) && <label className={css.settingsRow}><span>Prefix</span><input type="text" aria-label="Keyboard prefix" value={prefix} onChange={changePrefix} /></label>}
  {(!matches || matches.has('[data-setting-id="save-prefix"]')) && <button data-setting-id="save-prefix" onClick={savePrefix} disabled={prefix === currentPrefix}>Save prefix</button>}
  {(!matches || matches.has('[data-setting-id="edit-shortcuts"]')) && <button data-setting-id="edit-shortcuts" onClick={edit}>Edit shortcuts in config</button>}
</>
type SettingsSearchResultsProps = { results: SettingsSearchItem[]; changeSetting: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; makeDefault: () => void; prefix: string; currentPrefix?: string; changePrefix: (event: ChangeEvent<HTMLInputElement>) => void; savePrefix: () => void; edit: () => void }
let SettingsSearchResults = ({ results, changeSetting, makeDefault, prefix, currentPrefix, changePrefix, savePrefix, edit }: SettingsSearchResultsProps) => {
  let matches = new Set(results.map(item => item.target))
  let tabs = SETTINGS_TABS.filter(tab => results.some(item => item.tab === tab.id))
  return <div className={css.settingsResults} role="group" aria-label="Settings search results">{tabs.map(tab => <section key={tab.id} className={css.settingsResultGroup} aria-label={tab.label}>
    <h3>{tab.label}</h3>
    {tab.id === 'general' && <GeneralSettings changeSetting={changeSetting} makeDefault={makeDefault} matches={matches} />}
    {tab.id === 'appearance' && <AppearanceSettings changeSetting={changeSetting} matches={matches} />}
    {tab.id === 'memory' && <MemorySettings changeSetting={changeSetting} matches={matches} />}
    {tab.id === 'keyboard' && <KeyboardSettings prefix={prefix} currentPrefix={currentPrefix} changePrefix={changePrefix} savePrefix={savePrefix} edit={edit} matches={matches} />}
    {tab.id === 'account' && <DesktopRemoteAccount />}
  </section>)}{!results.length && <p role="status">No matching settings.</p>}</div>
}
let SettingsContent = () => {
  let { state, run, onMessage, settingsTarget, setSettingsTarget } = useUI()
  let [savedTab, setTab] = useSettingsState<SettingsTab>('settings:tab', 'general')
  let tab = SETTINGS_TABS.some(tab => tab.id === savedTab) ? savedTab : 'general'
  let [query, setQuery] = useSettingsState('settings:query', '')
  let [prefix, setPrefix] = useSettingsState('settings:prefix', state.keyboard?.prefix ?? DEFAULT_KEYBOARD.prefix)
  let root = useRef<HTMLDivElement>(null)
  let searchInput = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (settingsTarget !== 'build') return
    setTab('general'); setQuery(''); setSettingsTarget(null)
    root.current?.querySelector('[role="tabpanel"]')?.scrollTo(0, 0)
  }, [settingsTarget, setSettingsTarget, setTab, setQuery])
  let savedPrefix = state.keyboard?.prefix ?? DEFAULT_KEYBOARD.prefix, previousPrefix = useRef(savedPrefix)
  useEffect(() => { if (previousPrefix.current !== savedPrefix) { previousPrefix.current = savedPrefix; setPrefix(savedPrefix) } }, [savedPrefix, setPrefix])
  let makeDefault = async () => { if (await run('settings.default-browser')) onMessage('Default browser requested. Confirm any macOS prompt; you can also choose bmux in System Settings > Desktop & Dock.') }
  let changeTab = (event: MouseEvent<HTMLButtonElement>) => { setQuery(''); setTab(event.currentTarget.dataset.tab as SettingsTab) }
  let moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    let index = SETTINGS_TABS.findIndex(item => item.id === (event.target as HTMLElement).dataset.tab)
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? SETTINGS_TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length
    setQuery(''); setTab(SETTINGS_TABS[next].id)
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
  let results = query.trim() ? SETTINGS_SEARCH_ITEMS.map(item => ({ item, match: fuzzyMatch(query, `${item.label} ${item.section ?? ''} ${SETTINGS_TABS.find(tab => tab.id === item.tab)?.label} ${item.keywords ?? ''}`) })).filter(result => result.match).sort((a, b) => b.match!.score - a.match!.score).map(result => result.item) : []
  let focusResult = () => root.current?.querySelector<HTMLElement>(`.${css.settingsResults} input:not(:disabled), .${css.settingsResults} select:not(:disabled), .${css.settingsResults} button:not(:disabled)`)?.focus()
  let searchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); return }
    if (results.length && (event.key === 'Enter' || event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey))) { event.preventDefault(); focusResult() }
  }
  let typeToSearch = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || event.key === ' ') return
    if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable="true"]')) return
    event.preventDefault(); setQuery(current => current + event.key); searchInput.current?.focus()
  }
  let changeSearch = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)
  return <div ref={root} className={css.settings} onKeyDown={typeToSearch}>
    <SearchInput ref={searchInput} aria-label="Search settings" placeholder="Search settings" value={query} onChange={changeSearch} onKeyDown={searchKeys} autoFocus />
    <div className={css.panelTabs} role="tablist" aria-label="Settings sections" onKeyDown={moveTab}>{SETTINGS_TABS.map(item => <button key={item.id} type="button" role="tab" data-tab={item.id} aria-selected={tab === item.id} aria-controls="settings-panel" tabIndex={tab === item.id ? 0 : -1} onClick={changeTab}>{item.label}</button>)}</div>
    <section id="settings-panel" role="tabpanel" aria-label={SETTINGS_TABS.find(item => item.id === tab)?.label} className={css.settingsContent}>
      {query.trim() ? <SettingsSearchResults results={results} changeSetting={changeSetting} makeDefault={makeDefault} prefix={prefix} currentPrefix={state.keyboard?.prefix} changePrefix={changePrefix} savePrefix={savePrefix} edit={edit} /> : <>
      {tab === 'general' && <GeneralSettings changeSetting={changeSetting} makeDefault={makeDefault} />}
      {tab === 'appearance' && <AppearanceSettings changeSetting={changeSetting} />}
      {tab === 'memory' && <MemorySettings changeSetting={changeSetting} />}
      {tab === 'keyboard' && <KeyboardSettings prefix={prefix} currentPrefix={state.keyboard?.prefix} changePrefix={changePrefix} savePrefix={savePrefix} edit={edit} />}
      {tab === 'account' && <DesktopRemoteAccount />}
      </>}
    </section>
    {state.configError && <p className={css.error}>{state.configError}</p>}
    <footer className={css.settingsFooter}><button onClick={edit}>Edit config</button><button onClick={reload}>Reload</button></footer>
  </div>
}
