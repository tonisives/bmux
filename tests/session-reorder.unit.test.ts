import { expect, it } from 'vitest'
import { initialModel, newSession } from '../src/main/model'
import { reorderSession } from '../src/main/movement'

it('moves sessions before and after a target without changing client selection', () => {
  let model = initialModel(), first = model.sessions[0]
  let second = newSession('second', first.defaultProfileId), third = newSession('third', first.defaultProfileId)
  model.sessions.push(second, third)
  let client = { id: 'client', sessionId: first.id, windowId: first.windows[0].id, paneId: first.windows[0].panes[0].id, width: 1000, height: 800 }
  model.clients.push(client)
  reorderSession(model, third.id, first.id, 'before')
  expect(model.sessions.map(session => session.id)).toEqual([third.id, first.id, second.id])
  reorderSession(model, third.id, second.id, 'after')
  expect(model.sessions.map(session => session.id)).toEqual([first.id, second.id, third.id])
  reorderSession(model, first.id, first.id, 'after')
  expect(model.sessions.map(session => session.id)).toEqual([first.id, second.id, third.id])
  expect(model.clients).toEqual([client])
  expect(() => reorderSession(model, first.id, second.id, 'invalid')).toThrow('before or after')
})
