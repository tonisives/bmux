import type { PluginOverlayState } from '../shared/plugin-overlay'

export let createPluginOverlayDelivery = <Target extends object>(send: (target: Target, overlay: PluginOverlayState | undefined) => void) => {
  let previous = new WeakMap<Target, string | undefined>()
  return (target: Target, overlay: PluginOverlayState | undefined) => {
    let serialized = JSON.stringify(overlay)
    if (previous.has(target) && previous.get(target) === serialized) return
    previous.set(target, serialized)
    send(target, overlay)
  }
}

type Rectangle = { x: number; y: number; width: number; height: number }
type OverlayView = { getBounds: () => Rectangle; setBounds: (bounds: Rectangle) => void; webContents: { getZoomFactor: () => number; setZoomFactor: (zoom: number) => void } }

export let setPluginOverlayGeometry = (view: OverlayView, bounds: Rectangle, zoom: number) => {
  if (view.webContents.getZoomFactor() !== zoom) view.webContents.setZoomFactor(zoom)
  let previous = view.getBounds()
  if (previous.x !== bounds.x || previous.y !== bounds.y || previous.width !== bounds.width || previous.height !== bounds.height) view.setBounds(bounds)
}
