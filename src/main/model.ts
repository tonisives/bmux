import { randomUUID } from 'node:crypto'
import type { Layout, Model, Pane, Profile, Tab, WorkspaceSession, InternalWindow } from '../shared/types'

export let id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`
export let newTab = (url = 'about:blank'): Tab => ({ id: id('tab'), url, title: url === 'about:blank' ? 'New tab' : url, zoom: 1 })
export let newPane = (profileId: string, url?: string): Pane => {
  let tab = newTab(url)
  return { id: id('pane'), profileId, tabs: [tab], activeTabId: tab.id }
}
export let newWindow = (name: string, profileId: string): InternalWindow => {
  let pane = newPane(profileId)
  return { id: id('win'), name, panes: [pane], layout: { kind: 'pane', paneId: pane.id } }
}
export let newSession = (name: string, profileId: string): WorkspaceSession => ({ id: id('session'), name, defaultProfileId: profileId, windows: [newWindow('main', profileId)] })
export let initialModel = (): Model => {
  let profiles: Profile[] = [{ id: 'profile_default', name: 'default', background: false }, { id: 'profile_bot', name: 'bot', background: true }]
  return { version: 1, profiles, sessions: [newSession('main', profiles[0].id)], clients: [], layouts: [] }
}
export let walkPanes = (model: Model) => model.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => ({ session, window, pane }))))
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
export let splitLayout = (layout: Layout | null, paneId: string, addedId: string, axis: 'horizontal' | 'vertical'): Layout => {
  if (!layout) return { kind: 'pane', paneId: addedId }
  return mapLayout(layout, node => node.kind === 'pane' && node.paneId === paneId
    ? { kind: 'split', id: id('split'), axis, ratio: 0.5, first: node, second: { kind: 'pane', paneId: addedId } }
    : node)!
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
    for (let tab of pane.tabs) {
      let tabId = id('tab')
      if (pane.activeTabId === tab.id) pane.activeTabId = tabId
      tab.id = tabId
    }
  }
  copy.layout = mapLayout(copy.layout, node => node.kind === 'pane' ? { ...node, paneId: paneIds.get(node.paneId)! } : { ...node, id: id('split') })
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
      let leaves: string[] = []
      mapLayout(window.layout, node => {
        if (node.kind === 'pane') leaves.push(node.paneId)
        else if (node.kind !== 'split' || !['horizontal', 'vertical'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio < 0.1 || node.ratio > 0.9) throw new Error('Invalid split')
        return node
      })
      if (leaves.length !== window.panes.length || new Set(leaves).size !== leaves.length) throw new Error('Invalid layout leaves')
      for (let pane of window.panes) {
        checkId(pane.id)
        if (!leaves.includes(pane.id) || !model.profiles.some(profile => profile.id === pane.profileId)) throw new Error('Invalid pane')
        if (!pane.tabs.some(tab => tab.id === pane.activeTabId)) throw new Error('Missing active tab')
        for (let tab of pane.tabs) {
          checkId(tab.id)
          if (typeof tab.url !== 'string') throw new Error('Invalid tab URL')
        }
      }
    }
  }
  return model
}
