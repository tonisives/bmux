import type { InternalWindow, Model, WorkspaceSession } from '../shared/types'
import { mapLayout, orderPinnedWindows, paneById, removeSession, resolve } from './model'
import { layoutPaneIds } from './floating'

export let checkSessionTransfer = (from: WorkspaceSession, to: WorkspaceSession) => {
  if (from !== to && (from.private || to.private)) throw new Error('Cannot move panes or windows between private and other sessions')
}

export let toggleWindowPin = (model: Model, windowId: unknown) => {
  let window = resolve(model.sessions.flatMap(session => session.windows), windowId, 'Window')
  let session = model.sessions.find(session => session.windows.includes(window))!
  window.pinned = !window.pinned
  orderPinnedWindows(session)
  return window
}

export let insertionIndex = (session: WorkspaceSession, position: unknown, before = false, after = false) => {
  let index = position === 'first' ? 0 : position === 'last' || position === undefined ? session.windows.length : Number(position) - 1
  if (!Number.isInteger(index) || index < 0 || index > session.windows.length || ((before || after) && index === session.windows.length)) throw new Error(`Window index must be between 1 and ${session.windows.length + (before || after ? 0 : 1)}`)
  return index + (after ? 1 : 0)
}

export let moveWindow = (model: Model, args: Record<string, unknown>) => {
  let client = args.client ? resolve(model.clients, args.client, 'Client') : undefined
  let window = resolve(model.sessions.flatMap(session => session.windows), args.window ?? client?.windowId, 'Window')
  let from = model.sessions.find(session => session.windows.includes(window))!
  let to = args.session ? resolve(model.sessions, args.session, 'Session') : from
  checkSessionTransfer(from, to)
  let index = from.windows.indexOf(window), destination = insertionIndex(to, args.position, args.before === true, args.after === true)
  if (from === to) {
    // Plain indices are final positions. Before/after refer to the original target.
    if ((args.before === true || args.after === true) && index < destination) destination--
    destination = Math.min(destination, to.windows.length - 1)
  }
  from.windows.splice(index, 1)
  to.windows.splice(destination, 0, window)
  orderPinnedWindows(to)
  if (client && args.background !== true) {
    client.sessionId = to.id; client.windowId = window.id
    client.paneId = window.panes.some(pane => pane.id === client.paneId) ? client.paneId : window.panes[0]?.id ?? null
    if (!window.panes.some(pane => pane.id === client.zoomedPaneId)) client.zoomedPaneId = null
  }
  if (!from.windows.length) removeSession(model, from)
  return window
}

export let swapWindows = (model: Model, args: Record<string, unknown>) => {
  let windows = model.sessions.flatMap(session => session.windows)
  let source = resolve(windows, args.window, 'Window'), destination = resolve(windows, args.destination, 'Window')
  if (source === destination) return source
  let from = model.sessions.find(session => session.windows.includes(source))!, to = model.sessions.find(session => session.windows.includes(destination))!
  checkSessionTransfer(from, to)
  if (from === to && !!source.pinned !== !!destination.pinned) return source
  let sourceIndex = from.windows.indexOf(source), destinationIndex = to.windows.indexOf(destination)
  from.windows[sourceIndex] = destination; to.windows[destinationIndex] = source
  orderPinnedWindows(from); orderPinnedWindows(to)
  for (let client of model.clients) {
    if (![source.id, destination.id].includes(client.windowId)) continue
    let selected = client.windowId === source.id ? source : destination
    if (args.background === true || client.id !== args.client) selected = selected === source ? destination : source
    let session = selected === source ? to : from
    client.sessionId = session.id; client.windowId = selected.id
    if (!selected.panes.some(pane => pane.id === client.paneId)) client.paneId = selected.panes[0]?.id ?? null
    if (!selected.panes.some(pane => pane.id === client.zoomedPaneId)) client.zoomedPaneId = null
  }
  return source
}

let replacePaneSlots = (window: InternalWindow, replacements: Map<string, string>) => {
  let replacement = (id: string) => replacements.get(id) ?? id
  window.layout = mapLayout(window.layout, node => node.kind === 'pane' ? { ...node, paneId: replacement(node.paneId) } : node)
  window.floating = window.floating?.map(item => ({ ...item, paneId: replacement(item.paneId), dock: item.dock ? { ...item.dock, siblingIds: item.dock.siblingIds.map(replacement) } : undefined }))
}

export let swapPanes = (model: Model, args: Record<string, unknown>) => {
  let source = paneById(model, args.pane), destination = paneById(model, args.destination)
  if (source.pane === destination.pane) return source.pane
  checkSessionTransfer(source.session, destination.session)
  let replacements = new Map([[source.pane.id, destination.pane.id], [destination.pane.id, source.pane.id]])
  for (let window of new Set([source.window, destination.window])) {
    window.panes = window.panes.map(pane => pane === source.pane ? destination.pane : pane === destination.pane ? source.pane : pane)
    replacePaneSlots(window, replacements)
    for (let client of model.clients.filter(client => client.windowId === window.id)) {
      if (args.background === true || client.id !== args.client) client.paneId = client.paneId ? replacements.get(client.paneId) ?? client.paneId : null
      else client.paneId = window === source.window ? destination.pane.id : source.pane.id
      client.zoomedPaneId = args.keepZoom === true && client.zoomedPaneId ? client.paneId : null
    }
  }
  return source.pane
}

export let rotatePanes = (model: Model, args: Record<string, unknown>) => {
  let window = resolve(model.sessions.flatMap(session => session.windows), args.window, 'Window')
  let order = layoutPaneIds(window.layout)
  if (order.length < 2) return window
  let direction = Number(args.direction ?? 1)
  if (![-1, 1].includes(direction)) throw new Error('Pane direction must be -1 or 1')
  let replacements = new Map(order.map((id, index) => [id, order[(index - direction + order.length) % order.length]]))
  replacePaneSlots(window, replacements)
  let byId = new Map(window.panes.map(pane => [pane.id, pane]))
  window.panes = window.panes.map(pane => byId.get(replacements.get(pane.id) ?? pane.id)!)
  for (let client of model.clients.filter(client => client.windowId === window.id)) {
    if (client.paneId) client.paneId = replacements.get(client.paneId) ?? client.paneId
    client.zoomedPaneId = args.keepZoom === true && client.zoomedPaneId ? client.paneId : null
  }
  return window
}
