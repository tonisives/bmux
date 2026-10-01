import { expect, test } from 'vitest'
import { initialModel, newSession } from '../src/main/model'
import { commandTargetSuggestions } from '../src/shared/command-completion'
import { parseCommandLine } from '../src/shared/command-line'
import type { PublicState } from '../src/shared/types'

let state = (): PublicState => {
  let model = initialModel(), session = model.sessions[0], window = session.windows[0]
  model.clients.push({ id: 'client', sessionId: session.id, windowId: window.id, paneId: window.panes[0].id, width: 1280, height: 850 })
  let target = newSession('bmux-marketing', session.defaultProfileId)
  target.windows[0].name = 'research'
  target.windows.push(newSession('other', session.defaultProfileId).windows[0])
  target.windows[1].name = 'research'
  model.sessions.push(target)
  return { model, clientId: 'client', focusedClientId: 'client', snapshots: {}, crashes: {}, loading: {}, audio: {}, favicons: {}, pendingUrls: {}, navigation: {}, permissions: [], downloads: [], profileCaches: {}, profileProxyTests: {}, profileProxyFailures: {} }
}

test('pane move targets include sessions and distinct windows, and every completion resolves', () => {
  let current = state(), target = current.model.sessions[1]
  for (let line of ['movep -t ', 'movep -t', ':movep -v -t ', 'move-pane -t ', 'joinp --target=']) {
    let entries = commandTargetSuggestions(line, current)!.entries
    expect(entries.some(entry => entry.usage === 'bmux-marketing:')).toBe(true)
    expect(entries.some(entry => entry.usage === 'bmux-marketing:1 research')).toBe(true)
    expect(entries.some(entry => entry.usage === 'bmux-marketing:2 research')).toBe(true)
    for (let entry of entries) expect(() => parseCommandLine(entry.command, current)).not.toThrow()
    let session = entries.find(entry => entry.usage === 'bmux-marketing:')!
    expect(parseCommandLine(session.command, current).args).toMatchObject(line.includes('joinp') ? { window: target.windows[0].id } : { session: target.id })
  }
  let entries = commandTargetSuggestions('movep -t bmux-mar', current)!.entries
  expect(entries).toHaveLength(3)
  expect(commandTargetSuggestions('movep -t nonexistent', current)!.entries).toEqual([])
  expect(commandTargetSuggestions('open https://example.test', current)).toBeUndefined()
  expect(commandTargetSuggestions('movep -t work -v', current)).toBeUndefined()
})

test('target completion preserves source and split flags and quotes names while typing unfinished quotes', () => {
  let current = state(), target = current.model.sessions[1], source = current.model.clients[0].paneId
  target.name = 'work "notes" \\ archive'
  let line = `movep -s ${source} -v -t "work`
  let entries = commandTargetSuggestions(line, current)!.entries
  expect(entries).toHaveLength(3)
  let session = entries.find(entry => entry.description === 'New window in session')!
  expect(parseCommandLine(session.command, current).args).toEqual({ client: 'client', pane: source, session: target.id, axis: 'vertical' })
  expect(commandTargetSuggestions('movep -t :{work', current)!.entries).toHaveLength(3)
  target.name = 'work:notes'
  let colon = commandTargetSuggestions('movep -t work', current)!.entries.find(entry => entry.description === 'New window in session')!
  expect(parseCommandLine(colon.command, current).args).toMatchObject({ session: target.id })
})

test('legacy window targets complete IDs and source arguments complete panes', () => {
  let current = state(), source = current.model.clients[0].paneId, target = current.model.sessions[1]
  let windows = commandTargetSuggestions(`move-pane -t ${source} --window res`, current)!.entries
  expect(windows).toHaveLength(2)
  expect(parseCommandLine(windows[0].command, current).args).toMatchObject({ pane: source, window: target.windows[0].id })
  let panes = commandTargetSuggestions('movep -s ', current)!.entries
  expect(panes).toHaveLength(3)
  expect(panes.every(entry => entry.description === 'Source pane')).toBe(true)
})
