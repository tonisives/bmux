import type { Model } from './types'

export let permissionPaneLabel = (model: Model, paneId: string) => {
  for (let session of model.sessions) for (let [index, window] of session.windows.entries()) {
    if (window.panes.some(pane => pane.id === paneId)) return `${session.name}:${index + 1} · ${paneId}`
  }
  return undefined
}
