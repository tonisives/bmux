import { indexedTarget, resolvePaneTarget } from '../shared/command-target'
import { selectClientWindow } from './model'
import type { KeyboardConfig } from '../shared/keyboard'
import type { Model } from '../shared/types'

export let switchClient = (model: Model, args: Record<string, unknown>, keyboard?: KeyboardConfig) => {
  let client = model.clients.find(client => client.id === args.client)
  if (!client) throw new Error(`Client '${args.client}' not found`)
  let current = model.sessions.find(session => session.id === client.sessionId)!
  let modes = ['last', 'next', 'previous'].filter(key => args[key])
  if (modes.length > 1) throw new Error('Use only one of -l, -n or -p')
  if (args.sortOrder !== undefined && !['name', 'size', 'creation', 'activity'].includes(String(args.sortOrder))) throw new Error('Sort order must be name, size, creation or activity')
  if (args.sortOrder !== undefined && !args.next && !args.previous) throw new Error('-O requires -n or -p')
  let keyTable = args.keyTable === undefined ? undefined : String(args.keyTable)
  if (keyTable !== undefined && !['root', 'prefix'].includes(keyTable) && !Object.hasOwn(keyboard?.keyTables ?? {}, keyTable)) throw new Error(`Key table '${keyTable}' not found`)
  if (keyTable !== undefined) {
    if (args.readOnly) { client.readOnly = !client.readOnly; client.ignoreSize = client.readOnly }
    client.keyTable = keyTable === 'root' ? undefined : keyTable
    return client
  }
  let session = current, paneId: string | undefined, windowId: string | undefined
  if (args.last) {
    let previous = client.sessionHistory?.map(id => model.sessions.find(session => session.id === id && id !== current.id)).find(session => session)
    if (!previous) throw new Error('No last session')
    session = previous
  } else if (args.next || args.previous) {
    let sessions = [...model.sessions], order = String(args.sortOrder ?? 'name')
    // Existing saved sessions retain their creation order until they have timestamps.
    let creation = (session: typeof current) => session.createdAt ?? model.sessions.indexOf(session)
    let size = (session: typeof current) => session.windows.length
    sessions.sort((a, b) => (order === 'name' ? a.name.localeCompare(b.name) : order === 'size' ? size(a) - size(b) : order === 'activity' ? (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0) : creation(a) - creation(b)) || creation(a) - creation(b))
    session = sessions[(sessions.indexOf(current) + (args.previous ? -1 : 1) + sessions.length) % sessions.length]
  } else if (args.session !== undefined) {
    let target = String(args.session)
    // Exact session IDs and names take precedence over punctuation in their names.
    let exact = model.sessions.find(session => session.id === target || session.name === target)
    if (!exact && (/[.:%]/.test(target) || model.sessions.some(session => session.windows.some(window => window.id === target || window.panes.some(pane => pane.id === target))))) {
      let resolved = resolvePaneTarget({ model, clientId: client.id }, target)
      session = resolved.session; windowId = resolved.window.id; paneId = resolved.pane.id
    } else {
      session = indexedTarget(model.sessions, target, 'Session')!
      if (!session) throw new Error(`Session '${target}' not found`)
    }
  }
  if (windowId === undefined) windowId = client.sessionId === session.id ? client.windowId : client.windowHistory?.find(id => session.windows.some(window => window.id === id))
  let window = session.windows.find(window => window.id === windowId) ?? session.windows[0]
  selectClientWindow(client, session, window)
  if (paneId !== undefined) {
    let zoomed = client.zoomedPaneId
    client.paneId = paneId
    client.zoomedPaneId = args.keepZoom && zoomed ? paneId : null
    if (client.zoomedPaneId) (client.windowZooms ??= {})[window.id] = paneId
    else if (client.windowZooms) delete client.windowZooms[window.id]
  }
  if (args.readOnly) { client.readOnly = !client.readOnly; client.ignoreSize = client.readOnly }
  client.keyTable = undefined
  return client
}
