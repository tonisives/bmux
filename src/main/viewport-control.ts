import { randomUUID } from 'node:crypto'
import { WebContentsView } from 'electron'
import type { Rectangle, View } from 'electron'
import { createViewportPan } from './viewport-pan'
import { observeViewportSettings } from './viewport-settings'
import type { ViewportSettings } from './viewport-settings'

// A stationary native sibling keeps the control independent of page movement.
export let createViewportControl = (pane: string, mode: (enabled: boolean) => void, zoom: (delta: number) => void, tooltip: (visible: boolean) => void, settings: () => ViewportSettings, apply: (settings: ViewportSettings) => void) => {
  let view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  view.setBackgroundColor('#00000000')
  let toggled = false, open = false
  let previousSettings = ''
  let marker = `bmux-viewport-settings:${randomUUID()}`
  let anchor: Rectangle | undefined
  let mount = () => {
    if (!anchor) return
    let width = open ? 288 : 72, height = open ? 320 : 32
    view.setBounds({ x: anchor.x + anchor.width - width, y: anchor.y, width, height })
  }
  let parent: View | undefined
  let control = createViewportPan(view.webContents, () => ({ x: 0, y: 0, width: open ? 288 : 72, height: open ? 320 : 32, toggled, standalone: true }), async expression => {
    await view.webContents.executeJavaScript(expression)
    await view.webContents.executeJavaScript(`(${observeViewportSettings.toString()})(${JSON.stringify(marker)}, ${JSON.stringify(settings())}, ${open})`)
  }, () => {}, mode, zoom, tooltip)
  view.webContents.on('console-message', details => {
    if (!details.message.startsWith(marker)) return
    try {
      let value = JSON.parse(details.message.slice(marker.length))
      if (typeof value.open === 'boolean') open = value.open
      else {
        if (!Number.isSafeInteger(value.width) || value.width < 1 || value.width > 16384 || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 16384 || !Number.isFinite(value.zoom) || value.zoom < .25 || value.zoom > 3) return
        open = false; apply(value)
      }
      tooltip(false); mount(); void control.refresh(true)
    } catch { /* Ignore malformed control messages. */ }
  })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', event => event.preventDefault())
  void view.webContents.loadURL(`about:blank#bmux-viewport-control-${encodeURIComponent(pane)}`).then(() => control.refresh()).catch(() => undefined)
  return {
    view,
    refresh: (enabled: boolean) => {
      toggled = enabled
      let next = JSON.stringify(settings()), force = previousSettings !== next
      previousSettings = next; void control.refresh(force)
    },
    mount: (target: View, bounds: Rectangle) => {
      if (parent !== target) { parent?.removeChildView(view); target.addChildView(view); parent = target }
      anchor = bounds; mount(); view.setVisible(true)
    },
    dispose: () => { tooltip(false); parent?.removeChildView(view); view.webContents.close() },
  }
}
