import { BrowserWindow, screen } from 'electron'
import type { BaseWindow, WebContents } from 'electron'

export let createTranslationPopups = () => {
  let windows = new Map<BaseWindow, BrowserWindow>()
  let open = (parent: BaseWindow, source: WebContents, text: string) => {
    if (parent.isDestroyed() || source.isDestroyed()) return
    windows.get(parent)?.destroy()
    let bounds = parent.getContentBounds()
    let area = screen.getDisplayMatching(bounds).workArea
    let width = Math.min(680, area.width), height = Math.min(520, area.height)
    let popup = new BrowserWindow({
      parent, show: false, title: 'Translate', width, height,
      x: Math.max(area.x, Math.min(area.x + area.width - width, Math.round(bounds.x + (bounds.width - width) / 2))),
      y: Math.max(area.y, Math.min(area.y + area.height - height, Math.round(bounds.y + (bounds.height - height) / 2))),
      minimizable: false, maximizable: false, fullscreenable: false,
      webPreferences: { session: source.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    windows.set(parent, popup)
    popup.setMenu(null)
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    popup.webContents.on('page-title-updated', event => event.preventDefault())
    popup.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return
      event.preventDefault(); popup.close()
    })
    let close = () => { if (!popup.isDestroyed()) popup.destroy() }
    source.once('destroyed', close)
    parent.once('closed', close)
    popup.once('closed', () => {
      source.off('destroyed', close)
      parent.off('closed', close)
      if (windows.get(parent) === popup) windows.delete(parent)
    })
    popup.once('ready-to-show', () => { if (!popup.isDestroyed()) popup.show() })
    void popup.loadURL(`https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(text)}&op=translate`).catch(() => {
      if (!popup.isDestroyed()) popup.show()
    })
  }
  let close = () => { for (let popup of windows.values()) popup.destroy(); windows.clear() }
  return { open, close }
}
