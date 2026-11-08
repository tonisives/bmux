import type { WebContents } from 'electron'
import { capturePageFrame } from './frame-capture'

export let captureViewportScreenshot = async (contents: Pick<WebContents, 'capturePage' | 'isDestroyed' | 'isCrashed'>, options: Record<string, unknown> = {}) => {
  let format = options.format ?? 'png', quality = options.quality ?? 80, maximum = options.maxDimension
  if (format !== 'png' && format !== 'jpeg') throw new Error('Screenshot format must be png or jpeg')
  if (typeof quality !== 'number' || !Number.isInteger(quality) || quality < 0 || quality > 100) throw new Error('Screenshot quality must be an integer between 0 and 100')
  if (maximum !== undefined && (typeof maximum !== 'number' || !Number.isInteger(maximum) || maximum < 1 || maximum > 16384)) throw new Error('Screenshot maxDimension must be an integer between 1 and 16384')
  // Copy the current surface without CDP's temporary clipping/emulation resize.
  let frame = await capturePageFrame(contents)
  if (frame.isEmpty()) throw new Error('Unable to capture screenshot')
  if (options.clip !== undefined) {
    let rect = options.clip as { x: number; y: number; width: number; height: number }, viewport = options.viewport as number[]
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || !Array.isArray(viewport) || viewport.length !== 2 || !viewport.every(value => Number.isFinite(value) && value > 0)) throw new Error('Screenshot clip requires a rectangle and CSS viewport dimensions')
    let size = frame.getSize(), left = Math.max(0, rect.x), top = Math.max(0, rect.y)
    let right = Math.min(viewport[0], rect.x + rect.width), bottom = Math.min(viewport[1], rect.y + rect.height)
    if (right <= left || bottom <= top) throw new Error('Screenshot clip is outside the viewport')
    let x = Math.round(left * size.width / viewport[0]), y = Math.round(top * size.height / viewport[1])
    let width = Math.round(right * size.width / viewport[0]) - x, height = Math.round(bottom * size.height / viewport[1]) - y
    if (width < 1 || height < 1) throw new Error('Screenshot clip is empty')
    frame = frame.crop({ x, y, width, height })
  }
  let size = frame.getSize(), scale = typeof maximum === 'number' ? Math.min(1, maximum / Math.max(size.width, size.height)) : 1
  if (scale < 1) frame = frame.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' })
  return { data: format === 'jpeg' ? frame.toJPEG(quality) : frame.toPNG(), format, postOnly: options.clip !== undefined, clip: options.clip, viewport: options.viewport, ...frame.getSize() }
}
