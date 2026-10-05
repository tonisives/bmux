import { expect, test } from 'vitest'
import { initialModel, newPane, newSession, newWindow, splitLayout } from '../src/main/model'
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
  expect(commandTargetSuggestions('movep -t :{work', current)!.entries).toHaveLength(0)
  target.name = 'work:notes'
  let colon = commandTargetSuggestions('movep -t work', current)!.entries.find(entry => entry.description === 'New window in session')!
  expect(parseCommandLine(colon.command, current).args).toMatchObject({ session: target.id })
})

test('omitted session targets complete only windows in the current client session', () => {
  let current = state(), session = current.model.sessions[1], destination = session.windows[0]
  let source = newWindow('source', session.defaultProfileId)
  session.windows.push(source)
  current.model.sessions[0].windows[0].name = 'research'
  Object.assign(current.model.clients[0], { sessionId: session.id, windowId: source.id, paneId: source.panes[0].id })
  for (let command of ['joinp', 'join-pane', 'movep', 'move-pane']) {
    let entries = commandTargetSuggestions(`${command} -t :`, current)!.entries
    expect(entries.map(entry => entry.usage)).toEqual([':1 research', ':2 research'])
    expect(entries.every(entry => entry.description === 'Join window')).toBe(true)
    expect(parseCommandLine(entries[0].command, current).args).toMatchObject({ pane: source.panes[0].id, window: destination.id })
    expect(commandTargetSuggestions(`${command} -t :1`, current)!.entries.map(entry => entry.command)).toEqual([`${command} -t :1`])
    expect(commandTargetSuggestions(`${command} -t :res`, current)!.entries).toHaveLength(2)
    expect(commandTargetSuggestions(`${command} -t :missing`, current)!.entries).toEqual([])
  }
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

test('window and break commands complete explicit sources and destinations that resolve', () => {
  let current = state()
  for (let command of ['movew', 'swapw', 'rotatew', 'breakp', 'selectw']) {
    for (let flag of command === 'rotatew' || command === 'selectw' ? ['-t'] : ['-s', '-t']) {
      let entries = commandTargetSuggestions(`${command} ${flag === '-s' ? '-t :1 ' : ''}${flag} :`, current)!.entries
      expect(entries.length).toBeGreaterThan(0)
      for (let entry of entries) expect(() => parseCommandLine(entry.command, current)).not.toThrow()
      expect(entries.every(entry => entry.usage?.startsWith(':'))).toBe(true)
    }
  }
  current.model.sessions[1].name = current.model.sessions[0].name
  let entries = commandTargetSuggestions('movew -t ', current)!.entries
  for (let entry of entries) expect(() => parseCommandLine(entry.command, current)).not.toThrow()
})

test('pane coordinates and same-window joins complete pane positions without suggesting the source', () => {
  let current = state(), window = current.model.sessions[0].windows[0], source = window.panes[0]
  let other = newPane(source.profileId, 'about:blank', current.model)
  window.panes.push(other); window.layout = splitLayout(window.layout, source.id, other.id, 'horizontal')
  let entries = commandTargetSuggestions('joinp -t .', current)!.entries
  expect(entries.map(entry => entry.command)).toEqual(['joinp -t .1'])
  expect(parseCommandLine(entries[0].command, current).args).toMatchObject({ pane: source.id, destination: other.id })
  entries = commandTargetSuggestions('joinp -s :1.1 -t :1.', current)!.entries
  expect(entries.map(entry => entry.command)).toEqual(['joinp -s :1.1 -t :1.0'])
  for (let command of ['swapp', 'selectp']) {
    entries = commandTargetSuggestions(`${command} -t :1.`, current)!.entries
    expect(entries).toHaveLength(2)
    for (let entry of entries) expect(() => parseCommandLine(entry.command, current)).not.toThrow()
  }
})
