import type { InternalWindow, WorkspaceSession } from './types'

export type WindowCloseBehavior = 'close-window' | 'confirm'

export let windowCloseBehavior = (session: WorkspaceSession, window: InternalWindow): WindowCloseBehavior => {
  let pages = window.panes.reduce((count, pane) => count + pane.tabs.length, 0)
  return pages <= 1 ? 'close-window' : 'confirm'
}
