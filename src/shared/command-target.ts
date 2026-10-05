import type { InternalWindow, Layout, PublicState, WorkspaceSession } from './types'

export let paneOrder = (window: InternalWindow): string[] => {
  let visit = (layout: Layout | null): string[] => !layout ? [] : layout.kind === 'pane' ? [layout.paneId] : [...visit(layout.first), ...visit(layout.second)]
  return [...new Set([...visit(window.layout), ...window.floating?.map(item => item.paneId) ?? [], ...window.panes.map(pane => pane.id)])]
}

export let indexedTarget = <T extends { id: string; name?: string }>(items: T[], value: string, kind: string): T | undefined => {
  let id = items.find(item => item.id === value)
  if (id) return id
  if (/^[1-9]\d*$/.test(value)) return items[Number(value) - 1]
  let exactOnly = value.startsWith('=')
  if (exactOnly) value = value.slice(1)
  let exact = items.filter(item => item.name === value)
  if (exact.length > 1) throw new Error(`${kind} '${value}' is ambiguous; use an ID or index`)
  if (exact.length) return exact[0]
  let matches = !exactOnly && value ? items.filter(item => item.name?.startsWith(value)) : []
  if (matches.length > 1) throw new Error(`${kind} '${value}' is ambiguous; use its full name or ID`)
  return matches[0]
}

export let selectedWindow = (state: PublicState, session: WorkspaceSession) => {
  let client = state.model.clients.find(client => client.id === state.clientId && client.sessionId === session.id)
    ?? state.model.clients.find(client => client.sessionId === session.id)
  return session.windows.find(window => window.id === client?.windowId) ?? session.windows[0]
}

export let selectedPane = (state: PublicState, window: InternalWindow) => {
  let client = state.model.clients.find(client => client.id === state.clientId && client.windowId === window.id)
    ?? state.model.clients.find(client => client.windowId === window.id)
  return window.panes.find(pane => pane.id === client?.paneId) ?? window.panes.find(pane => pane.id === paneOrder(window)[0])!
}

export let windowInSession = (state: PublicState, session: WorkspaceSession, selector: string) => {
  let current = selectedWindow(state, session), index = session.windows.indexOf(current)
  let token = selector.replace(/^\{(.+)\}$/, '$1')
  if (!token || ['current', '@'].includes(token)) return current
  if (['start', '^'].includes(token)) return session.windows[0]
  if (['end', '$'].includes(token)) return session.windows.at(-1)
  if (['last', '!'].includes(token)) {
    let client = state.model.clients.find(client => client.id === state.clientId)
    return client?.windowHistory?.map(id => session.windows.find(window => window.id === id)).find(window => window && window !== current)
  }
  if (token === 'next') token = '+'
  if (token === 'previous') token = '-'
  if (/^[+-]\d*$/.test(token)) {
    let offset = Number(token.slice(1) || 1) * (token[0] === '-' ? -1 : 1)
    return session.windows[((index + offset) % session.windows.length + session.windows.length) % session.windows.length]
  }
  return indexedTarget(session.windows, selector.replace(/^\{(.+)\}$/, '$1'), 'Window')
}

export let resolveWindowTarget = (state: PublicState, target?: unknown) => {
  let sessions = state.model.sessions, client = state.model.clients.find(client => client.id === state.clientId)!
  let session = sessions.find(session => session.id === client.sessionId)!
  let value = target === undefined ? '' : String(target)
  let global = sessions.flatMap(session => session.windows.map(window => ({ session, window }))).find(item => item.window.id === value || item.window.panes.some(pane => pane.id === value))
  if (global) return global
  let separator = value.indexOf(':')
  if (separator >= 0) {
    let selector = value.slice(0, separator)
    if (selector) {
      session = indexedTarget(sessions, selector, 'Session')!
      if (!session) throw new Error(`Session '${selector}' not found`)
    }
    value = value.slice(separator + 1)
  }
  let window = windowInSession(state, session, value)
  if (!window && separator < 0) {
    let targetSession = indexedTarget(sessions, value, 'Session')
    if (targetSession) return { session: targetSession, window: selectedWindow(state, targetSession) }
  }
  if (!window) throw new Error(`Window '${value}' not found`)
  return { session, window }
}

export let resolvePaneTarget = (state: PublicState, target?: unknown) => {
  let value = target === undefined ? '' : String(target)
  let global = state.model.sessions.flatMap(session => session.windows.flatMap(window => window.panes.map(pane => ({ session, window, pane })))).find(item => item.pane.id === value)
  if (global) return global
  let dot = value.lastIndexOf('.')
  if (dot >= 0 && !/^(?:\d+|%\d+|pane_.+|\{[^}]+\}|[+-]\d*|@)$/.test(value.slice(dot + 1))) dot = -1
  let selector = dot >= 0 ? value.slice(dot + 1) : ''
  let { session, window } = resolveWindowTarget(state, dot >= 0 ? value.slice(0, dot) : value)
  let pane = selectedPane(state, window)
  let order = paneOrder(window), token = selector.replace(/^\{(.+)\}$/, '$1')
  if (token && !['active', '@'].includes(token)) {
    let id = /^\d+$/.test(token) ? order[Number(token)] : token
    if (['next', 'previous', '+', '-'].includes(token) || /^[+-]\d+$/.test(token)) {
      let offset = ['previous', '-'].includes(token) ? -1 : ['next', '+'].includes(token) ? 1 : Number(token)
      id = order[((order.indexOf(pane.id) + offset) % order.length + order.length) % order.length]
    }
    pane = window.panes.find(pane => pane.id === id)!
    if (!pane) throw new Error(`Pane '${selector}' not found`)
  }
  return { session, window, pane }
}

export let windowPositionTarget = (state: PublicState, target: unknown, sourceSessionId?: string) => {
  let client = state.model.clients.find(client => client.id === state.clientId)!
  let session = state.model.sessions.find(session => session.id === (target === undefined ? sourceSessionId ?? client.sessionId : client.sessionId))!
  let value = target === undefined ? '' : String(target), separator = value.indexOf(':')
  if (separator >= 0) {
    let selector = value.slice(0, separator)
    if (selector) {
      session = indexedTarget(state.model.sessions, selector, 'Session')!
      if (!session) throw new Error(`Session '${selector}' not found`)
    }
    value = value.slice(separator + 1)
  } else if (value && !windowInSession(state, session, value)) {
    let targetSession = indexedTarget(state.model.sessions, value, 'Session')
    if (targetSession) { session = targetSession; value = '' }
  }
  if (!value) return { session: session.id, position: 'last' }
  if (['first', 'last'].includes(value) || /^[1-9]\d*$/.test(value)) return { session: session.id, position: value }
  let resolved = resolveWindowTarget(state, separator >= 0 ? `${session.id}:${value}` : value)
  return { session: resolved.session.id, position: String(resolved.session.windows.indexOf(resolved.window) + 1) }
}
