import { commandTokens } from './command-line'
import { fuzzyMatch } from './command-search'
import type { CommandEntry } from './command-search'
import type { PublicState } from './types'

let quoteTarget = (value: string) => /[\s"'\\]/.test(value) ? `"${value.replace(/["\\]/g, '\\$&')}"` : value

export let commandTargetSuggestions = (line: string, state: PublicState): { query: string; entries: CommandEntry[] } | undefined => {
  let tokens = commandTokens(line, true), name = tokens[0]?.value
  if (!['movep', 'joinp', 'move-pane', 'join-pane'].includes(name)) return
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
  let legacy = ['move-pane', 'join-pane'].includes(name) && tokens.some(token => /^--(pane|window|destination|x|y)(=|$)/.test(token.value))
  let source = ['-s', '--source'].includes(flag!) || (legacy && ['-t', '--target'].includes(flag!))
  let client = state.model.clients.find(client => client.id === state.clientId)
  let sourceId = tokens.findIndex(token => ['-s', '--source'].includes(token.value))
  let inlineSource = tokens.find(token => /^(?:-s|--source)=/.test(token.value))?.value.split('=').slice(1).join('=')
  let paneId = sourceId >= 0 ? tokens[sourceId + 1]?.value : inlineSource ?? client?.paneId
  let sourceWindow = state.model.sessions.flatMap(session => session.windows).find(window => window.panes.some(pane => pane.id === paneId))
  let currentSessionTarget = !source && flag !== '--window' && query.startsWith(':')
  let candidates: { value: string; label: string; description: string }[] = []
  for (let session of state.model.sessions) {
    if (currentSessionTarget && session.id !== client?.sessionId) continue
    let sessionSelector = session.name.includes(':') ? session.id : session.name
    if (!source && flag !== '--window' && !currentSessionTarget) candidates.push({ value: `${sessionSelector}:`, label: `${session.name}:`, description: ['movep', 'move-pane'].includes(name) ? 'New window in session' : 'Join first window in session' })
    for (let [index, window] of session.windows.entries()) {
      if (source) {
        for (let pane of window.panes) candidates.push({ value: pane.id, label: `${session.name}:${index + 1} ${window.name} · ${pane.id}`, description: 'Source pane' })
      } else if (window !== sourceWindow) {
        let value = flag === '--window' ? window.id : `${currentSessionTarget ? '' : sessionSelector}:${index + 1}`
        candidates.push({ value, label: `${currentSessionTarget ? '' : session.name}:${index + 1} ${window.name}`, description: 'Join window' })
      }
    }
  }
  let matches = candidates.map(candidate => ({ candidate, match: fuzzyMatch(query.replace(/^:\{?/, '').replace(/\}$/, ''), `${candidate.label} ${candidate.value}`) }))
    .filter(item => item.match).sort((a, b) => b.match!.score - a.match!.score)
  return { query, entries: matches.map(({ candidate }) => ({ command: line.slice(0, start) + inline + quoteTarget(candidate.value), usage: candidate.label, description: candidate.description, complete: true })) }
}
