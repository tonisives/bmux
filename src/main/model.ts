import { randomUUID } from 'node:crypto'
import type { Layout, Model, Pane, Profile, Tab, WorkspaceSession, InternalWindow } from '../shared/types'

export let id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`
export let newTab = (url = 'about:blank'): Tab => ({ id: id('tab'), url, title: url === 'about:blank' ? 'New tab' : url, zoom: 1 })
export let newPane = (profileId: string, url?: string): Pane => {
  let tab = newTab(url)
  return { id: id('pane'), profileId, tabs: [tab], activeTabId: tab.id }
}
export let newWindow = (name: string, profileId: string, automaticName = false): InternalWindow => {
  let pane = newPane(profileId)
  return { id: id('win'), name, automaticName, panes: [pane], layout: { kind: 'pane', paneId: pane.id } }
}
export let newSession = (name: string, profileId: string): WorkspaceSession => ({ id: id('session'), name, defaultProfileId: profileId, windows: [newWindow('main', profileId, true)] })
export let initialModel = (): Model => {
  let profiles: Profile[] = [{ id: 'profile_default', name: 'default', background: false }, { id: 'profile_bot', name: 'bot', background: true }]
  return { version: 1, profiles, sessions: [newSession('main', profiles[0].id)], clients: [], layouts: [] }
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
  let tab = pane?.tabs.find(tab => tab.id === pane.activeTabId)
  let name = tab ? domainName(tab.url) : 'empty'
  if (!name) name = /^(main|window-\d+)$/.test(window.name) ? window.name : tab?.url.startsWith('file:') ? 'file' : 'new-tab'
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
export let tabById = (model: Model, tabId: unknown) => {
  for (let item of walkPanes(model)) {
    let tab = item.pane.tabs.find(candidate => candidate.id === tabId)
    if (tab) return { ...item, tab }
  }
  throw new Error(`Tab '${String(tabId)}' not found`)
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
    let tabIds = new Map(pane.tabs.map(tab => [tab.id, id('tab')]))
    for (let tab of pane.tabs) {
      let tabId = tabIds.get(tab.id)!
      if (pane.activeTabId === tab.id) pane.activeTabId = tabId
      if (tab.openerTabId) tab.openerTabId = tabIds.get(tab.openerTabId)
      tab.id = tabId
    }
  }
  copy.layout = mapLayout(copy.layout, node => node.kind === 'pane' ? { ...node, paneId: paneIds.get(node.paneId)! } : { ...node, id: id('split') })
  copy.floating = copy.floating?.map(item => ({ ...item, paneId: paneIds.get(item.paneId)!, dock: item.dock ? { ...item.dock, siblingIds: item.dock.siblingIds.flatMap(id => paneIds.has(id) ? [paneIds.get(id)!] : []) } : undefined }))
  return copy
}
export let validateModel = (value: unknown): Model => {
  let model = value as Model
  if (!model || model.version !== 1 || !Array.isArray(model.profiles) || !Array.isArray(model.sessions) || !Array.isArray(model.clients) || !Array.isArray(model.layouts)) throw new Error('Invalid or unsupported state file')
  let ids = new Set<string>()
  let checkId = (value: string) => {
    if (typeof value !== 'string' || !value || ids.has(value)) throw new Error('Invalid or duplicate ID in state file')
    ids.add(value)
  }
  for (let profile of model.profiles) {
    checkId(profile.id)
    if (typeof profile.name !== 'string' || typeof profile.background !== 'boolean') throw new Error('Invalid profile')
  }
  for (let session of model.sessions) {
    checkId(session.id)
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
        if (!pane.tabs.some(tab => tab.id === pane.activeTabId)) throw new Error('Missing active tab')
        for (let tab of pane.tabs) {
          checkId(tab.id)
          if (typeof tab.url !== 'string' || (tab.openerTabId !== undefined && typeof tab.openerTabId !== 'string')) throw new Error('Invalid tab')
        }
      }
    }
  }
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
