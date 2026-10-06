import { normalizeKeyAction } from './keyboard'
import { indexedTarget, paneOrder, resolvePaneTarget, resolveWindowTarget, selectedWindow, windowInSession, windowPositionTarget } from './command-target'
import type { Command, PublicState } from './types'

export let commandTokens = (line: string, partial = false): { value: string; start: number; end: number }[] => {
  let words: { value: string; start: number; end: number }[] = [], word = '', quote = '', escaped = false, start = -1
  let offset = line.search(/\S/)
  if (offset < 0) return words
  if (line[offset] === ':') offset++
  for (let index = offset; index < line.length; index++) {
    let char = line[index]
    if (escaped) { word += char; escaped = false; continue }
    if (/\s/.test(char) && !quote) { if (start >= 0) words.push({ value: word, start, end: index }); word = ''; start = -1; continue }
    if (start < 0) start = index
    if (char === '\\' && quote !== "'") { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; else word += char; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    word += char
  }
  if (!partial && (quote || escaped)) throw new Error('Unfinished quote or escape')
  if (start >= 0) words.push({ value: word, start, end: line.length })
  return words
}

export let tokenize = (line: string): string[] => commandTokens(line).map(word => word.value)

export let COMMAND_ALIASES: Record<string, string> = {
  attach: 'attach-session', breakp: 'break-pane', joinp: 'join-pane', killp: 'kill-pane', killw: 'kill-window', movep: 'move-pane', movew: 'move-window', new: 'new-session', neww: 'new-window', next: 'next-window', prev: 'previous-window', rename: 'rename-session', renamew: 'rename-window', resizep: 'resize-pane', rotatew: 'rotate-window', selectp: 'select-pane', selectw: 'select-window', splitw: 'split-window', swapp: 'swap-pane', swapw: 'swap-window',
}

let moveDestination = (state: PublicState, currentSessionId: string, target: unknown) => {
  if (target === undefined) return {}
  let value = String(target), sessions = state.model.sessions
  let pane = sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === value)
  if (pane) return { destination: pane.id }
  let currentSession = sessions.find(session => session.id === currentSessionId)!
  if (value.startsWith(':')) {
    let selector = value.slice(1).replace(/^\{(.+)\}$/, '$1')
    if (selector.includes('.')) return { destination: resolvePaneTarget(state, value).pane.id }
    let window = windowInSession(state, currentSession, selector)
    if (window) return { window: window.id }
    throw new Error(`Window '${selector}' not found`)
  }
  if (value.endsWith(':')) {
    let session = indexedTarget(sessions, value.slice(0, -1), 'Session')
    if (session) return { window: selectedWindow(state, session).id }
    throw new Error(`Session '${value.slice(0, -1)}' not found`)
  }
  if (value.includes(':')) {
    let [sessionSelector, windowSelector] = value.split(':', 2)
    let session = indexedTarget(sessions, sessionSelector, 'Session')
    if (!session) throw new Error(`Session '${sessionSelector}' not found`)
    if (windowSelector.includes('.')) return { destination: resolvePaneTarget(state, value).pane.id }
    let window = windowInSession(state, session, windowSelector)
    if (window) return { window: window.id }
    throw new Error(`Window '${value}' not found`)
  }
  if (value.startsWith('.') || value.includes('.')) return { destination: resolvePaneTarget(state, value).pane.id }
  let window = windowInSession(state, currentSession, value)
    ?? sessions.flatMap(session => session.windows).find(window => window.id === value)
  if (window) return { window: window.id }
  let session = indexedTarget(sessions, value, 'Session')
  if (session) return { window: selectedWindow(state, session).id }
  throw new Error(`Pane, window, or session '${value}' not found`)
}

export let parseCommandLine = (line: string, state: PublicState): Command => {
  let words = tokenize(line)
  let name = words.shift()
  if (!name) throw new Error('Enter a command')
  name = normalizeKeyAction(name)
  let tmuxPaneMove = name === 'movep' || name === 'joinp' || (['move-pane', 'join-pane'].includes(name) && !words.some(word => /^--(pane|window|destination|x|y)(=|$)/.test(word)))
  let shortBreak = name === 'breakp'
  name = COMMAND_ALIASES[name] ?? name
  let client = state.model.clients.find(client => client.id === state.clientId)
  if (!client) throw new Error('Client is detached')
  let session = state.model.sessions.find(session => session.id === client.sessionId)!
  let window = session.windows.find(window => window.id === client.windowId)!
  let pane = window.panes.find(pane => pane.id === client.paneId)
  let positional: string[] = []
  let options: Record<string, unknown> = {}
  let movement = ['move-pane', 'join-pane', 'break-pane', 'swap-pane', 'rotate-window', 'move-window', 'swap-window'].includes(name)
  let aliases: Record<string, string> = { t: 'target', s: movement ? 'source' : 'name', n: 'name', c: 'client', W: 'floating', ...(movement ? { d: 'background', b: 'before', a: 'after', U: 'up', D: 'down', Z: 'keepZoom', r: 'renumber' } : {}) }
  while (words.length) {
    let word = words.shift()!
    if (word === '--') { positional.push(...words); break }
    if (word === '-h' || word === '-v') { options.axis = word === '-h' ? 'horizontal' : 'vertical'; continue }
    if (!word.startsWith('-')) { positional.push(word); continue }
    if (movement && /^-[bdhvWUDZar]{2,}$/.test(word)) { words.unshift(...word.slice(1).split('').map(flag => `-${flag}`)); continue }
    if (movement && /^-[tsnc].+/.test(word) && !word.includes('=')) { words.unshift(word.slice(2)); word = word.slice(0, 2) }
    let [raw, ...rest] = word.replace(/^-+/, '').split('=')
    let key = aliases[raw] ?? raw
    let boolean = ['confirm', 'background', 'floating', 'private', ...(movement ? ['before', 'after', 'up', 'down', 'keepZoom', 'renumber'] : [])].includes(key)
    let value: unknown = rest.length ? rest.join('=') : boolean ? true : words.shift()
    if (value === undefined) throw new Error(`Missing value for ${word}`)
    if (boolean && typeof value === 'string' && ['true', 'false'].includes(value)) value = value === 'true'
    options[key] = value
  }
  if (movement) {
    let supported: Record<string, string[]> = {
      'move-pane': ['target', 'source', 'pane', 'window', 'destination', 'session', 'x', 'y', 'axis', 'before', 'background', 'client'],
      'join-pane': ['target', 'source', 'pane', 'window', 'destination', 'axis', 'before', 'background', 'client'],
      'break-pane': ['target', 'source', 'pane', 'window', 'session', 'floating', 'name', 'before', 'after', 'background', 'client'],
      'swap-pane': ['target', 'source', 'background', 'up', 'down', 'keepZoom', 'client'],
      'rotate-window': ['target', 'up', 'down', 'keepZoom', 'client'],
      'move-window': ['target', 'source', 'position', 'session', 'before', 'after', 'background', 'renumber', 'client'],
      'swap-window': ['target', 'source', 'background', 'client'],
    }
    for (let key of Object.keys(options)) if (!supported[name].includes(key)) throw new Error(`Unsupported option for ${name}: --${key}`)
    if (positional.length && name !== 'move-window' && name !== 'swap-window') throw new Error(`${name} does not accept positional targets; use -s and -t`)
    if (options.before && options.after) throw new Error('Use either -b or -a')
    if (options.up && options.down) throw new Error('Use either -U or -D')
  }
  let target = options.target
  delete options.target
  if (movement && options.client !== undefined && options.client !== client.id) return parseCommandLine(line, { ...state, clientId: String(options.client) })
  let current = { client: client.id }
  let windowTarget = () => resolveWindowTarget(state, target).window.id
  let paneTarget = target ?? pane?.id
  if (name === 'dark' || name === 'adblock') {
    let value: unknown = positional[0] ?? 'toggle'
    if (name === 'adblock' && ['on', 'off'].includes(String(value))) value = value === 'on'
    if (name === 'dark' && value === 'on') value = 'dark'
    return { method: 'browser.set', args: { pane: paneTarget, setting: name === 'dark' ? 'darkMode' : 'adblock', value, scope: options.scope ?? 'site' } }
  }
  if (name === 'update-filters') return { method: 'browser.update-filters' }
  if (name === 'reload-scripts') return { method: 'browser.reload-scripts' }
  if (name === 'extension') {
    let action = positional.shift()
    if (['list', 'load', 'enable', 'disable', 'remove', 'open', 'options', 'install-bitwarden'].includes(action ?? '')) return { method: `extension.${action}`, args: { pane: paneTarget, profile: options.profile, ...(action === 'load' ? { path: positional[0] } : { id: positional[0] }) } }
    throw new Error('Use extension install-bitwarden, list, load /absolute/path, enable ID, disable ID, open ID, options ID, or remove ID')
  }
  if (name === 'fill' || name === 'save-fill') return { method: 'plugin.run', args: { action: `bmux.forms/${name === 'fill' ? 'fill' : 'save'}`, pane: paneTarget } }
  if (name === 'open' || name === 'navigate') return { method: 'navigate', args: { pane: paneTarget, url: positional.join(' ') } }
  if (name === 'plugin') {
    let action = positional.shift()
    if (action === 'run') return { method: 'plugin.run', args: { action: positional[0], pane: paneTarget } }
    if (action === 'cancel') return { method: 'plugin.cancel', args: { id: positional[0] } }
    if (['list', 'runs', 'reload'].includes(action ?? '')) return { method: `plugin.${action}` }
    throw new Error('Use plugin list, run ID/ACTION, runs, cancel ID, or reload')
  }
  if (name === 'automation') {
    let action = positional[0]
    if (action === 'resume') return { method: 'automation.resume', args: { pane: paneTarget } }
    if (['status', 'safety'].includes(action ?? '')) return { method: `automation.${action}` }
    throw new Error('Use automation status, safety, or resume')
  }
  if (/^(https?:\/\/|localhost[:/])/.test(name) || name.includes('.')) return { method: 'navigate', args: { pane: pane?.id, url: [name, ...positional].join(' ') } }
  if (name === 'session') name = 'switch-client'
  if (name === 'new-client') name = 'attach-session'
  if (name === 'detach') name = 'detach-client'
  if (name === 'close-system-window') name = 'detach-client'
  if (name === 'split') name = 'split-window'
  if (name === 'new-session') return { method: name, args: { ...current, ...options, name: options.name ?? positional[0] } }
  if (name === 'switch-client' || name === 'attach-session') return { method: name, args: { ...current, ...options, session: target ?? positional[0] ?? client.sessionId } }
  if (name === 'new-window') return { method: name, args: { ...current, session: client.sessionId, ...options, ...(positional.length ? { name: positional[0] } : {}) } }
  if (name === 'reopen-closed' || name === 'reopen-closed-tab') return { method: 'reopen-closed', args: current }
  if (name === 'move-window-left' || name === 'move-window-right') return { method: 'swap-window', args: { ...current, direction: name === 'move-window-left' ? -1 : 1 } }
  if (name === 'move-window-first' || name === 'move-window-last') return { method: 'move-window', args: { ...current, position: name === 'move-window-first' ? 'first' : 'last' } }
  if (name === 'move-window') {
    let source = resolveWindowTarget(state, options.source)
    if (options.renumber) {
      let selector = target === undefined ? session.id : String(target).replace(/:$/, '')
      let selected = indexedTarget(state.model.sessions, selector, 'Session')
      if (!selected) throw new Error(`Session '${selector}' not found`)
      return { method: 'renumber-windows', args: { session: selected.id } }
    }
    delete options.source
    let destination = windowPositionTarget(state, target ?? positional[0] ?? options.position ?? (options.before || options.after ? ':' : undefined))
    return { method: name, args: { ...current, window: source.window.id, ...destination, ...options } }
  }
  if (name === 'swap-window') {
    let source = resolveWindowTarget(state, options.source).window.id
    delete options.source
    return { method: name, args: { ...current, window: source, destination: resolveWindowTarget(state, target ?? positional[0]).window.id, ...options } }
  }
  if (['select-window', 'kill-window', 'rename-window', 'toggle-window-pin', 'save-layout', 'restore-layout'].includes(name)) return { method: name, args: { ...current, ...options, window: windowTarget(), name: options.name ?? positional[0] } }
  if (name === 'rename-session') return { method: name, args: { ...options, session: target ?? client.sessionId, name: options.name ?? positional[0] } }
  if (tmuxPaneMove) {
    let source = resolvePaneTarget(state, options.source).pane.id
    let destination = target === undefined && options.source !== undefined ? { destination: pane?.id } : moveDestination(state, client.sessionId, target)
    delete options.source
    return { method: name, args: { ...current, pane: source, ...destination, ...options } }
  }
  if (name === 'break-pane') {
    let legacySource = !shortBreak && options.source === undefined && state.model.sessions.some(session => session.windows.some(window => window.panes.some(pane => pane.id === target)))
    let source = resolvePaneTarget(state, options.source ?? options.pane ?? (legacySource ? target : undefined))
    if (!options.floating && target === undefined && source.window.panes.length === 1) throw new Error('Pane is already the only pane in its window')
    delete options.source
    let destination = options.floating || legacySource ? {} : windowPositionTarget(state, target ?? (options.before || options.after ? source.window.id : undefined), source.session.id)
    return { method: name, args: { ...current, pane: source.pane.id, ...destination, ...options } }
  }
  if (name === 'swap-pane') {
    let destination = resolvePaneTarget(state, target)
    let neighbor: string | undefined
    if (options.up || options.down) {
      let order = paneOrder(destination.window).filter(id => !destination.window.floating?.some(item => item.paneId === id))
      if (!order.includes(destination.pane.id)) throw new Error('Cannot swap up or down on a floating pane')
      neighbor = order[(order.indexOf(destination.pane.id) + (options.up ? -1 : 1) + order.length) % order.length]
    }
    let source = resolvePaneTarget(state, neighbor ?? options.source)
    delete options.source; delete options.up; delete options.down
    return { method: name, args: { ...current, pane: source.pane.id, destination: destination.pane.id, ...options } }
  }
  if (name === 'rotate-window') return { method: name, args: { ...current, window: windowTarget(), direction: options.up ? -1 : 1, keepZoom: options.keepZoom } }
  if (['split-window', 'select-pane', 'kill-pane', 'new-pane'].includes(name)) return { method: name, args: { ...current, pane: resolvePaneTarget(state, target).pane.id, ...options } }
  if (['move-pane', 'join-pane'].includes(name)) return { method: name, args: { ...current, pane: target ?? pane?.id, window: client.windowId, ...options } }
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
  if (['back', 'forward', 'reload', 'hard-reload', 'stop', 'devtools'].includes(name)) return { method: name, args: { pane: paneTarget } }
  if (['scroll-up', 'scroll-down', 'scroll-half-up', 'scroll-half-down', 'scroll-top', 'scroll-bottom'].includes(name)) return { method: 'scroll', args: { pane: paneTarget, action: name } }
  if (name === 'zoom') return { method: 'zoom', args: { pane: paneTarget, factor: Number(positional[0]) / 100 } }
  if (name === 'reload-config') return { method: 'settings.reload' }
  if (name === 'edit-config') return { method: 'settings.open' }
  if (name === 'prefix') return { method: 'settings.prefix', args: { key: positional[0] } }
  if (['detach-client', 'import-brave', 'quit'].includes(name)) return { method: name, args: { ...current, ...options } }
  throw new Error(`Unknown command: ${name}. Use help for commands.`)
}
