import { contextBridge, ipcRenderer } from 'electron'
import type { Host } from '../../remote/web/client'

contextBridge.exposeInMainWorld('remoteClient', {
  close: (): Promise<void> => ipcRenderer.invoke('remote-client-close'),
  selection: (): Promise<{ origin: string; host: Host; session: string }> => ipcRenderer.invoke('remote-client-selection'),
  connect: (publicKey: JsonWebKey): Promise<{ ticket: string; iceServers: RTCIceServer[] }> => ipcRenderer.invoke('remote-client-connect', publicKey),
})
