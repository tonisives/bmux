import { expect, test } from 'vitest'
import { initialModel, newPane, newWindow, splitLayout } from '../src/main/model'
import { resolvePaneTarget } from '../src/shared/command-target'

test('pane targets accept global IDs and session window coordinates without changing selection', () => {
  let model = initialModel(), session = model.sessions[0], first = session.windows[0]
  session.name = 'gp'
  let window = newWindow('Research', session.defaultProfileId), pane = newPane(session.defaultProfileId)
  window.number = 6
  window.panes.push(pane)
  window.layout = splitLayout(window.layout, window.panes[0].id, pane.id, 'horizontal')
  session.windows.push(window)
  model.clients.push({ id: 'client', sessionId: session.id, windowId: first.id, paneId: first.panes[0].id, width: 1280, height: 850 })
  model.clients.push({ ...model.clients[0], id: 'research-client', windowId: window.id, paneId: pane.id })
  let before = structuredClone(model.clients), state = { model, clientId: 'client' }
  expect(resolvePaneTarget(state, pane.id).pane).toBe(pane)
  expect(resolvePaneTarget(state, 'gp:6').pane).toBe(pane)
  expect(resolvePaneTarget(state, 'gp:6.0').pane).toBe(window.panes[0])
  expect(resolvePaneTarget(state, 'gp:6.1').pane).toBe(pane)
  expect(resolvePaneTarget(state, window.id).pane).toBe(pane)
  expect(() => resolvePaneTarget(state, 'gp:5')).toThrow("Window '5' not found")
  expect(() => resolvePaneTarget(state, 'gp:6.2')).toThrow("Pane '2' not found")
  expect(model.clients).toEqual(before)
  model.clients = []
  expect(resolvePaneTarget(state, pane.id).pane).toBe(pane)
  expect(resolvePaneTarget(state, 'gp:6').pane).toBe(window.panes[0])
  expect(resolvePaneTarget(state, 'gp:6.1').pane).toBe(pane)
  expect(() => resolvePaneTarget(state, '6')).toThrow('Specify a session')
})
