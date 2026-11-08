import { expect, it } from 'vitest'
import { initialModel, newWindow, repairClientSelections, selectClientWindow } from '../src/main/model'
import { navigateWindowHistory } from '../src/main/window-navigation'

it('traverses visited windows, skips closed windows, and branches after a new selection', () => {
  let model = initialModel(), session = model.sessions[0], first = session.windows[0]
  let second = newWindow('test', session.defaultProfileId, false, model)
  session.windows.push(second)
  let third = newWindow('test', session.defaultProfileId, false, model)
  session.windows.push(third)
  let client = { id: 'client', sessionId: session.id, windowId: first.id, paneId: first.panes[0].id, width: 800, height: 600 }
  model.clients.push(client)
  repairClientSelections(model)
  selectClientWindow(client, session, third)
  selectClientWindow(client, session, second)
  let go = (direction: number) => {
    let window = navigateWindowHistory(model, client, direction)
    if (window) selectClientWindow(client, session, window, false)
    repairClientSelections(model)
    return window?.id
  }
  expect(go(-1)).toBe(third.id)
  expect(go(-1)).toBe(first.id)
  expect(go(-1)).toBeUndefined()
  expect(go(1)).toBe(third.id)
  expect(go(1)).toBe(second.id)
  expect(go(1)).toBeUndefined()
  session.windows = session.windows.filter(window => window !== third)
  expect(go(-1)).toBe(first.id)
  selectClientWindow(client, session, first)
  expect(go(1)).toBe(second.id)
  expect(go(-1)).toBe(first.id)
  let fourth = newWindow('test', session.defaultProfileId, false, model)
  session.windows.push(fourth)
  selectClientWindow(client, session, fourth)
  expect(go(1)).toBeUndefined()
  expect(go(-1)).toBe(first.id)
})
