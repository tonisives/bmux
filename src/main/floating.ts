import type { FloatingPane, InternalWindow, Layout } from '../shared/types'
import { clampFloat } from '../shared/floating'
import { id, mapLayout, removePane } from './model'

export let layoutPaneIds = (layout: Layout | null): string[] => !layout ? [] : layout.kind === 'pane' ? [layout.paneId] : [...layoutPaneIds(layout.first), ...layoutPaneIds(layout.second)]
export let rememberPlacement = (window: InternalWindow, placement: FloatingPane, width: number, height: number) => {
  window.lastFloating = { x: placement.x, y: placement.y, width: placement.width, height: placement.height, workspaceWidth: Math.max(1, width), workspaceHeight: Math.max(1, height) }
}
let rememberedPlacement = (window: InternalWindow, paneId: string, width: number, height: number): FloatingPane | undefined => {
  let saved = window.lastFloating
  if (!saved || window.floating?.length) return
  let restoredWidth = Math.min(width, saved.width), restoredHeight = Math.min(height, saved.height)
  let xTravel = Math.max(0, saved.workspaceWidth - saved.width), yTravel = Math.max(0, saved.workspaceHeight - saved.height)
  let x = xTravel ? saved.x / xTravel * Math.max(0, width - restoredWidth) : saved.x
  let y = yTravel ? saved.y / yTravel * Math.max(0, height - restoredHeight) : saved.y
  return clampFloat({ paneId, x, y, width: restoredWidth, height: restoredHeight }, width, height)
}
export let liftPane = (window: InternalWindow, paneId: string, width: number, height: number) => {
  let existing = window.floating?.find(item => item.paneId === paneId)
  if (existing) return existing
  let dock: FloatingPane['dock']
  mapLayout(window.layout, node => {
    if (node.kind === 'split') {
      let before = node.first.kind === 'pane' && node.first.paneId === paneId
      let after = node.second.kind === 'pane' && node.second.paneId === paneId
      if (before || after) dock = { siblingIds: layoutPaneIds(before ? node.second : node.first), axis: node.axis, ratio: node.ratio, before }
    }
    return node
  })
  let offset = 24 * ((window.floating?.length ?? 0) % 8 + 1)
  let floating = rememberedPlacement(window, paneId, width, height) ?? clampFloat({ paneId, x: offset, y: offset, width: width * .6, height: height * .6 }, width, height)
  floating.dock = dock
  window.layout = removePane(window.layout, paneId)
  window.floating = [...window.floating ?? [], floating]
  rememberPlacement(window, floating, width, height)
  return floating
}
export let forgetPlacement = (window: InternalWindow, paneId: string) => {
  window.layout = removePane(window.layout, paneId)
  window.floating = window.floating?.filter(item => item.paneId !== paneId)
}
export let dockPane = (window: InternalWindow, paneId: string, placement?: FloatingPane, target?: string, axis?: 'horizontal' | 'vertical') => {
  let ids = layoutPaneIds(window.layout)
  if (target && !ids.includes(target)) throw new Error('Destination must be a tiled pane')
  let previous = !target && !axis ? placement?.dock : undefined
  let sibling = previous?.siblingIds.find(id => ids.includes(id))
  let destination = target ?? sibling ?? ids[0]
  if (!destination) { window.layout = { kind: 'pane', paneId }; return }
  let restored = false
  window.layout = mapLayout(window.layout, node => {
    if (restored) return node
    let members = layoutPaneIds(node)
    let exactSibling = previous && members.length === previous.siblingIds.length && members.every(id => previous.siblingIds.includes(id))
    if (exactSibling && previous) {
      restored = true
      let added: Layout = { kind: 'pane', paneId }
      return { kind: 'split', id: id('split'), axis: previous.axis, ratio: previous.ratio, first: previous.before ? added : node, second: previous.before ? node : added }
    }
    return node
  })
  if (restored) return
  window.layout = mapLayout(window.layout, node => {
    if (node.kind !== 'pane' || node.paneId !== destination) return node
    let added: Layout = { kind: 'pane', paneId }
    let before = !!sibling && previous?.before
    return { kind: 'split', id: id('split'), axis: axis ?? previous?.axis ?? 'horizontal', ratio: sibling ? previous!.ratio : .5, first: before ? added : node, second: before ? node : added }
  })
}
export let raisePane = (window: InternalWindow, paneId: string) => {
  let placement = window.floating?.find(item => item.paneId === paneId)
  if (placement) window.floating = [...window.floating!.filter(item => item !== placement), placement]
}
