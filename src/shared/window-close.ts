import type { InternalWindow, WorkspaceSession } from './types'

export type WindowCloseBehavior = 'close-window' | 'confirm' | 'locked'

export let sessionIsLocked = (session: WorkspaceSession) => session.windows.some(window => window.locked === true)

export let windowCloseBehavior = (session: WorkspaceSession, window: InternalWindow): WindowCloseBehavior => {
  if (window.locked) return 'locked'
  let pages = window.panes.length
  return pages <= 1 ? 'close-window' : 'confirm'
}
