import type { BrowserToolsState } from './browser-tools'
import type { KeyboardConfig } from './keyboard'
import type { PluginInfo, PluginPrompt, PluginRun } from './plugins'
import type { ClickModeSettings } from './click-mode'
export type StatusBarPosition = 'top' | 'bottom'
export type Bookmark = { id: string; title: string; url?: string; children?: Bookmark[] }
export type BookmarkParameters = { values: Record<string, string>; hidden: string[] }
export type BookmarkParameterSettings = Record<string, Record<string, BookmarkParameters>>
export type HistoryEntry = { url: string; title: string; visitedAt: number }
export type Profile = { id: string; name: string; background: boolean; bookmarks?: Bookmark[]; history?: HistoryEntry[]; braveSource?: { root: string; directory: string } }
export type Tab = { id: string; url: string; title: string; zoom: number; openerTabId?: string }
export type Pane = { id: string; profileId: string; tabs: Tab[]; activeTabId: string }
export type Layout = { kind: 'pane'; paneId: string } | { kind: 'split'; id: string; axis: 'horizontal' | 'vertical'; ratio: number; first: Layout; second: Layout }
export type InternalWindow = { id: string; name: string; automaticName?: boolean; layout: Layout | null; panes: Pane[] }
export type WorkspaceSession = { id: string; name: string; defaultProfileId: string; windows: InternalWindow[] }
export type Client = { id: string; sessionId: string; sessionHistory?: string[]; windowId: string; windowHistory?: string[]; paneId: string | null; zoomedPaneId?: string | null; width: number; height: number }
export type SavedLayout = { name: string; window: InternalWindow }
export type Model = { version: 1; profiles: Profile[]; sessions: WorkspaceSession[]; clients: Client[]; layouts: SavedLayout[] }
export type Permission = { id: string; profileId: string; origin: string; permission: string; tabId: string }
export type Download = { id: string; profileId: string; name: string; path: string; state: string; received: number; total: number; paused: boolean; canResume: boolean; active: boolean }
export type Snapshot = { image: string; capturedAt: number }
export type FindResult = { requestId: number; text: string; matches: number; activeMatchOrdinal: number; finalUpdate: boolean }
export type NavigationStack = { activeIndex: number; entries: { title: string; url: string }[] }
export type PublicState = { findResults?: Record<string, FindResult>; browserTools?: BrowserToolsState; plugins?: PluginInfo[]; pluginRuns?: PluginRun[]; pluginPrompt?: PluginPrompt; bookmarkParameters?: BookmarkParameterSettings; accessibility?: boolean; clickMode?: ClickModeSettings; statusBar?: StatusBarPosition; showTabCloseButtons?: boolean; keyboard?: KeyboardConfig; configPath?: string; configError?: string | null; model: Model; clientId: string; focusedClientId: string | null; snapshots: Record<string, Snapshot>; crashes: Record<string, string>; loading: Record<string, boolean>; favicons: Record<string, string>; pendingUrls: Record<string, string>; navigation: Record<string, NavigationStack>; permissions: Permission[]; downloads: Download[] }
export type Command = { method: string; args?: Record<string, unknown> }
export type Bounds = { tabId: string; x: number; y: number; width: number; height: number }
export type Bridge = {
  controls: (listener: (control: string) => void) => () => void
  linkPreview: (listener: (url: string) => void) => () => void
  state: () => Promise<PublicState>
  command: (command: Command) => Promise<unknown>
  bounds: (bounds: Bounds[]) => void
  subscribe: (listener: (state: PublicState) => void) => () => void
}
