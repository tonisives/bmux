import { randomUUID } from 'node:crypto'
import type { Layout, Model, Pane, Profile, WorkspaceSession, InternalWindow } from '../shared/types'
import { parseProfileProxy } from './profile-proxy'
import { parseDevicePersona } from './device-persona'

export let id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`
export let newPane = (profileId: string, url = 'about:blank'): Pane => ({ id: id('pane'), profileId, url, title: url === 'about:blank' ? 'New window' : url, zoom: 1 })
export let newWindow = (name: string, profileId: string, automaticName = false): InternalWindow => {
  let pane = newPane(profileId)
  return { id: id('win'), name, automaticName, panes: [pane], layout: { kind: 'pane', paneId: pane.id } }
}
export let newSession = (name: string, profileId: string, privateSession = false): WorkspaceSession => ({ id: id('session'), name, defaultProfileId: profileId, ...(privateSession ? { private: true } : {}), windows: [newWindow('main', profileId, true)] })
export let initialModel = (): Model => {
  let profiles: Profile[] = [{ id: 'profile_default', name: 'default', background: false }, { id: 'profile_bot', name: 'bot', background: true }]
  return { version: 2, profiles, sessions: [newSession('main', profiles[0].id)], clients: [], layouts: [] }
}
export let walkPanes = (model: Model) => model.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => ({ session, window, pane }))))
let domainName = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return '' }
}
export let updateAutomaticWindowName = (window: InternalWindow, paneId = window.panes[0]?.id) => {
  let automatic = window.automaticName === true || (window.automaticName === undefined && /^(main|window-\d+)$/.test(window.name))
  if (!automatic) return false
  let pane = window.panes.find(pane => pane.id === paneId) ?? window.panes[0]
  let name = pane ? domainName(pane.url) : 'empty'
  if (!name) name = /^(main|window-\d+)$/.test(window.name) ? window.name : pane?.url.startsWith('file:') ? 'file' : 'new-window'
  if (window.name === name && window.automaticName === true) return false
  window.name = name; window.automaticName = true
  return true
}
export let resolve = <T extends { id: string; name?: string }>(items: T[], value: unknown, noun: string): T => {
  let matches = items.filter(item => item.id === value || item.name === value)
  if (matches.length !== 1) throw new Error(`${noun} '${String(value)}' ${matches.length ? 'is ambiguous; use an ID' : 'not found'}`)
  return matches[0]
}
export let paneById = (model: Model, paneId: unknown) => {
  let found = walkPanes(model).find(item => item.pane.id === paneId)
  if (!found) throw new Error(`Pane '${String(paneId)}' not found`)
  return found
}
export let tabById = (model: Model, paneId: unknown) => {
  let item = paneById(model, paneId)
  return { ...item, tab: item.pane }
}
export let mapLayout = (layout: Layout | null, transform: (node: Layout) => Layout): Layout | null => {
  if (!layout) return null
  let node = layout.kind === 'split' ? { ...layout, first: mapLayout(layout.first, transform)!, second: mapLayout(layout.second, transform)! } : layout
  return transform(node)
}
export let splitLayout = (layout: Layout | null, paneId: string, addedId: string, axis: 'horizontal' | 'vertical', before = false): Layout => {
  if (!layout) return { kind: 'pane', paneId: addedId }
  return mapLayout(layout, node => node.kind === 'pane' && node.paneId === paneId
    ? { kind: 'split', id: id('split'), axis, ratio: 0.5, first: before ? { kind: 'pane', paneId: addedId } : node, second: before ? node : { kind: 'pane', paneId: addedId } }
    : node)!
}
type PaneDirection = 'left' | 'right' | 'up' | 'down'
type PaneRect = { paneId: string; x: number; y: number; width: number; height: number }
export let paneInDirection = (layout: Layout | null, paneId: string, direction: PaneDirection, rectangles?: PaneRect[]): string | undefined => {
  let panes: PaneRect[] = rectangles ?? []
  let visit = (node: Layout | null, x: number, y: number, width: number, height: number) => {
    if (!node) return
    if (node.kind === 'pane') { panes.push({ paneId: node.paneId, x, y, width, height }); return }
    if (node.axis === 'horizontal') {
      let firstWidth = width * node.ratio
      visit(node.first, x, y, firstWidth, height)
      visit(node.second, x + firstWidth, y, width - firstWidth, height)
    } else {
      let firstHeight = height * node.ratio
      visit(node.first, x, y, width, firstHeight)
      visit(node.second, x, y + firstHeight, width, height - firstHeight)
    }
  }
  if (!rectangles) visit(layout, 0, 0, 1, 1)
  let current = panes.find(pane => pane.paneId === paneId)
  if (!current) return undefined
  let horizontal = direction === 'left' || direction === 'right'
  let crossStart = (pane: PaneRect) => horizontal ? pane.y : pane.x
  let crossEnd = (pane: PaneRect) => crossStart(pane) + (horizontal ? pane.height : pane.width)
  let candidates = panes.filter(pane => {
    if (pane === current) return false
    if (rectangles) {
      let dx = pane.x + pane.width / 2 - current.x - current.width / 2
      let dy = pane.y + pane.height / 2 - current.y - current.height / 2
      return direction === 'left' ? dx < 0 : direction === 'right' ? dx > 0 : direction === 'up' ? dy < 0 : dy > 0
    }
    if (direction === 'left') return pane.x + pane.width <= current.x + Number.EPSILON
    if (direction === 'right') return pane.x >= current.x + current.width - Number.EPSILON
    if (direction === 'up') return pane.y + pane.height <= current.y + Number.EPSILON
    return pane.y >= current.y + current.height - Number.EPSILON
  })
  candidates.sort((a, b) => {
    let overlap = (pane: PaneRect) => Math.max(0, Math.min(crossEnd(current), crossEnd(pane)) - Math.max(crossStart(current), crossStart(pane)))
    let overlapRank = Number(overlap(b) > 0) - Number(overlap(a) > 0)
    if (overlapRank) return overlapRank
    let primary = (pane: PaneRect) => rectangles ? Math.abs(horizontal ? pane.x + pane.width / 2 - current.x - current.width / 2 : pane.y + pane.height / 2 - current.y - current.height / 2) : direction === 'left' ? current.x - pane.x - pane.width
      : direction === 'right' ? pane.x - current.x - current.width
        : direction === 'up' ? current.y - pane.y - pane.height : pane.y - current.y - current.height
    let crossCenter = (pane: PaneRect) => (crossStart(pane) + crossEnd(pane)) / 2
    return primary(a) - primary(b) || Math.abs(crossCenter(a) - crossCenter(current)) - Math.abs(crossCenter(b) - crossCenter(current))
  })
  return candidates[0]?.paneId
}
export let removePane = (layout: Layout | null, paneId: string): Layout | null => {
  if (!layout) return null
  if (layout.kind === 'pane') return layout.paneId === paneId ? null : layout
  let first = removePane(layout.first, paneId)
  let second = removePane(layout.second, paneId)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}
export let cloneWindow = (window: InternalWindow): InternalWindow => {
  let copy = structuredClone(window)
  let paneIds = new Map<string, string>()
  copy.id = id('win')
  for (let pane of copy.panes) {
    let paneId = id('pane')
    paneIds.set(pane.id, paneId)
    pane.id = paneId
  }
  for (let pane of copy.panes) if (pane.openerPaneId) pane.openerPaneId = paneIds.get(pane.openerPaneId)
  copy.layout = mapLayout(copy.layout, node => node.kind === 'pane' ? { ...node, paneId: paneIds.get(node.paneId)! } : { ...node, id: id('split') })
  copy.floating = copy.floating?.map(item => ({ ...item, paneId: paneIds.get(item.paneId)!, dock: item.dock ? { ...item.dock, siblingIds: item.dock.siblingIds.flatMap(id => paneIds.has(id) ? [paneIds.get(id)!] : []) } : undefined }))
  return copy
}
type LegacyTab = { id: string; url: string; title: string; zoom: number; openerTabId?: string; keepAlive?: boolean }
type LegacyPane = { id: string; profileId: string; tabs: LegacyTab[]; activeTabId: string }
type LegacyWindow = Omit<InternalWindow, 'panes'> & { panes: LegacyPane[] }
type LegacyModel = Omit<Model, 'version' | 'sessions' | 'layouts'> & { version: 1; sessions: (Omit<WorkspaceSession, 'windows'> & { windows: LegacyWindow[] })[]; layouts: { name: string; window: LegacyWindow }[] }
let upgradeWindow = (window: LegacyWindow, extraWindows?: InternalWindow[]): InternalWindow => {
  let paneIds = new Map<string, string>()
  let extras: { pane: Pane; source: string }[] = []
  let panes: Pane[] = window.panes.map(old => {
    let selected = old.tabs.find(tab => tab.id === old.activeTabId) ?? old.tabs[0]
    if (!selected) throw new Error('Missing active page in state file')
    paneIds.set(selected.id, old.id)
    for (let tab of old.tabs) if (tab !== selected) {
      let pane: Pane = { id: id('pane'), profileId: old.profileId, url: tab.url, title: tab.title, zoom: tab.zoom, ...(tab.keepAlive === undefined ? {} : { keepAlive: tab.keepAlive }) }
      paneIds.set(tab.id, pane.id)
      extras.push({ pane, source: old.id })
    }
    return { id: old.id, profileId: old.profileId, url: selected.url, title: selected.title, zoom: selected.zoom, ...(selected.keepAlive === undefined ? {} : { keepAlive: selected.keepAlive }) }
  })
  for (let old of window.panes) for (let tab of old.tabs) if (tab.openerTabId) {
    let pane = panes.find(pane => pane.id === paneIds.get(tab.id)) ?? extras.find(item => item.pane.id === paneIds.get(tab.id))?.pane
    if (pane) pane.openerPaneId = paneIds.get(tab.openerTabId)
  }
  let upgraded: InternalWindow = { ...window, panes }
  for (let { pane, source } of extras) {
    if (extraWindows) {
      extraWindows.push({ id: id('win'), name: pane.title || 'restored', automaticName: true, panes: [pane], layout: { kind: 'pane', paneId: pane.id } })
    } else {
      upgraded.panes.push(pane)
      upgraded.layout = splitLayout(upgraded.layout, source, pane.id, 'horizontal')
    }
  }
  return upgraded
}
let upgradeModel = (legacy: LegacyModel): Model => ({
  ...legacy,
  version: 2,
  sessions: legacy.sessions.map(session => {
    let windows: InternalWindow[] = []
    for (let window of session.windows) {
      let extras: InternalWindow[] = []
      windows.push(upgradeWindow(window, extras), ...extras)
    }
    return { ...session, windows }
  }),
  layouts: legacy.layouts.map(layout => ({ ...layout, window: upgradeWindow(layout.window) }))
})
export let validateModel = (value: unknown): Model => {
  let model = value && (value as { version?: number }).version === 1 ? upgradeModel(value as LegacyModel) : value as Model
  if (!model || model.version !== 2 || !Array.isArray(model.profiles) || !Array.isArray(model.sessions) || !Array.isArray(model.clients) || !Array.isArray(model.layouts)) throw new Error('Invalid or unsupported state file')
  let ids = new Set<string>()
  let checkId = (value: string) => {
    if (typeof value !== 'string' || !value || ids.has(value)) throw new Error('Invalid or duplicate ID in state file')
    ids.add(value)
  }
  for (let profile of model.profiles) {
    checkId(profile.id)
    if (typeof profile.name !== 'string' || typeof profile.background !== 'boolean') throw new Error('Invalid profile')
    if (profile.proxy !== undefined) profile.proxy = parseProfileProxy(profile.proxy)
    if (profile.device !== undefined) profile.device = parseDevicePersona(profile.device)
  }
  for (let session of model.sessions) {
    checkId(session.id)
    if (session.private !== undefined && typeof session.private !== 'boolean') throw new Error('Invalid private session setting')
    if (session.profileExplicit !== undefined && typeof session.profileExplicit !== 'boolean') throw new Error('Invalid explicit profile setting')
    delete (session as WorkspaceSession & { searchApp?: string }).searchApp
    if (!model.profiles.some(profile => profile.id === session.defaultProfileId)) throw new Error('Missing session profile')
    for (let window of session.windows) {
      checkId(window.id)
      if (window.automaticName !== undefined && typeof window.automaticName !== 'boolean') throw new Error('Invalid automatic window name setting')
      let leaves: string[] = []
      mapLayout(window.layout, node => {
        if (node.kind === 'pane') leaves.push(node.paneId)
        else if (node.kind !== 'split' || !['horizontal', 'vertical'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio < 0.1 || node.ratio > 0.9) throw new Error('Invalid split')
        return node
      })
      if (window.floating !== undefined && !Array.isArray(window.floating)) throw new Error('Invalid floating panes')
      if (window.lastFloating && (!['x', 'y', 'width', 'height', 'workspaceWidth', 'workspaceHeight'].every(key => Number.isFinite(window.lastFloating![key as keyof typeof window.lastFloating])) || window.lastFloating.x < 0 || window.lastFloating.y < 0 || window.lastFloating.width <= 0 || window.lastFloating.height <= 0 || window.lastFloating.workspaceWidth <= 0 || window.lastFloating.workspaceHeight <= 0)) throw new Error('Invalid remembered floating geometry')
      for (let floating of window.floating ?? []) {
        if (!floating || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(floating[key as keyof typeof floating])) || floating.width <= 0 || floating.height <= 0 || floating.x < 0 || floating.y < 0) throw new Error('Invalid floating geometry')
        let dock = floating.dock
        if (dock && (!Array.isArray(dock.siblingIds) || !dock.siblingIds.every(id => typeof id === 'string') || !['horizontal', 'vertical'].includes(dock.axis) || typeof dock.before !== 'boolean' || !Number.isFinite(dock.ratio) || dock.ratio < .1 || dock.ratio > .9)) throw new Error('Invalid floating dock')
        leaves.push(floating.paneId)
      }
      if (leaves.length !== window.panes.length || new Set(leaves).size !== leaves.length) throw new Error('Invalid layout leaves')
      for (let pane of window.panes) {
        checkId(pane.id)
        if (!leaves.includes(pane.id) || !model.profiles.some(profile => profile.id === pane.profileId)) throw new Error('Invalid pane')
        if (typeof pane.url !== 'string' || typeof pane.title !== 'string' || !Number.isFinite(pane.zoom) || (pane.openerPaneId !== undefined && typeof pane.openerPaneId !== 'string') || (pane.keepAlive !== undefined && typeof pane.keepAlive !== 'boolean')) throw new Error('Invalid pane page')
      }
    }
  }
  if (model.closedSessionProfiles !== undefined && (typeof model.closedSessionProfiles !== 'object' || model.closedSessionProfiles === null || Array.isArray(model.closedSessionProfiles) || Object.entries(model.closedSessionProfiles).some(([name, profileId]) => !name || typeof profileId !== 'string' || !model.profiles.some(profile => profile.id === profileId)))) throw new Error('Invalid closed session profiles')
  return model
}

export let repairClientSelections = (model: Model) => {
  let existingSessions = new Set(model.sessions.map(session => session.id))
  let existingWindows = new Set(model.sessions.flatMap(session => session.windows.map(window => window.id)))
  for (let client of model.clients) {
    let session = model.sessions.find(session => session.id === client.sessionId) ?? model.sessions[0]
    if (!session) continue
    client.sessionId = session.id
    let sessionHistory = (client.sessionHistory ?? []).filter(id => existingSessions.has(id))
    client.sessionHistory = [session.id, ...sessionHistory.filter(id => id !== session.id)]
    let history = (client.windowHistory ?? []).filter(id => existingWindows.has(id))
    let previous = history.find(id => session.windows.some(window => window.id === id))
    let window = session.windows.find(window => window.id === client.windowId)
      ?? session.windows.find(window => window.id === previous) ?? session.windows[0]
    client.windowId = window.id
    client.windowHistory = [window.id, ...history.filter(id => id !== window.id)]
    if (!window.panes.some(pane => pane.id === client.paneId)) client.paneId = window.panes[0]?.id ?? null
    if (!window.panes.some(pane => pane.id === client.zoomedPaneId)) client.zoomedPaneId = null
  }
}

export let removeSession = (model: Model, session: WorkspaceSession) => {
  let index = model.sessions.indexOf(session)
  if (index < 0) throw new Error(`Session '${session.id}' not found`)
  if (!session.private) model.closedSessionProfiles = Object.fromEntries([...Object.entries(model.closedSessionProfiles ?? {}).filter(([name]) => name !== session.name), [session.name, session.defaultProfileId]].slice(-50))
  let next = model.sessions.length === 1 ? newSession('main', session.defaultProfileId) : model.sessions[(index + 1) % model.sessions.length]
  model.sessions = model.sessions.filter(item => item !== session)
  if (!model.sessions.length) model.sessions.push(next)
  for (let client of model.clients.filter(client => client.sessionId === session.id)) {
    client.sessionId = next.id
    client.windowId = next.windows[0].id
    client.paneId = next.windows[0].panes[0]?.id ?? null
    client.zoomedPaneId = null
  }
  repairClientSelections(model)
  return next
}
