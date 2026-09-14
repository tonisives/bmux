import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge, PublicState } from '../shared/types'

let bridge: Bridge = {
  controls: listener => {
    let handler = (_event: Electron.IpcRendererEvent, control: string) => listener(control)
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
  bounds: bounds => ipcRenderer.send('bounds', bounds),
  subscribe: listener => {
    let handler = (_event: Electron.IpcRendererEvent, state: PublicState) => listener(state)
    ipcRenderer.on('state', handler)
    return () => ipcRenderer.removeListener('state', handler)
  },
}
contextBridge.exposeInMainWorld('bmux', bridge)
