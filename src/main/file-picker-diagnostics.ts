import type { BaseWindow, WebContents } from 'electron'

type Owner = { windowId?: number; visible: boolean }
type Entry = { at: number; event: string; paneId?: string; windowId?: number; visible?: boolean; enabled?: boolean; cancel?: boolean; sessionId?: string }

export let createFilePickerDiagnostics = () => {
  let events: Entry[] = [], sheets = new Set<number>()
  let record = (entry: Omit<Entry, 'at'>) => {
    events.push({ at: Date.now(), ...entry })
    if (events.length > 100) events.shift()
  }
  return {
    watchWindow: (window: BaseWindow) => {
      let windowId = window.id
      window.on('sheet-begin', () => { sheets.add(windowId); record({ event: 'sheet-begin', windowId, visible: window.isVisible() }) })
      window.on('sheet-end', () => { sheets.delete(windowId); record({ event: 'sheet-end', windowId, visible: !window.isDestroyed() && window.isVisible() }) })
      window.once('closed', () => { sheets.delete(windowId) })
    },
    watchPage: (paneId: string, contents: WebContents, owner: () => Owner) => {
      // Page.enable opts into notifications without intercepting native pickers.
      // Retain only browser identities and state, never paths or page contents.
      let debuggerApi = contents.debugger
      let message = (_event: Electron.Event, method: string) => {
        if (method === 'Page.fileChooserOpened') record({ event: 'request', paneId, ...owner() })
      }
      let detached = () => record({ event: 'debugger-detached', paneId })
      debuggerApi.on('message', message)
      debuggerApi.on('detach', detached)
      contents.once('destroyed', () => {
        debuggerApi.off('message', message)
        debuggerApi.off('detach', detached)
      })
    },
    interception: (paneId: string, params: Record<string, unknown>, sessionId?: string) => record({ event: 'cdp-interception', paneId, enabled: params.enabled === true, cancel: params.cancel === true, ...(sessionId ? { sessionId } : {}) }),
    snapshot: () => ({ events: events.map(event => ({ ...event })), sheets: [...sheets] }),
  }
}
