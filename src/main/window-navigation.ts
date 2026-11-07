import type { Client, Model } from '../shared/types'

type Navigation = { entries: string[]; index: number }
let histories = new WeakMap<Client, Navigation>()

export let recordWindowSelection = (client: Client) => {
  let history = histories.get(client)
  if (!history) { history = { entries: [client.windowId], index: 0 }; histories.set(client, history) }
  else if (history.entries[history.index] !== client.windowId) {
    history.entries = [...history.entries.slice(0, history.index + 1), client.windowId].slice(-200)
    history.index = history.entries.length - 1
  }
  return history
}

export let navigateWindowHistory = (model: Model, client: Client, direction: number) => {
  let history = recordWindowSelection(client)
  let windows = model.sessions.flatMap(session => session.windows)
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    let window = windows.find(window => window.id === history.entries[index])
    if (!window) continue
    history.index = index
    return window
  }
}
