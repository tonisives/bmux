import type { Model, Pane } from './types'

// Browser navigation metadata is independent of the page's window.opener.
export let backOpener = (model: Model, source?: Pane) => {
  if (!source?.backToOpener || !source.openerPaneId || source.openerPaneId === source.id) return
  for (let session of model.sessions) for (let window of session.windows) {
    let pane = window.panes.find(pane => pane.id === source.openerPaneId)
    if (pane) return { session, window, pane }
  }
}
