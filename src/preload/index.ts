import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge, PublicState } from '../shared/types'

let bridge: Bridge = {
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
ipcRenderer.on('focus-control', (_event, control: string) => {
  let selector = control === 'session' ? '[data-session-switcher]' : `[data-focused-pane="true"] [data-${control}]`
  let input = document.querySelector<HTMLInputElement>(selector)
  input?.focus()
  if (input instanceof HTMLInputElement) input.select()
})
