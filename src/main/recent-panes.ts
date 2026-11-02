import type { Client, WorkspaceSession } from '../shared/types'
import { searchRecentWindows } from '../shared/picker-search'

export let recentBackgroundPanes = (sessions: WorkspaceSession[], clients: Client[], hidden: Set<string>, visits: Map<string, number>, now = Date.now()) => {
  let positions = new Map<string, number>()
  for (let client of clients) {
    for (let [index, window] of searchRecentWindows(sessions, '', client).entries()) {
      for (let pane of window.panes) {
        if (!hidden.has(pane.id) || !visits.has(pane.id)) continue
        positions.set(pane.id, Math.min(positions.get(pane.id) ?? Infinity, index))
      }
    }
  }
  let order = [...positions.keys()].sort((a, b) => positions.get(a)! - positions.get(b)! || visits.get(b)! - visits.get(a)!)
  let retained = new Set(order.filter(id => now - visits.get(id)! < 20 * 60_000).slice(0, 4))
  return { order, retained }
}
