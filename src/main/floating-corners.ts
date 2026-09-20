import { ImageView, nativeImage } from 'electron'
import type { Rectangle } from 'electron'
import { FLOAT_CONTENT_RADIUS } from '../shared/floating'

// These native siblings paint above the page's compositor surface. Rounding
// the frame behind that surface cannot cover the page's square corner pixels.
export let createFloatingCorners = () => [0, 1, 2, 3].map(corner => {
  let image = nativeImage.createEmpty()
  for (let scaleFactor of [1, 2, 3]) {
    let size = FLOAT_CONTENT_RADIUS * scaleFactor
    let pixels = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let dx = corner % 2 ? x + .5 : size - x - .5
      let dy = corner >= 2 ? y + .5 : size - y - .5
      let coverage = Math.max(0, Math.min(1, Math.hypot(dx, dy) - size + .5))
      let offset = (y * size + x) * 4
      // Native bitmaps use premultiplied BGRA; match the frame's content well.
      pixels[offset] = Math.round(0x18 * coverage)
      pixels[offset + 1] = Math.round(0x13 * coverage)
      pixels[offset + 2] = Math.round(0x11 * coverage)
      pixels[offset + 3] = Math.round(255 * coverage)
    }
    let bitmap = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor })
    image.addRepresentation({ scaleFactor, buffer: bitmap.toPNG() })
  }
  let view = new ImageView()
  // Give the image its own compositor layer above native web content.
  view.setBackgroundBlur(0)
  view.setImage(image)
  return view
})

export let positionFloatingCorners = (corners: ImageView[], bounds: Rectangle) => {
  let size = FLOAT_CONTENT_RADIUS
  corners.forEach((view, corner) => view.setBounds({
    x: bounds.x + (corner % 2 ? bounds.width - size : 0),
    y: bounds.y + (corner >= 2 ? bounds.height - size : 0),
    width: size, height: size,
  }))
}
