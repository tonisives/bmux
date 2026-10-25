import type { Viewport } from './types'

export type Frame = { width: number; height: number }
export type Transform = { zoom: number; x: number; y: number }
type Point = { x: number; y: number }
export let identityTransform: Transform = { zoom: 1, x: 0, y: 0 }
export let pinchTransform = (frame: Frame, initial: Transform, start: Point, end: Point, ratio: number): Transform => {
  let zoom = Math.max(1, Math.min(5, initial.zoom * ratio)), change = zoom / initial.zoom
  return {
    zoom,
    x: end.x - frame.width / 2 - (start.x - frame.width / 2 - initial.x) * change,
    y: end.y - frame.height / 2 - (start.y - frame.height / 2 - initial.y) * change,
  }
}
export let contentRect = (frame: Frame, viewport: Frame) => {
  let scale = Math.min(frame.width / viewport.width, frame.height / viewport.height)
  let width = viewport.width * scale, height = viewport.height * scale
  return { width, height, x: (frame.width - width) / 2, y: (frame.height - height) / 2, scale }
}
export let pagePoint = (point: Point, frame: Frame, viewport: Viewport, transform: Transform) => {
  if (frame.width <= 0 || frame.height <= 0 || viewport.width <= 0 || viewport.height <= 0 || transform.zoom <= 0) return
  let rect = contentRect(frame, viewport)
  let x = (point.x - frame.width / 2 - transform.x) / transform.zoom + frame.width / 2
  let y = (point.y - frame.height / 2 - transform.y) / transform.zoom + frame.height / 2
  if (x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) return
  return { x: Math.floor((x - rect.x) / rect.scale), y: Math.floor((y - rect.y) / rect.scale) }
}
export let fitViewport = (frame: Frame) => ({ width: Math.max(320, Math.min(1920, Math.round(frame.width))), height: Math.max(200, Math.min(1080, Math.round(frame.height))) })
