import { normalizeKeyAction } from './keyboard'
import type { Command, PublicState } from './types'

export let tokenize = (line: string): string[] => {
  let words: string[] = [], word = '', quote = '', escaped = false, started = false
  for (let char of line.trim().replace(/^:/, '')) {
    if (escaped) { word += char; escaped = false; continue }
    if (char === '\\' && quote !== "'") { escaped = true; started = true; continue }
    if (quote) { if (char === quote) quote = ''; else word += char; continue }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (/\s/.test(char)) { if (started) words.push(word); word = ''; started = false; continue }
    word += char; started = true
  }
  if (quote || escaped) throw new Error('Unfinished quote or escape')
  if (started) words.push(word)
  return words
}

export let COMMAND_ALIASES: Record<string, string> = {
  attach: 'attach-session', breakp: 'break-pane', joinp: 'join-pane', killp: 'kill-pane', killw: 'kill-window', movep: 'move-pane', new: 'new-session', neww: 'new-window', next: 'next-window', prev: 'previous-window', rename: 'rename-session', renamew: 'rename-window', resizep: 'resize-pane', selectp: 'select-pane', selectw: 'select-window', splitw: 'split-window', swapw: 'swap-window',
}

let indexed = <T extends { id: string; name?: string }>(items: T[], value: string) => {
  let exact = items.find(item => item.id === value || item.name === value)
  return exact ?? (/^[1-9]\d*$/.test(value) ? items[Number(value) - 1] : undefined)
}

let moveDestination = (state: PublicState, currentSessionId: string, target: unknown, newWindowForSession = false) => {
  if (target === undefined) return {}
  let value = String(target), sessions = state.model.sessions
  let pane = sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === value)
  if (pane) return { destination: pane.id }
  let currentSession = sessions.find(session => session.id === currentSessionId)!
  if (value.startsWith(':')) {
    let selector = value.slice(1).replace(/^\{(.+)\}$/, '$1')
    let session = indexed(sessions, selector)
    if (session) return newWindowForSession ? { session: session.id } : { window: session.windows[0].id }
    let window = indexed(currentSession.windows, selector)
    if (window) return { window: window.id }
  }
  if (value.endsWith(':')) {
    let session = indexed(sessions, value.slice(0, -1))
    if (session) return newWindowForSession ? { session: session.id } : { window: session.windows[0].id }
  }
  if (value.includes(':')) {
    let [sessionSelector, windowSelector] = value.split(':', 2)
    let session = indexed(sessions, sessionSelector)
    let window = session && indexed(session.windows, windowSelector)
    if (window) return { window: window.id }
  }
  let window = indexed(currentSession.windows, value)
    ?? sessions.flatMap(session => session.windows).find(window => window.id === value)
  if (window) return { window: window.id }
  let session = indexed(sessions, value)
  return session ? newWindowForSession ? { session: session.id } : { window: session.windows[0].id } : { destination: value }
}

export let parseCommandLine = (line: string, state: PublicState): Command => {
  let words = tokenize(line)
  let name = words.shift()
  if (!name) throw new Error('Enter a command')
  name = normalizeKeyAction(name)
  let tmuxPaneMove = name === 'movep' || name === 'joinp'
  name = COMMAND_ALIASES[name] ?? name
  let client = state.model.clients.find(client => client.id === state.clientId)
  if (!client) throw new Error('Client is detached')
  let session = state.model.sessions.find(session => session.id === client.sessionId)!
  let window = session.windows.find(window => window.id === client.windowId)!
  let pane = window.panes.find(pane => pane.id === client.paneId)
  let positional: string[] = []
  let options: Record<string, unknown> = {}
  let aliases: Record<string, string> = { t: 'target', s: tmuxPaneMove ? 'source' : 'name', n: 'name', c: 'client', W: 'floating' }
  while (words.length) {
    let word = words.shift()!
    if (word === '--') { positional.push(...words); break }
    if (word === '-h' || word === '-v') { options.axis = word === '-h' ? 'horizontal' : 'vertical'; continue }
    if (!word.startsWith('-')) { positional.push(word); continue }
    let [raw, ...rest] = word.replace(/^-+/, '').split('=')
    let key = aliases[raw] ?? raw
    let value = rest.length ? rest.join('=') : ['confirm', 'background', 'floating', 'private'].includes(key) ? true : words.shift()
    if (value === undefined) throw new Error(`Missing value for ${word}`)
    options[key] = value
  }
  let target = options.target
  delete options.target
  let current = { client: client.id }
  let windowTarget = target !== undefined && /^[1-9]\d*$/.test(String(target)) ? session.windows[Number(target) - 1]?.id ?? target : target ?? client.windowId
  let tabTarget = target !== undefined && /^\d+$/.test(String(target)) ? pane?.tabs[Number(target)]?.id ?? target : target ?? pane?.activeTabId
  if (name === 'dark' || name === 'adblock') {
    let value: unknown = positional[0] ?? 'toggle'
    if (name === 'adblock' && ['on', 'off'].includes(String(value))) value = value === 'on'
    if (name === 'dark' && value === 'on') value = 'dark'
    return { method: 'browser.set', args: { tab: tabTarget, setting: name === 'dark' ? 'darkMode' : 'adblock', value, scope: options.scope ?? 'site' } }
  }
  if (name === 'update-filters') return { method: 'browser.update-filters' }
  if (name === 'reload-scripts') return { method: 'browser.reload-scripts' }
  if (name === 'extension') {
    let action = positional.shift()
    if (['list', 'load', 'remove', 'open', 'install-bitwarden'].includes(action ?? '')) return { method: `extension.${action}`, args: { tab: tabTarget, profile: options.profile, ...(action === 'load' ? { path: positional[0] } : { id: positional[0] }) } }
    throw new Error('Use extension install-bitwarden, list, load /absolute/path, open ID, or remove ID')
  }
  if (name === 'fill' || name === 'save-fill') return { method: 'plugin.run', args: { action: `bmux.forms/${name === 'fill' ? 'fill' : 'save'}`, tab: tabTarget } }
  if (name === 'open' || name === 'navigate') return { method: 'navigate', args: { tab: tabTarget, url: positional.join(' ') } }
  if (name === 'plugin') {
    let action = positional.shift()
    if (action === 'run') return { method: 'plugin.run', args: { action: positional[0], tab: tabTarget } }
    if (action === 'cancel') return { method: 'plugin.cancel', args: { id: positional[0] } }
    if (['list', 'runs', 'reload'].includes(action ?? '')) return { method: `plugin.${action}` }
    throw new Error('Use plugin list, run ID/ACTION, runs, cancel ID, or reload')
  }
  if (/^(https?:\/\/|localhost[:/])/.test(name) || name.includes('.')) return { method: 'navigate', args: { tab: pane?.activeTabId, url: [name, ...positional].join(' ') } }
  if (name === 'session') name = 'switch-client'
  if (name === 'new-client') name = 'attach-session'
  if (name === 'detach') name = 'detach-client'
  if (name === 'close-system-window') name = 'detach-client'
  if (name === 'split') name = 'split-window'
  if (name === 'new-session') return { method: name, args: { ...current, ...options, name: options.name ?? positional[0] } }
  if (name === 'switch-client' || name === 'attach-session') return { method: name, args: { ...current, ...options, session: target ?? positional[0] ?? client.sessionId } }
  if (name === 'new-window') return { method: name, args: { ...current, session: client.sessionId, ...options, ...(positional.length ? { name: positional[0] } : {}) } }
  if (name === 'reopen-closed-tab') return { method: name, args: current }
  if (name === 'move-window-left' || name === 'move-window-right') return { method: 'swap-window', args: { ...current, direction: name === 'move-window-left' ? -1 : 1 } }
  if (name === 'move-window-first' || name === 'move-window-last') return { method: 'move-window', args: { ...current, position: name === 'move-window-first' ? 'first' : 'last' } }
  if (name === 'move-window') return { method: name, args: { ...current, position: target ?? positional[0] } }
  if (name === 'swap-window') {
    let destination = String(target ?? positional[0] ?? '')
    if (!['-1', '+1'].includes(destination)) throw new Error('Use swap-window -t -1 or swap-window -t +1')
    return { method: name, args: { ...current, direction: destination === '-1' ? -1 : 1 } }
  }
  if (['select-window', 'kill-window', 'rename-window', 'save-layout', 'restore-layout'].includes(name)) return { method: name, args: { ...current, ...options, window: windowTarget, name: options.name ?? positional[0] } }
  if (name === 'rename-session') return { method: name, args: { ...options, session: target ?? client.sessionId, name: options.name ?? positional[0] } }
  if (tmuxPaneMove) {
    let source = options.source ?? pane?.id
    delete options.source
    return { method: name, args: { ...current, pane: source, ...moveDestination(state, client.sessionId, target, name === 'move-pane'), ...options } }
  }
  if (['split-window', 'select-pane', 'kill-pane', 'move-pane', 'join-pane', 'new-pane', 'break-pane'].includes(name)) return { method: name, args: { ...current, pane: target ?? pane?.id, window: client.windowId, ...options } }
  if (name === 'resize-pane') return { method: name, args: { ...current, ...(options.split ? { window: target ?? client.windowId } : { pane: target ?? pane?.id }), ...options } }
  if (name === 'next-window' || name === 'previous-window') return { method: 'cycle-window', args: { ...current, direction: name === 'next-window' ? 1 : -1 } }
  if (name === 'next-session' || name === 'previous-session') {
    let index = state.model.sessions.findIndex(item => item.id === session.id)
    let next = state.model.sessions[(index + (name === 'next-session' ? 1 : -1) + state.model.sessions.length) % state.model.sessions.length]
    return { method: 'switch-client', args: { ...current, session: next.id } }
  }
  if (name === 'next-pane') return { method: 'cycle-pane', args: current }
  if (name === 'toggle-pane-zoom') return { method: name, args: current }
  if (name === 'click-mode') return { method: name, args: current }
  if (['pane-left', 'pane-right', 'pane-up', 'pane-down'].includes(name)) return { method: 'select-pane-direction', args: { ...current, direction: name.slice(5) } }
  if (name === 'profile') {
    let action = positional.shift()
    if (action === 'create') return { method: 'profile.create', args: { ...options, name: positional[0] } }
    if (action === 'rename') return { method: 'profile.rename', args: { profile: positional[0], name: positional[1] } }
    throw new Error('Use profile create NAME or profile rename OLD NEW')
  }
  if (['back', 'forward', 'reload', 'hard-reload', 'stop', 'devtools'].includes(name)) return { method: name, args: { tab: tabTarget } }
  if (['scroll-up', 'scroll-down', 'scroll-half-up', 'scroll-half-down', 'scroll-top', 'scroll-bottom'].includes(name)) return { method: 'scroll', args: { tab: tabTarget, action: name } }
  if (name === 'zoom') return { method: 'zoom', args: { tab: tabTarget, factor: Number(positional[0]) / 100 } }
  if (name === 'reload-config') return { method: 'settings.reload' }
  if (name === 'edit-config') return { method: 'settings.open' }
  if (name === 'prefix') return { method: 'settings.prefix', args: { key: positional[0] } }
  if (['detach-client', 'import-brave', 'quit'].includes(name)) return { method: name, args: { ...current, ...options } }
  throw new Error(`Unknown command: ${name}. Use help for commands.`)
}
