import type { RemoteViewAction, RemoteViewUpdate } from '../shared/remote'
import { contextBridge, ipcRenderer } from 'electron'
import type { Host } from '../../remote/web/client'

contextBridge.exposeInMainWorld('remoteClient', {
  preview: (pane: string, image: string): Promise<void> => ipcRenderer.invoke('remote-client-preview', pane, image),
  update: (state: RemoteViewUpdate): Promise<void> => ipcRenderer.invoke('remote-client-update', state),
  actions: (listener: (action: RemoteViewAction) => void) => {
    let handler = (_event: Electron.IpcRendererEvent, action: RemoteViewAction) => listener(action)
    ipcRenderer.on('remote-client-action', handler)
    return () => ipcRenderer.removeListener('remote-client-action', handler)
  },
  close: (): Promise<void> => ipcRenderer.invoke('remote-client-close'),
  selection: (): Promise<{ origin: string; host: Host; session: string; pane?: string; metadata: boolean; view: string; publicKey: JsonWebKey }> => ipcRenderer.invoke('remote-client-selection'),
  connect: (publicKey: JsonWebKey): Promise<{ ticket: string; iceServers: RTCIceServer[] }> => ipcRenderer.invoke('remote-client-connect', publicKey),
  seal: (_host: unknown, payload: Record<string, unknown>) => ipcRenderer.invoke('remote-client-seal', payload),
  socketOpen: (): Promise<string[]> => ipcRenderer.invoke('remote-client-socket-open'),
  socketSend: (data: string): Promise<void> => ipcRenderer.invoke('remote-client-socket-send', data),
  socketClose: (): Promise<void> => ipcRenderer.invoke('remote-client-socket-close'),
  socketEvents: (listener: (event: { type: 'message'; data: string } | { type: 'close' }) => void) => {
    let handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value)
    ipcRenderer.on('remote-client-socket', handler)
    return () => ipcRenderer.removeListener('remote-client-socket', handler)
  },
})
