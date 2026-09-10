export type Bookmark = { id: string; title: string; url?: string; children?: Bookmark[] }
export type Profile = { id: string; name: string; background: boolean; bookmarks?: Bookmark[]; braveSource?: { root: string; directory: string } }
export type Tab = { id: string; url: string; title: string; zoom: number }
export type Pane = { id: string; profileId: string; tabs: Tab[]; activeTabId: string }
export type Layout = { kind: 'pane'; paneId: string } | { kind: 'split'; id: string; axis: 'horizontal' | 'vertical'; ratio: number; first: Layout; second: Layout }
export type InternalWindow = { id: string; name: string; layout: Layout | null; panes: Pane[] }
export type WorkspaceSession = { id: string; name: string; defaultProfileId: string; windows: InternalWindow[] }
export type Client = { id: string; sessionId: string; windowId: string; paneId: string | null; width: number; height: number }
export type SavedLayout = { name: string; window: InternalWindow }
export type Model = { version: 1; profiles: Profile[]; sessions: WorkspaceSession[]; clients: Client[]; layouts: SavedLayout[] }
export type Permission = { id: string; profileId: string; origin: string; permission: string; tabId: string }
export type Download = { id: string; profileId: string; name: string; path: string; state: string; received: number; total: number }
export type Snapshot = { image: string; capturedAt: number }
export type PublicState = { model: Model; clientId: string; focusedClientId: string | null; snapshots: Record<string, Snapshot>; crashes: Record<string, string>; loading: Record<string, boolean>; permissions: Permission[]; downloads: Download[] }
export type Command = { method: string; args?: Record<string, unknown> }
export type Bounds = { tabId: string; x: number; y: number; width: number; height: number }
export type Bridge = {
  controls: (listener: (control: string) => void) => () => void
  state: () => Promise<PublicState>
  command: (command: Command) => Promise<unknown>
  bounds: (bounds: Bounds[]) => void
  subscribe: (listener: (state: PublicState) => void) => () => void
}
