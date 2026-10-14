import type { InternalWindow, WorkspaceSession } from './types'

export let windowNumber = (window: InternalWindow, index: number) => window.number ?? index + 1

export let assignWindowNumbers = (session: WorkspaceSession) => {
  let used = new Set<number>()
  for (let window of session.windows) {
    if (Number.isSafeInteger(window.number) && window.number! > 0 && !used.has(window.number!)) used.add(window.number!)
    else delete window.number
  }
  for (let window of session.windows) {
    if (window.number !== undefined) continue
    let number = 1
    while (used.has(number)) number++
    window.number = number
    used.add(number)
  }
}

export let renumberWindows = (session: WorkspaceSession) => {
  session.windows.forEach((window, index) => { window.number = index + 1 })
  return session.windows
}
