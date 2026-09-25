import type { SiteSecurity } from './site-security'
import type { BrowserToolsState } from './browser-tools'
import type { KeyboardConfig } from './keyboard'
import type { PluginInfo, PluginPrompt, PluginRun } from './plugins'
import type { ClickModeSettings, ClickModeState } from './click-mode'
export type StatusBarPosition = 'top' | 'bottom'
export type MemorySettings = { lazyRestore: boolean; idleUnloadMinutes: number }
export type Bookmark = { id: string; title: string; url?: string; children?: Bookmark[] }
export type BookmarkParameters = { values: Record<string, string>; hidden: string[] }
export type BookmarkParameterSettings = Record<string, Record<string, BookmarkParameters>>
export type HistoryEntry = { url: string; title: string; visitedAt: number }
export type ProxyProtocol = 'http' | 'https' | 'socks5'
export type ProfileProxy = { protocol: ProxyProtocol; host: string; port: number; authenticated: boolean }
export type DevicePlatform = 'android' | 'ios'
export type DeviceOrientation = 'portrait' | 'landscape'
export type DevicePreset = 'pixel-8' | 'galaxy-s24' | 'iphone-15-pro' | 'iphone-15-pro-max' | 'custom'
export type DeviceGeolocation = { latitude: number; longitude: number; accuracy: number }
export type DevicePersona = { preset: DevicePreset; platform: DevicePlatform; width: number; height: number; deviceScaleFactor: number; orientation: DeviceOrientation; locale: string; timezone: string; geolocation?: DeviceGeolocation }
export type Profile = { id: string; name: string; background: boolean; proxy?: ProfileProxy; device?: DevicePersona; bookmarks?: Bookmark[]; history?: HistoryEntry[]; braveSource?: { root: string; directory: string } }
export type Pane = { id: string; profileId: string; url: string; title: string; zoom: number; openerPaneId?: string; keepAlive?: boolean }
export type Layout = { kind: 'pane'; paneId: string } | { kind: 'split'; id: string; axis: 'horizontal' | 'vertical'; ratio: number; first: Layout; second: Layout }
export type FloatingPane = { paneId: string; x: number; y: number; width: number; height: number; dock?: { siblingIds: string[]; axis: 'horizontal' | 'vertical'; ratio: number; before: boolean } }
export type FloatingMemory = { x: number; y: number; width: number; height: number; workspaceWidth: number; workspaceHeight: number }
export type InternalWindow = { id: string; name: string; automaticName?: boolean; layout: Layout | null; panes: Pane[]; floating?: FloatingPane[]; lastFloating?: FloatingMemory }
export type WorkspaceSession = { id: string; name: string; defaultProfileId: string; private?: boolean; windows: InternalWindow[] }
export type Client = { id: string; sessionId: string; sessionHistory?: string[]; windowId: string; windowHistory?: string[]; paneId: string | null; zoomedPaneId?: string | null; width: number; height: number }
export type SavedLayout = { name: string; window: InternalWindow }
export type Model = { version: 2; profiles: Profile[]; sessions: WorkspaceSession[]; clients: Client[]; layouts: SavedLayout[] }
export type Permission = { id: string; profileId: string; origin: string; permission: string; paneId: string }
export type Download = { id: string; profileId: string; name: string; path: string; state: string; received: number; total: number; paused: boolean; canResume: boolean; active: boolean }
export type ProfileCacheState = { bytes: number; limit: number; checkedAt: number }
export type ProfileProxyTestState = { ip: string; region?: string; checkedAt: number }
export type ProfileProxyFailureState = { error: string; failedAt: number }
export type Snapshot = { image: string; capturedAt: number }
export type FindResult = { requestId: number; text: string; matches: number; activeMatchOrdinal: number; finalUpdate: boolean }
export type NavigationStack = { activeIndex: number; entries: { title: string; url: string }[] }
export type PublicState = { remoteControl?: Record<string, { owner: string; expires: number; generation: number } | undefined>; memory?: MemorySettings; security?: Record<string, SiteSecurity>; findResults?: Record<string, FindResult>; browserTools?: BrowserToolsState; plugins?: PluginInfo[]; pluginRuns?: PluginRun[]; pluginPrompt?: PluginPrompt; bookmarkParameters?: BookmarkParameterSettings; accessibility?: boolean; clickMode?: ClickModeSettings; clickModeState?: ClickModeState; statusBar?: StatusBarPosition; showTabCloseButtons?: boolean; keyboard?: KeyboardConfig; configPath?: string; configError?: string | null; startupNotice?: string; model: Model; clientId: string; focusedClientId: string | null; snapshots: Record<string, Snapshot>; crashes: Record<string, string>; loading: Record<string, boolean>; favicons: Record<string, string>; pendingUrls: Record<string, string>; navigation: Record<string, NavigationStack>; permissions: Permission[]; downloads: Download[]; profileCaches: Record<string, ProfileCacheState>; profileProxyTests: Record<string, ProfileProxyTestState>; profileProxyFailures: Record<string, ProfileProxyFailureState> }
export type Command = { method: string; args?: Record<string, unknown> }
export type Bounds = { paneId: string; x: number; y: number; width: number; height: number }
export type Bridge = {
  controls: (listener: (control: string) => void) => () => void
  linkPreview: (listener: (url: string) => void) => () => void
  state: () => Promise<PublicState>
  command: (command: Command) => Promise<unknown>
  bounds: (bounds: Bounds[]) => void
  subscribe: (listener: (state: PublicState) => void) => () => void
}
