import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('remoteBridge', {
  receive: (listener: (message: unknown) => void) => { ipcRenderer.on('remote-message', (_event, message) => listener(message)) },
  send: (message: unknown) => ipcRenderer.send('remote-message', message),
})
