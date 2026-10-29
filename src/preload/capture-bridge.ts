import { contextBridge, ipcRenderer } from 'electron'
export let installCaptureBridge = () => contextBridge.exposeInMainWorld('bmuxCapture', {
  settings: () => ipcRenderer.invoke('capture-settings'),
  chunk: (bytes: ArrayBuffer) => ipcRenderer.invoke('capture-chunk', bytes),
  event: (value: unknown) => ipcRenderer.send('capture-event', value),
  receive: (listener: (message: { type: string; data?: string }) => void) => { ipcRenderer.on('capture-message', (_event, value) => listener(value)) },
})
