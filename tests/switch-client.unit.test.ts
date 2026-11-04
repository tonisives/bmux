import { expect, test } from 'vitest'
import { initialModel, newPane, newSession, newWindow, repairClientSelections, splitLayout } from '../src/main/model'
import { switchClient } from '../src/main/switch-client'
import { parseCommandLine } from '../src/shared/command-line'
import { commandTargetSuggestions } from '../src/shared/command-completion'
import { parseConfig } from '../src/main/config'
import { readOnlyAction } from '../src/shared/keyboard'
import type { PublicState } from '../src/shared/types'

let fixture = () => {
  let model = initialModel(), first = model.sessions[0]
  first.name = 'alpha'; first.createdAt = 1; first.lastActivityAt = 30
  let second = newSession('beta', first.defaultProfileId, false, model)
  second.createdAt = 2; second.lastActivityAt = 20
  model.sessions.push(second)
  let window = newWindow('research', first.defaultProfileId, false, model)
  second.windows.push(window)
  let pane = newPane(first.defaultProfileId, 'about:blank', model)
  window.layout = splitLayout(window.layout, window.panes[0].id, pane.id, 'horizontal')
  window.panes.push(pane)
  let client = { id: 'client', sessionId: first.id, windowId: first.windows[0].id, paneId: first.windows[0].panes[0].id, width: 1280, height: 850 }
  model.clients.push(client)
  repairClientSelections(model)
  let state = { model, clientId: client.id } as PublicState
  let run = (line: string) => { let command = parseCommandLine(line, state); let result = switchClient(model, command.args!); repairClientSelections(model); return result }
  return { model, first, second, window, pane, client: model.clients[0], state, run }
}

test('switchc and switch-client select global pane IDs and session/window/pane coordinates', () => {
  for (let command of ['switchc', 'switch-client']) for (let target of ['id', 'coordinate']) {
    let { run, first, second, window, pane, client } = fixture()
    expect(run(`:${command} -t ${target === 'id' ? pane.id : 'beta:2.1'}`)).toMatchObject({ sessionId: second.id, windowId: window.id, paneId: pane.id })
    expect(run('switchc -l').sessionId).toBe(first.id)
    expect(run('switchc -l').sessionId).toBe(second.id)
    expect(run('session alpha').sessionId).toBe(first.id)
    expect(run('switchc -t beta:2').windowId).toBe(window.id)
    expect(run(`switchc -c${client.id} -Zt${pane.id}`).paneId).toBe(pane.id)
  }
})

test('explicit clients resolve relative pane targets in their own session', () => {
  let { model, state, second, window, pane } = fixture()
  model.clients.push({ id: 'other', sessionId: second.id, windowId: window.id, paneId: window.panes[0].id, width: 600, height: 400 })
  let command = parseCommandLine('switchc -c other -t .1', state)
  expect(switchClient(model, command.args!)).toMatchObject({ id: 'other', paneId: pane.id, sessionId: second.id })
})

test('zoom is cleared for pane targets and retained with -Z, including remembered destination zoom', () => {
  let { run, client, window, pane } = fixture()
  client.windowZooms = { [window.id]: window.panes[0].id }
  expect(run(`switchc -Zt${pane.id}`).zoomedPaneId).toBe(pane.id)
  expect(client.windowZooms[window.id]).toBe(pane.id)
  expect(run(`switchc -t ${window.panes[0].id}`).zoomedPaneId).toBeNull()
  expect(client.windowZooms[window.id]).toBeUndefined()
})

test('session cycling wraps in each supported sort order and last ignores removed sessions', () => {
  let { run, client, first, second, model } = fixture()
  for (let order of ['name', 'size', 'creation', 'activity']) {
    expect(run(`switchc -n -O ${order}`).sessionId).toBe(second.id)
    expect(run(`switchc -p -O ${order}`).sessionId).toBe(first.id)
    expect(run(`switchc -p -O ${order}`).sessionId).toBe(second.id)
    expect(run('switchc -l').sessionId).toBe(first.id)
  }
  client.sessionHistory = ['removed', first.id]
  expect(() => run('switchc -l')).toThrow('No last session')
  let third = newSession('aardvark', first.defaultProfileId, false, model)
  third.createdAt = 3; third.lastActivityAt = 10; model.sessions.push(third)
  expect(run('switchc -n -O name').sessionId).toBe(second.id)
  expect(run('switchc -n -O name').sessionId).toBe(third.id)
  expect(run('switchc -n -O creation').sessionId).toBe(first.id)
  expect(run('switchc -n -O activity').sessionId).toBe(third.id)
})

test('flags toggle read-only mode, validate key tables and leave selection alone for -T', () => {
  let { run, client, model, pane } = fixture()
  expect(run('switchc -Er')).toMatchObject({ readOnly: true, ignoreSize: true })
  expect(run('switchc -r')).toMatchObject({ readOnly: false, ignoreSize: false })
  let keyboard = parseConfig('keyboard:\n  keyTables:\n    next:\n      c: switchc -T prefix\n').keyboard
  let previousPane = client.paneId
  expect(switchClient(model, { client: client.id, session: pane.id, keyTable: 'next' }, keyboard).keyTable).toBe('next')
  expect(client.paneId).toBe(previousPane)
  expect(switchClient(model, { client: client.id, keyTable: 'root' }, keyboard).keyTable).toBeUndefined()
  expect(() => switchClient(model, { client: client.id, keyTable: 'constructor' }, keyboard)).toThrow('not found')
  expect(readOnlyAction('switchc -r')).toBe(true)
  expect(readOnlyAction('reload')).toBe(false)
  expect(() => run('switchc -O bad -n')).toThrow('Sort order')
  expect(() => run('switchc -t %9999')).toThrow()
  expect(() => run('switchc -T missing')).toThrow('Key table')
  expect(() => run('switchc -t')).toThrow('Missing value')
  expect(() => run('switchc --unsupported yes')).toThrow('Unsupported option')
})

test('completion includes the current session and panes, and each candidate executes', () => {
  let { state, pane, first } = fixture()
  for (let line of ['switchc -t ', ':switch-client --target=', 'switchc -t']) {
    let suggestions = commandTargetSuggestions(line, state)!.entries
    expect(suggestions.some(entry => entry.usage === first.name)).toBe(true)
    expect(suggestions.some(entry => entry.command.endsWith(pane.id))).toBe(true)
    for (let entry of suggestions) expect(() => switchClient(structuredClone(state.model), parseCommandLine(entry.command, state).args!)).not.toThrow()
  }
})
