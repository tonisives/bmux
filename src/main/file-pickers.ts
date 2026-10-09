import type { BaseWindow, WebContents } from 'electron'

type Owner = { windowId?: number; visible: boolean }
type Entry = { at: number; event: string; paneId?: string; windowId?: number; visible?: boolean; enabled?: boolean; cancel?: boolean; sessionId?: string }

export let createFilePickers = (settled = () => {}) => {
  let events: Entry[] = [], sheets = new Set<number>()
  let pending = new Map<string, number>(), intercepted = new Map<string, Set<string>>()
  let record = (entry: Omit<Entry, 'at'>) => {
    events.push({ at: Date.now(), ...entry })
    if (events.length > 100) events.shift()
  }
  let releaseWindow = (windowId: number) => {
    for (let [paneId, owner] of pending) if (owner === windowId) pending.delete(paneId)
    settled()
  }
  return {
    watchWindow: (window: BaseWindow) => {
      let windowId = window.id
      window.on('sheet-begin', () => { sheets.add(windowId); record({ event: 'sheet-begin', windowId, visible: window.isVisible() }) })
      window.on('sheet-end', () => { sheets.delete(windowId); record({ event: 'sheet-end', windowId, visible: !window.isDestroyed() && window.isVisible() }); releaseWindow(windowId) })
      window.once('closed', () => { sheets.delete(windowId); releaseWindow(windowId) })
    },
    watchPage: (paneId: string, contents: WebContents, owner: () => Owner) => {
      // Page.enable opts into notifications without intercepting native pickers.
      // Retain only browser identities and state, never paths or page contents.
      let debuggerApi = contents.debugger
      let message = (_event: Electron.Event, method: string, _params: unknown, sessionId = '') => {
        if (method !== 'Page.fileChooserOpened') return
        let current = owner()
        record({ event: 'request', paneId, ...current })
        // Electron resolves the native owner asynchronously. Keep it out of a
        // hidden parking window while the native chooser is opening or open.
        if (current.visible && current.windowId !== undefined && !intercepted.get(paneId)?.has(sessionId)) pending.set(paneId, current.windowId)
      }
      let detached = () => { intercepted.delete(paneId); record({ event: 'debugger-detached', paneId }) }
      let navigated = () => { pending.delete(paneId); settled() }
      debuggerApi.on('message', message)
      debuggerApi.on('detach', detached)
      contents.on('did-navigate', navigated)
      contents.once('destroyed', () => {
        pending.delete(paneId)
        intercepted.delete(paneId)
        debuggerApi.off('message', message)
        debuggerApi.off('detach', detached)
        contents.off('did-navigate', navigated)
      })
    },
    interception: (paneId: string, params: Record<string, unknown>, sessionId?: string) => {
      let sessions = intercepted.get(paneId) ?? new Set<string>()
      if (params.enabled === true) sessions.add(sessionId ?? '')
      else sessions.delete(sessionId ?? '')
      if (sessions.size) intercepted.set(paneId, sessions)
      else intercepted.delete(paneId)
      record({ event: 'cdp-interception', paneId, enabled: params.enabled === true, cancel: params.cancel === true, ...(sessionId ? { sessionId } : {}) })
    },
    keepsOwner: (paneId: string, windowId: number) => pending.get(paneId) === windowId,
    snapshot: () => ({ events: events.map(event => ({ ...event })), sheets: [...sheets] }),
  }
}
