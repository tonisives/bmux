import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge, PublicState } from '../shared/types'

let bridge: Bridge = {
  clipboard: text => ipcRenderer.invoke('clipboard', text),
  controls: listener => {
    let handler = (_event: Electron.IpcRendererEvent, control: string, paneId?: string) => listener(control, paneId)
    ipcRenderer.on('focus-control', handler)
    return () => ipcRenderer.removeListener('focus-control', handler)
  },
  linkPreview: listener => {
    let handler = (_event: Electron.IpcRendererEvent, url: string) => listener(url)
    ipcRenderer.on('link-preview', handler)
    return () => ipcRenderer.removeListener('link-preview', handler)
  },
  state: () => ipcRenderer.invoke('state'),
  command: command => ipcRenderer.invoke('command', command),
  remoteSessions: () => ipcRenderer.invoke('remote-sessions'),
  remoteSessionPreviews: (host: string, session: string, request?: 'cache' | 'missing' | 'refresh') => ipcRenderer.invoke('remote-session-previews', host, session, request),
  closeRemoteSession: (host: string, session: string) => ipcRenderer.invoke('remote-close-session', host, session),
  openRemote: (host, session, pane) => ipcRenderer.invoke('remote-open', host, session, pane),
  remoteAccount: (path, body) => ipcRenderer.invoke('remote-account', path, body),
  openRemoteBilling: url => ipcRenderer.invoke('remote-billing-open', url),
  bounds: bounds => ipcRenderer.send('bounds', bounds),
  subscribe: listener => {
    let handler = (_event: Electron.IpcRendererEvent, state: PublicState) => listener(state)
    ipcRenderer.on('state', handler)
    return () => ipcRenderer.removeListener('state', handler)
  },
}
contextBridge.exposeInMainWorld('bmux', bridge)
