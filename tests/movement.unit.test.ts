import { expect, test } from 'vitest'
import { initialModel, newPane, newSession, newWindow, repairClientSelections, splitLayout, validateModel } from '../src/main/model'
import { liftPane, layoutPaneIds } from '../src/main/floating'
import { moveWindow, rotatePanes, swapPanes, swapWindows } from '../src/main/movement'

let fixture = () => {
  let model = initialModel(), session = model.sessions[0], first = session.windows[0]
  let second = newWindow('second', session.defaultProfileId, false, model)
  session.windows.push(second)
  let third = newWindow('third', session.defaultProfileId, false, model)
  session.windows.push(third)
  let work = newSession('work', session.defaultProfileId, false, model)
  model.sessions.push(work)
  let client = { id: 'client', sessionId: session.id, windowId: first.id, paneId: first.panes[0].id, width: 1280, height: 850, zoomedPaneId: first.panes[0].id }
  model.clients.push(client)
  return { model, session, first, second, third, work, client }
}

test('window insertion handles indices, before/after, session transfer and empty source cleanup', () => {
  let { model, session, first, second, third, work, client } = fixture()
  moveWindow(model, { client: client.id, window: first.id, position: 3 })
  expect(session.windows).toEqual([second, third, first])
  expect(client.zoomedPaneId).toBe(first.panes[0].id)
  moveWindow(model, { client: client.id, window: first.id, position: 2, before: true })
  expect(session.windows).toEqual([second, first, third])
  moveWindow(model, { client: client.id, window: second.id, position: 2, after: true })
  expect(session.windows).toEqual([first, second, third])
  let target = work.windows[0], pane = target.panes[0]
  moveWindow(model, { client: client.id, window: target.id, session: session.id, position: 2 })
  expect(session.windows).toEqual([first, target, second, third])
  expect(model.sessions).not.toContain(work)
  expect(target.panes[0]).toBe(pane)
  expect(client).toMatchObject({ sessionId: session.id, windowId: target.id, paneId: pane.id })
  expect(validateModel(structuredClone(model))).toBeDefined()
})

test('window swapping exchanges nonadjacent slots and background operations preserve client selection', () => {
  let { model, session, first, second, third, work, client } = fixture()
  swapWindows(model, { client: client.id, window: first.id, destination: third.id })
  expect(session.windows).toEqual([third, second, first])
  expect(client.windowId).toBe(first.id)
  expect(client.zoomedPaneId).toBe(first.panes[0].id)
  let selected = { ...client }
  moveWindow(model, { client: client.id, window: second.id, session: work.id, position: 'last', background: true })
  repairClientSelections(model)
  expect(client).toMatchObject({ sessionId: selected.sessionId, windowId: selected.windowId, paneId: selected.paneId })
  swapWindows(model, { client: client.id, window: third.id, destination: work.windows[0].id, background: true })
  expect(client.windowId).toBe(first.id)
  expect(session.windows[0].name).toBe('main')
  expect(validateModel(structuredClone(model))).toBeDefined()
})

test('invalid indices and private session transfers reject without changing the model', () => {
  let { model, first, work, client } = fixture()
  let original = structuredClone(model)
  expect(() => moveWindow(model, { client: client.id, window: first.id, position: 99 })).toThrow('Window index')
  expect(model).toEqual(original)
  work.private = true; original = structuredClone(model)
  for (let operation of [
    () => moveWindow(model, { client: client.id, window: first.id, session: work.id, position: 1 }),
    () => swapWindows(model, { client: client.id, window: first.id, destination: work.windows[0].id }),
    () => swapPanes(model, { client: client.id, pane: first.panes[0].id, destination: work.windows[0].panes[0].id }),
  ]) { expect(operation).toThrow('private'); expect(model).toEqual(original) }
})

test('pane swaps preserve page objects, profiles, floating slots, dock references and client validity', () => {
  let { model, session, first, second, client } = fixture()
  let added = newPane('profile_bot', 'https://fixture.test/live', model), source = first.panes[0], destination = second.panes[0]
  first.panes.push(added); first.layout = splitLayout(first.layout, source.id, added.id, 'vertical')
  let placement = liftPane(first, added.id, 1280, 850)
  client.paneId = added.id
  swapPanes(model, { client: client.id, pane: added.id, destination: destination.id, background: true, keepZoom: true })
  expect(first.floating![0]).toMatchObject({ paneId: destination.id, x: placement.x, y: placement.y, dock: { siblingIds: [source.id] } })
  expect(second.panes[0]).toBe(added)
  expect(second.panes[0]).toMatchObject({ profileId: 'profile_bot', url: 'https://fixture.test/live' })
  expect(client).toMatchObject({ sessionId: session.id, windowId: first.id, paneId: destination.id, zoomedPaneId: destination.id })
  swapPanes(model, { client: client.id, pane: source.id, destination: destination.id })
  expect(first.floating![0]).toMatchObject({ paneId: source.id, dock: { siblingIds: [destination.id] } })
  expect(layoutPaneIds(first.layout)).toEqual([destination.id])
  expect(client.zoomedPaneId).toBeNull()
  expect(validateModel(structuredClone(model))).toBeDefined()
})

test('pane rotation rotates tiled positions in both directions and leaves floating panes in place', () => {
  let { model, first, client } = fixture(), source = first.panes[0]
  let second = newPane(first.panes[0].profileId, 'about:blank', model)
  first.panes.push(second); first.layout = splitLayout(first.layout, source.id, second.id, 'horizontal')
  let third = newPane(first.panes[0].profileId, 'about:blank', model)
  first.panes.push(third); first.layout = splitLayout(first.layout, second.id, third.id, 'vertical')
  let floating = newPane(first.panes[0].profileId, 'about:blank', model)
  first.panes.push(floating); liftPane(first, floating.id, 1280, 850)
  let float = structuredClone(first.floating)
  rotatePanes(model, { window: first.id, direction: 1, keepZoom: true })
  expect(layoutPaneIds(first.layout)).toEqual([third.id, source.id, second.id])
  expect(client.paneId).toBe(third.id)
  expect(client.zoomedPaneId).toBe(third.id)
  expect(first.floating).toEqual(float)
  rotatePanes(model, { window: first.id, direction: -1 })
  expect(layoutPaneIds(first.layout)).toEqual([source.id, second.id, third.id])
  expect(client.paneId).toBe(source.id)
  expect(client.zoomedPaneId).toBeNull()
  expect(validateModel(structuredClone(model))).toBeDefined()
})
