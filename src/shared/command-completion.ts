import { COMMAND_ALIASES, commandTokens } from './command-line'
import { paneOrder, resolvePaneTarget, resolveWindowTarget } from './command-target'
import { fuzzyMatch } from './command-search'
import type { CommandEntry } from './command-search'
import type { PublicState } from './types'

let quoteTarget = (value: string) => /[\s"'\\]/.test(value) ? `"${value.replace(/["\\]/g, '\\$&')}"` : value

export let commandTargetSuggestions = (line: string, state: PublicState): { query: string; entries: CommandEntry[] } | undefined => {
  let tokens = commandTokens(line, true), name = tokens[0]?.value
  name = COMMAND_ALIASES[name] ?? name
  if (!['move-pane', 'join-pane', 'break-pane', 'swap-pane', 'rotate-window', 'move-window', 'swap-window', 'select-pane', 'select-window'].includes(name)) return
  let last = tokens.at(-1)!, previous = tokens.at(-2)?.value
  let start = last.start, query = last.value, flag = previous, inline = ''
  if (last.end < line.length) {
    if (!['-t', '--target', '--window', '-s', '--source'].includes(last.value)) return
    start = line.length; query = ''; flag = last.value
  } else if (/^(?:-t|--target|--window|-s|--source)=/.test(last.value)) {
    inline = last.value.slice(0, last.value.indexOf('=') + 1)
    flag = inline.slice(0, -1); query = last.value.slice(inline.length)
  } else if (['-t', '--target', '--window', '-s', '--source'].includes(last.value)) {
    start = line.length; query = ''; flag = last.value; inline = ' '
  }
  if (!['-t', '--target', '--window', '-s', '--source'].includes(flag ?? '')) return
  let legacy = ['move-pane', 'join-pane'].includes(tokens[0]?.value) && tokens.some(token => /^--(pane|window|destination|x|y)(=|$)/.test(token.value))
  let source = ['-s', '--source'].includes(flag!) || (legacy && ['-t', '--target'].includes(flag!))
  let client = state.model.clients.find(client => client.id === state.clientId)
  let sourceId = tokens.findIndex(token => ['-s', '--source'].includes(token.value))
  let inlineSource = tokens.find(token => /^(?:-s|--source)=/.test(token.value))?.value.split('=').slice(1).join('=')
  let paneId = sourceId >= 0 ? tokens[sourceId + 1]?.value : inlineSource ?? client?.paneId
  let sourceWindow, sourcePaneId = paneId
  try { let source = resolvePaneTarget(state, paneId); sourceWindow = source.window; sourcePaneId = source.pane.id } catch { /* Keep completion available while a source is unfinished. */ }
  let windowCommand = ['rotate-window', 'move-window', 'swap-window', 'select-window'].includes(name)
  let paneTarget = flag !== '--window' && !windowCommand && (source || ['swap-pane', 'select-pane'].includes(name) || /\.(?:\d*|\{[^}]*|[+-]\d*)$/.test(query) || query.startsWith('%'))
  let currentSessionTarget = flag !== '--window' && (query.startsWith(':') || query.startsWith('.'))
  let coordinateWindow, coordinatePane = ''
  if (paneTarget && query.includes('.')) {
    let dot = query.lastIndexOf('.')
    coordinatePane = query.slice(dot + 1)
    try { coordinateWindow = resolveWindowTarget(state, query.slice(0, dot)).window } catch { /* A window prefix may still be incomplete. */ }
  }
  let candidates: { value: string; label: string; description: string }[] = []
  for (let session of state.model.sessions) {
    if (currentSessionTarget && session.id !== client?.sessionId) continue
    let sessionSelector = session.name.includes(':') || /^\d+$/.test(session.name) || state.model.sessions.filter(item => item.name === session.name).length > 1 ? session.id : session.name
    if (!source && !paneTarget && flag !== '--window' && !currentSessionTarget && ['move-pane', 'join-pane', 'break-pane', 'move-window'].includes(name)) candidates.push({ value: `${sessionSelector}:`, label: `${session.name}:`, description: ['move-pane', 'break-pane'].includes(name) ? 'New window in session' : name === 'move-window' ? 'Move window to session' : 'Join selected window in session' })
    for (let [index, window] of session.windows.entries()) {
      if (query.startsWith('.') && window.id !== client?.windowId) continue
      if (coordinateWindow && window !== coordinateWindow) continue
      if (paneTarget || !windowCommand && window === sourceWindow && ['move-pane', 'join-pane'].includes(name)) {
        for (let [paneIndex, paneId] of paneOrder(window).entries()) {
          if (/^\d+$/.test(coordinatePane) && paneIndex !== Number(coordinatePane)) continue
          if (!source && ['move-pane', 'join-pane'].includes(name) && (paneId === sourcePaneId || window.floating?.some(item => item.paneId === paneId))) continue
          let prefix = query.startsWith('.') ? '' : `${currentSessionTarget ? '' : sessionSelector}:${index + 1}`
          let value = query.startsWith('%') || source && !query.includes(':') && !query.includes('.') ? paneId : `${prefix}.${paneIndex}`
          candidates.push({ value, label: `${prefix}.${paneIndex} ${window.name} · ${paneId}`, description: source ? 'Source pane' : 'Destination pane' })
        }
      } else if (windowCommand || name === 'break-pane' || window !== sourceWindow) {
        let value = flag === '--window' ? window.id : `${currentSessionTarget ? '' : sessionSelector}:${index + 1}`
        candidates.push({ value, label: `${currentSessionTarget ? '' : session.name}:${index + 1} ${window.name}`, description: windowCommand ? source ? 'Source window' : 'Destination window' : name === 'break-pane' ? 'New window at index' : 'Join window' })
      }
    }
  }
  let matches = candidates.map(candidate => ({ candidate, match: fuzzyMatch(query.replace(/^:\{?/, '').replace(/\}$/, ''), `${candidate.label} ${candidate.value}`) }))
    .filter(item => item.match).sort((a, b) => b.match!.score - a.match!.score)
  return { query, entries: matches.map(({ candidate }) => ({ command: line.slice(0, start) + inline + quoteTarget(candidate.value), usage: candidate.label, description: candidate.description, complete: true })) }
}
