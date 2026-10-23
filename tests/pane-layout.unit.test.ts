import { expect, it } from 'vitest'
import { arrangePanes, maximizePane } from '../src/main/pane-layout'
import { layoutPaneIds } from '../src/main/floating'
import type { Layout } from '../src/shared/types'

let rects = (layout: Layout | null, x = 0, y = 0, width = 1, height = 1, gutter = 0): { paneId: string; x: number; y: number; width: number; height: number }[] => {
  if (!layout) return []
  if (layout.kind === 'pane') return [{ paneId: layout.paneId, x, y, width, height }]
  let horizontal = layout.axis === 'horizontal', ratio = layout.ratio, available = (horizontal ? width : height) - gutter
  return [...rects(layout.first, x, y, horizontal ? available * ratio : width, horizontal ? height : available * ratio, gutter), ...rects(layout.second, horizontal ? x + available * ratio + gutter : x, horizontal ? y : y + available * ratio + gutter, horizontal ? available * (1 - ratio) : width, horizontal ? height : available * (1 - ratio), gutter)]
}
let tree = (count: number): Layout | null => count === 0 ? null : count === 1 ? { kind: 'pane', paneId: 'p1' } : { kind: 'split', id: `s${count}`, axis: 'horizontal', ratio: .5, first: tree(count - 1)!, second: { kind: 'pane', paneId: `p${count}` } }
it.each([0, 1, 2, 3, 5, 8])('arranges %i panes in ordered rows, columns, and a grid', count => {
  let original = tree(count), before = structuredClone(original)
  for (let name of ['tiled', 'even-horizontal', 'even-vertical'] as const) {
    let layout = arrangePanes(original, name), panes = rects(layout)
    expect(layoutPaneIds(layout)).toEqual(layoutPaneIds(original))
    expect(panes.length).toBe(count)
    for (let pane of panes) { expect(pane.width).toBeGreaterThan(0); expect(pane.height).toBeGreaterThan(0) }
    if (count) expect(panes.reduce((total, pane) => total + pane.width * pane.height, 0)).toBeCloseTo(1)
    if (name === 'even-horizontal') for (let pane of panes) { expect(pane.width).toBeCloseTo(1 / count); expect(pane.height).toBe(1) }
    if (name === 'even-vertical') for (let pane of panes) { expect(pane.height).toBeCloseTo(1 / count); expect(pane.width).toBe(1) }
    if (name === 'tiled' && count > 2) expect(new Set(panes.map(pane => pane.y)).size).toBeGreaterThan(1)
  }
  expect(original).toEqual(before)
})
it('expands a nested pane to 95% along one axis while retaining the other dimension', () => {
  let original = tree(5)!, before = rects(original)
  let widened = maximizePane(original, 'p1', 'horizontal'), after = rects(widened)
  expect(after[0].width).toBeCloseTo(.95)
  expect(after.map(pane => [pane.y, pane.height])).toEqual(before.map(pane => [pane.y, pane.height]))
  expect(layoutPaneIds(widened)).toEqual(layoutPaneIds(original))
  expect(after.every(pane => pane.width > 0)).toBe(true)
  expect(maximizePane(original, 'missing', 'horizontal')).toBe(original)
  let rows = arrangePanes(original, 'even-vertical')!
  expect(rects(maximizePane(rows, 'p5', 'vertical')).at(-1)?.height).toBeCloseTo(.95)
  expect(maximizePane(rows, 'p1', 'horizontal')).toBe(rows)
})

it('keeps four columns and rows equal when rendered with split gutters', () => {
  let columns = rects(arrangePanes(tree(4), 'even-horizontal'), 0, 0, 1024, 700, 3)
  let rows = rects(arrangePanes(tree(4), 'even-vertical'), 0, 0, 1024, 700, 3)
  for (let pane of columns) expect(pane.width).toBeCloseTo((1024 - 9) / 4)
  for (let pane of rows) expect(pane.height).toBeCloseTo((700 - 9) / 4)
})
