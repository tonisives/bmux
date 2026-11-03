import { WebContentsView } from 'electron'
import type { Rectangle, View } from 'electron'
import { createViewportPan } from './viewport-pan'

// A stationary native sibling keeps the control independent of page movement.
export let createViewportControl = (pane: string, mode: (enabled: boolean) => void, zoom: (delta: number) => void, tooltip: (visible: boolean) => void) => {
  let view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  view.setBackgroundColor('#00000000')
  let toggled = false
  let parent: View | undefined
  let control = createViewportPan(view.webContents, () => ({ x: 0, y: 0, width: 32, height: 32, toggled, standalone: true }), expression => view.webContents.executeJavaScript(expression), () => {}, mode, zoom, tooltip)
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', event => event.preventDefault())
  void view.webContents.loadURL(`about:blank#bmux-viewport-control-${encodeURIComponent(pane)}`).then(() => control.refresh()).catch(() => undefined)
  return {
    view,
    refresh: (enabled: boolean) => { toggled = enabled; void control.refresh() },
    mount: (target: View, bounds: Rectangle) => {
      if (parent !== target) { parent?.removeChildView(view); target.addChildView(view); parent = target }
      view.setBounds(bounds); view.setVisible(true)
    },
    dispose: () => { tooltip(false); parent?.removeChildView(view); view.webContents.close() },
  }
}
