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

export let parseCommandLine = (line: string, state: PublicState): Command => {
  let words = tokenize(line)
  let name = words.shift()
  if (!name) throw new Error('Enter a command')
  let client = state.model.clients.find(client => client.id === state.clientId)
  if (!client) throw new Error('Client is detached')
  let session = state.model.sessions.find(session => session.id === client.sessionId)!
  let window = session.windows.find(window => window.id === client.windowId)!
  let pane = window.panes.find(pane => pane.id === client.paneId)
  let positional: string[] = []
  let options: Record<string, unknown> = {}
  let aliases: Record<string, string> = { t: 'target', s: 'name', n: 'name', c: 'client' }
  while (words.length) {
    let word = words.shift()!
    if (word === '--') { positional.push(...words); break }
    if (word === '-h' || word === '-v') { options.axis = word === '-h' ? 'horizontal' : 'vertical'; continue }
    if (!word.startsWith('-')) { positional.push(word); continue }
    let [raw, ...rest] = word.replace(/^-+/, '').split('=')
    let key = aliases[raw] ?? raw
    let value = rest.length ? rest.join('=') : ['confirm', 'background'].includes(key) ? true : words.shift()
    if (value === undefined) throw new Error(`Missing value for ${word}`)
    options[key] = value
  }
  let target = options.target
  delete options.target
  let current = { client: client.id }
  let windowTarget = target !== undefined && /^\d+$/.test(String(target)) ? session.windows[Number(target)]?.id ?? target : target ?? client.windowId
  let tabTarget = target !== undefined && /^\d+$/.test(String(target)) ? pane?.tabs[Number(target)]?.id ?? target : target ?? pane?.activeTabId
  if (name === 'open' || name === 'navigate') return { method: 'navigate', args: { tab: tabTarget, url: positional.join(' ') } }
  if (/^(https?:\/\/|localhost[:/])/.test(name) || name.includes('.')) return { method: 'navigate', args: { tab: pane?.activeTabId, url: [name, ...positional].join(' ') } }
  if (name === 'session') name = 'switch-client'
  if (name === 'new-client') name = 'attach-session'
  if (name === 'detach') name = 'detach-client'
  if (name === 'split') name = 'split-window'
  if (name === 'new-session') return { method: name, args: { ...current, ...options, name: options.name ?? positional[0] } }
  if (name === 'switch-client' || name === 'attach-session') return { method: name, args: { ...current, ...options, session: target ?? positional[0] ?? client.sessionId } }
  if (name === 'new-window') return { method: name, args: { ...current, session: client.sessionId, ...options, ...(positional.length ? { name: positional[0] } : {}) } }
  if (['select-window', 'kill-window', 'rename-window', 'save-layout', 'restore-layout'].includes(name)) return { method: name, args: { ...current, ...options, window: windowTarget, name: options.name ?? positional[0] } }
  if (name === 'rename-session') return { method: name, args: { ...options, session: target ?? client.sessionId, name: options.name ?? positional[0] } }
  if (['split-window', 'select-pane', 'kill-pane', 'move-pane'].includes(name)) return { method: name, args: { ...current, pane: target ?? pane?.id, window: client.windowId, ...options } }
  if (name === 'next-window' || name === 'previous-window') return { method: 'cycle-window', args: { ...current, direction: name === 'next-window' ? 1 : -1 } }
  if (name === 'next-session' || name === 'previous-session') {
    let index = state.model.sessions.findIndex(item => item.id === session.id)
    let next = state.model.sessions[(index + (name === 'next-session' ? 1 : -1) + state.model.sessions.length) % state.model.sessions.length]
    return { method: 'switch-client', args: { ...current, session: next.id } }
  }
  if (name === 'next-pane') return { method: 'cycle-pane', args: current }
  if (name === 'toggle-pane-zoom') return { method: name, args: current }
  if (['pane-left', 'pane-right', 'pane-up', 'pane-down'].includes(name)) return { method: 'select-pane-direction', args: { ...current, direction: name.slice(5) } }
  if (name === 'next-tab' || name === 'previous-tab') {
    if (!pane) throw new Error('No selected pane')
    let index = pane.tabs.findIndex(tab => tab.id === pane.activeTabId)
    return { method: 'tab.select', args: { tab: pane.tabs[(index + (name === 'next-tab' ? 1 : -1) + pane.tabs.length) % pane.tabs.length].id } }
  }
  if (name === 'tab') {
    let action = positional.shift()
    if (action === 'new') return { method: 'tab.create', args: { ...current, pane: pane?.id, url: positional[0], ...options } }
    if (action === 'close' || action === 'select') return { method: `tab.${action}`, args: { tab: tabTarget } }
    throw new Error('Use tab new URL, tab close, or tab select -t INDEX')
  }
  if (name === 'profile') {
    let action = positional.shift()
    if (action === 'create') return { method: 'profile.create', args: { ...options, name: positional[0] } }
    if (action === 'rename') return { method: 'profile.rename', args: { profile: positional[0], name: positional[1] } }
    throw new Error('Use profile create NAME or profile rename OLD NEW')
  }
  if (['back', 'forward', 'reload', 'hard-reload', 'stop', 'devtools'].includes(name)) return { method: name, args: { tab: tabTarget } }
  if (name === 'zoom') return { method: 'zoom', args: { tab: tabTarget, factor: Number(positional[0]) / 100 } }
  if (name === 'reload-config') return { method: 'settings.reload' }
  if (name === 'edit-config') return { method: 'settings.open' }
  if (name === 'prefix') return { method: 'settings.prefix', args: { key: positional[0] } }
  if (['detach-client', 'import-brave', 'quit'].includes(name)) return { method: name, args: { ...current, ...options } }
  throw new Error(`Unknown command: ${name}. Use help for commands.`)
}
