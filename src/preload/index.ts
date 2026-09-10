import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge, PublicState } from '../shared/types'

let bridge: Bridge = {
  controls: listener => {
    let handler = (_event: Electron.IpcRendererEvent, control: string) => listener(control)
    ipcRenderer.on('focus-control', handler)
    return () => ipcRenderer.removeListener('focus-control', handler)
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
contextBridge.exposeInMainWorld('browmux', bridge)
