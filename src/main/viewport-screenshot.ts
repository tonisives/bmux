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
  let size = frame.getSize(), scale = typeof maximum === 'number' ? Math.min(1, maximum / Math.max(size.width, size.height)) : 1
  if (scale < 1) frame = frame.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' })
  return { data: format === 'jpeg' ? frame.toJPEG(quality) : frame.toPNG(), format }
}
