import { createRequire } from 'node:module'
import path from 'node:path'
import type { BaseWindow, Rectangle } from 'electron'

export type SwipeSurface = { window: BaseWindow; bounds: Rectangle; order?: number }
type Native = {
  show: (id: number, handle: Buffer, x: number, y: number, width: number, height: number, current: Buffer, previous: Buffer, offset: number) => void
  move: (id: number, offset: number, duration: number) => void
  hide: (id: number) => void
  windowNumber: (handle: Buffer) => number
  observe: (callback: (window: number, x: number, y: number, phase: number, momentum: number) => void) => void
}
let require = createRequire(import.meta.url), native: Native | undefined
type Listener = { surface: () => SwipeSurface | undefined; phase: (phase: 'begin' | 'end' | 'cancel' | 'momentum' | 'fallback') => void }
let listeners = new Set<Listener>()
let target: Listener | undefined
let bridge = () => {
  if (native) return native
  native = require(path.join(import.meta.dirname, '../native/swipe.node')) as Native
  native.observe((window, x, y, phase, momentum) => {
    // NSEventPhase: began=1, stationary=2, changed=4, ended=8,
    // cancelled=16, mayBegin=32. Hold through stationary phases indefinitely.
    if (!phase && !momentum) { target?.phase('fallback'); target = undefined; return }
    if (phase & 1) {
      let previous = target
      target = [...listeners].map(listener => ({ listener, surface: listener.surface() })).filter(({ surface }) => {
        if (!surface || surface.window.isDestroyed() || native!.windowNumber(surface.window.getNativeWindowHandle()) !== window) return false
        let bounds = surface.bounds
        return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
      }).sort((a, b) => (b.surface?.order ?? 0) - (a.surface?.order ?? 0))[0]?.listener
      if (previous !== target) previous?.phase('cancel')
      target?.phase('begin')
    }
    if (momentum) target?.phase('momentum')
    if (phase & 16) { target?.phase('cancel'); target = undefined }
    else if (phase & 8) target?.phase('end')
  })
  return native
}
export let createSwipeSurface = (id: number, surface: () => SwipeSurface | undefined, phase: (phase: 'begin' | 'end' | 'cancel' | 'momentum' | 'fallback') => void) => {
  let native = bridge(), listener = { surface, phase }
  listeners.add(listener)
  return {
    show: (current: Buffer, previous: Buffer | undefined, offset: number) => {
      let value = surface()
      if (!value || value.window.isDestroyed()) return
      let { x, y, width, height } = value.bounds
      native.show(id, value.window.getNativeWindowHandle(), x, y, width, height, current, previous ?? Buffer.alloc(0), offset)
    },
    move: (offset: number, duration = 0) => native.move(id, offset, duration),
    hide: () => native.hide(id),
    dispose: () => { native.hide(id); listeners.delete(listener); if (target === listener) target = undefined },
  }
}
