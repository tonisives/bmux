import type { InternalWindow, WorkspaceSession } from './types'

export type WindowCloseBehavior = 'close-window' | 'confirm'

export let windowCloseBehavior = (session: WorkspaceSession, window: InternalWindow): WindowCloseBehavior => {
  let pages = window.panes.length
  return pages <= 1 ? 'close-window' : 'confirm'
}
