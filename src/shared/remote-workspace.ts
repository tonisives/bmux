import type { Client, Layout, Model, WorkspaceSession } from './types'
import type { RemoteWorkspaceSnapshot } from './remote'

export let remoteWorkspaceId = (scope: string, kind: 'session' | 'window' | 'pane' | 'split', id: string) => `remote:${scope}:${kind}:${id}`

export let projectRemoteWorkspace = (snapshot: RemoteWorkspaceSnapshot, source: NonNullable<WorkspaceSession['remote']>, profileId: string): WorkspaceSession => {
  let scoped = (kind: 'session' | 'window' | 'pane' | 'split', id: string) => remoteWorkspaceId(source.clientId, kind, id)
  let layout = (node: Layout): Layout => node.kind === 'pane' ? { ...node, paneId: scoped('pane', node.paneId) } : { ...node, id: scoped('split', node.id), first: layout(node.first), second: layout(node.second) }
  return {
    id: scoped('session', snapshot.session.id), name: snapshot.session.name, defaultProfileId: profileId,
    ephemeral: true, private: snapshot.session.private, remote: source,
    windows: snapshot.session.windows.map(window => ({
      ...window, id: scoped('window', window.id), layout: window.layout && layout(window.layout),
      floating: window.floating?.map(item => ({ ...item, paneId: scoped('pane', item.paneId), dock: item.dock && { ...item.dock, siblingIds: item.dock.siblingIds.map(id => scoped('pane', id)) } })),
      lastFloating: undefined,
      panes: window.panes.map(({ bookmarkSource: _bookmark, ...pane }) => ({ ...pane, id: scoped('pane', pane.id), profileId, connectionId: undefined, openerPaneId: pane.openerPaneId ? scoped('pane', pane.openerPaneId) : undefined })),
    })),
  }
}

export let latestLocalSession = (model: Model, client: Client) => {
  let local = model.sessions.filter(session => !session.ephemeral)
  let current = local.find(session => session.id === client.sessionId)
  let previous = client.sessionHistory?.map(id => local.find(session => session.id === id)).find(session => !!session)
  return current ?? previous ?? local.slice().sort((a, b) => Math.max(0, ...b.windows.map(window => window.lastVisitedAt ?? 0)) - Math.max(0, ...a.windows.map(window => window.lastVisitedAt ?? 0)))[0]
}

let mutations = new Set([
  'new-session', 'new-window', 'new-pane', 'split-window', 'tab.create', 'tab.close', 'tab.move', 'duplicate-window', 'reopen-closed', 'reopen-closed-tab',
  'kill-pane', 'kill-window', 'kill-session', 'rename-session', 'rename-window', 'toggle-window-pin', 'lock-window', 'unlock-window',
  'move-window', 'swap-window', 'reorder-window', 'renumber-windows', 'move-pane', 'swap-pane',
  'break-pane', 'join-pane', 'rotate-window', 'resize-pane', 'layout.apply', 'layout.save', 'layout.remove',
  'float.bounds', 'pane.close', 'pane.profile.set', 'session.profile.set', 'window.audio.toggle', 'session.audio.toggle',
  'select-layout', 'maximize-pane', 'save-layout', 'restore-layout', 'bookmark.open', 'history.open',
  'window.menu', 'browser.set', 'browser.script', 'browser.reset', 'find', 'site-data.clear', 'pane.menu', 'pane.keep-alive', 'tab.keep-alive', 'history.go-to',
])
export let remoteWorkspaceMutation = (method: string) => mutations.has(method)

let shortcuts = new Set(['new-client', 'new-private-session', 'split-right', 'split-down', 'close-pane', 'close-window', 'close-pane-or-window', 'move-window-left', 'move-window-right', 'move-window-first', 'move-window-last', 'toggle-dark', 'toggle-adblock', 'click-mode', 'vim-editor', 'movep', 'breakp', 'joinp', 'swapp', 'rotatew', 'movew'])
export let remoteWorkspaceShortcut = (action: string) => shortcuts.has(action) || action.startsWith('layout-') || action.startsWith('maximize-pane-') || remoteWorkspaceMutation(action)

export let remoteWorkspaceTargets = (model: Model, args: Record<string, unknown>) => {
  let ids = new Set(['session', 'window', 'pane', 'tab', 'destination', 'target', 'split'].map(key => args[key]).filter(value => typeof value === 'string'))
  return model.sessions.filter(session => session.remote && (ids.has(session.id) || session.windows.some(window => ids.has(window.id) || window.panes.some(pane => ids.has(pane.id)))))
}
