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
