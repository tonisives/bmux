import type { RemoteViewAction, RemoteViewUpdate } from '../shared/remote'
import { contextBridge, ipcRenderer } from 'electron'
import type { Host } from '../../remote/web/client'

contextBridge.exposeInMainWorld('remoteClient', {
  update: (state: RemoteViewUpdate): Promise<void> => ipcRenderer.invoke('remote-client-update', state),
  actions: (listener: (action: RemoteViewAction) => void) => {
    let handler = (_event: Electron.IpcRendererEvent, action: RemoteViewAction) => listener(action)
    ipcRenderer.on('remote-client-action', handler)
    return () => ipcRenderer.removeListener('remote-client-action', handler)
  },
  close: (): Promise<void> => ipcRenderer.invoke('remote-client-close'),
  selection: (): Promise<{ origin: string; host: Host; session: string }> => ipcRenderer.invoke('remote-client-selection'),
  connect: (publicKey: JsonWebKey): Promise<{ ticket: string; iceServers: RTCIceServer[] }> => ipcRenderer.invoke('remote-client-connect', publicKey),
})
