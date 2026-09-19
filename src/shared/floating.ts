import type { FloatingPane } from './types'

export let FLOAT_BORDER = 3
export let FLOAT_HEADER = 61
export let FLOAT_RADIUS = 10
export let clampFloat = (rect: FloatingPane, width: number, height: number): FloatingPane => {
  width = Math.max(1, width); height = Math.max(1, height)
  let w = Math.round(Math.min(width, Math.max(Math.min(320, width), rect.width)))
  let h = Math.round(Math.min(height, Math.max(Math.min(200, height), rect.height)))
  return { ...rect, width: w, height: h, x: Math.round(Math.max(0, Math.min(width - w, rect.x))), y: Math.round(Math.max(0, Math.min(height - h, rect.y))) }
}
