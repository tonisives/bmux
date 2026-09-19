import { expect, it } from 'vitest'
import { cloneWindow, initialModel, newPane, paneInDirection, splitLayout, validateModel } from '../src/main/model'
import { dockPane, forgetPlacement, layoutPaneIds, liftPane, raisePane } from '../src/main/floating'
import { clampFloat, FLOAT_BORDER, FLOAT_CONTENT_INSET, FLOAT_HEADER } from '../src/shared/floating'

it('keeps floating page content inside the visible frame', () => {
  expect(FLOAT_BORDER).toBe(2.25)
  expect(FLOAT_CONTENT_INSET).toBe(6)
  expect(FLOAT_HEADER).toBe(30)
})

it('lifts a pane and restores its position, orientation and ratio without replacing tabs', () => {
  let model = initialModel(), window = model.sessions[0].windows[0], first = window.panes[0]
  let second = newPane(first.profileId), third = newPane(first.profileId)
  window.panes.push(second, third)
  window.layout = splitLayout(window.layout, first.id, second.id, 'horizontal')
  window.layout = splitLayout(window.layout, second.id, third.id, 'vertical')
  if (window.layout.kind === 'split') window.layout.ratio = .3
  let original = structuredClone(window.layout)
  let floating = liftPane(window, first.id, 1280, 800)
  expect(layoutPaneIds(window.layout)).toEqual([second.id, third.id])
  expect(validateModel(model)).toBe(model)
  forgetPlacement(window, first.id); dockPane(window, first.id, floating)
  expect(window.layout).toMatchObject({ ...original, id: expect.any(String) })
  expect(window.panes[0]).toBe(first)
  expect(validateModel(model)).toBe(model)
})

it('supports only-floating windows, stale docking targets, and stacking', () => {
  let model = initialModel(), window = model.sessions[0].windows[0], first = window.panes[0]
  let second = newPane(first.profileId)
  window.panes.push(second); window.layout = splitLayout(window.layout, first.id, second.id, 'vertical')
  let floating = liftPane(window, first.id, 1000, 800)
  liftPane(window, second.id, 1000, 800)
  expect(window.layout).toBeNull()
  expect(validateModel(model)).toBe(model)
  raisePane(window, first.id)
  expect(window.floating?.at(-1)?.paneId).toBe(first.id)
  forgetPlacement(window, first.id); dockPane(window, first.id, floating)
  expect(window.layout).toEqual({ kind: 'pane', paneId: first.id })
  expect(validateModel(model)).toBe(model)
})

it('clones floating placements and validates persisted geometry and membership', () => {
  let model = initialModel(), window = model.sessions[0].windows[0], first = window.panes[0]
  expect(validateModel(JSON.parse(JSON.stringify(model)))).toEqual(model)
  liftPane(window, first.id, 1000, 800)
  let copy = cloneWindow(window)
  expect(copy.floating?.[0].paneId).toBe(copy.panes[0].id)
  expect(copy.floating?.[0].paneId).not.toBe(first.id)
  expect(validateModel(JSON.parse(JSON.stringify(model)))).toEqual(model)
  window.layout = { kind: 'pane', paneId: first.id }
  expect(() => validateModel(model)).toThrow('Invalid layout leaves')
  window.layout = null
  window.floating![0].width = NaN
  expect(() => validateModel(model)).toThrow('Invalid floating geometry')
})

it('clamps to the available workspace and navigates overlapping rectangles', () => {
  let rect = clampFloat({ paneId: 'a', x: 1200, y: 900, width: 900, height: 700 }, 500, 300)
  expect(rect).toMatchObject({ x: 0, y: 0, width: 500, height: 300 })
  expect(clampFloat({ ...rect, width: 1, height: 1 }, 200, 100)).toMatchObject({ width: 200, height: 100 })
  let panes = [{ paneId: 'a', x: 0, y: 0, width: 600, height: 500 }, { paneId: 'b', x: 200, y: 100, width: 500, height: 300 }]
  expect(paneInDirection(null, 'a', 'right', panes)).toBe('b')
  expect(paneInDirection(null, 'b', 'left', panes)).toBe('a')
})
