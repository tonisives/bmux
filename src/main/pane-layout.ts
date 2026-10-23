import { id } from './model'
import { layoutPaneIds } from './floating'
import type { Layout } from '../shared/types'

export type PaneLayout = 'tiled' | 'even-horizontal' | 'even-vertical'
let stack = (nodes: Layout[], axis: 'horizontal' | 'vertical'): Layout | null => nodes.length < 2 ? nodes[0] ?? null : {
  kind: 'split', id: id('split'), axis, ratio: 1 / nodes.length, first: nodes[0], second: stack(nodes.slice(1), axis)!,
}
export let arrangePanes = (layout: Layout | null, name: PaneLayout): Layout | null => {
  let panes: Layout[] = layoutPaneIds(layout).map(paneId => ({ kind: 'pane', paneId }))
  if (name !== 'tiled') return stack(panes, name === 'even-horizontal' ? 'horizontal' : 'vertical')
  let rows = Math.ceil(panes.length / Math.ceil(Math.sqrt(panes.length))), offset = 0
  return stack(Array.from({ length: rows }, (_, index) => {
    let count = Math.floor(panes.length / rows) + Number(index < panes.length % rows)
    let row = stack(panes.slice(offset, offset + count), 'horizontal')!
    offset += count
    return row
  }), 'vertical')
}

export let maximizePane = (layout: Layout | null, paneId: string, axis: 'horizontal' | 'vertical'): Layout | null => {
  let path: Extract<Layout, { kind: 'split' }>[] = []
  let find = (node: Layout | null): boolean => {
    if (!node) return false
    if (node.kind === 'pane') return node.paneId === paneId
    path.push(node)
    if (find(node.first) || find(node.second)) return true
    path.pop()
    return false
  }
  if (!find(layout)) return layout
  let count = path.filter(node => node.axis === axis).length
  if (!count) return layout
  let size = 1, siblingSize = .05 / count
  let resize = (node: Layout): Layout => {
    if (node.kind === 'pane' || !path.includes(node)) return node
    let first = node.first.kind === 'pane' ? node.first.paneId === paneId : path.includes(node.first)
    let ratio = node.ratio
    if (node.axis === axis) { let selectedSize = size - siblingSize; ratio = first ? selectedSize / size : siblingSize / size; size = selectedSize }
    return { ...node, ratio, ...(first ? { first: resize(node.first) } : { second: resize(node.second) }) }
  }
  return resize(layout!)
}
