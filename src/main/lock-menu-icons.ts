import { nativeImage } from 'electron'

// Retina menu glyphs matching the tab's padlock and fixed-viewport outlines.
let images = {
  window: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA3UlEQVR4nO2WwQ3DIAxFMwIjMAIjMAIjZIRMEq4doHtkhI6QETJC64NRLVKEEW6cA4d3IV/mYRBkWh/PSRPVyXsFLOARe6XADOzAO2PHb38TMMD2Y+KcDbPiAnTyA4hAQCKOUQlRgZkUfxVWaPBbyrG2gyuQ9vyotNeQTuxSApasKjLykeSthIAnBQMjH0jeSwtUC7bmbyvg1u8tt5CCCxkvUco7roAjBaQ5SdRaKM1pS2oCnJa3bEmzAOfQdR3KITAEhsAQuL2A+lWs8hipP8dJorf1OewfkktRF/gAJwcPdc6+9KcAAAAASUVORK5CYII=',
  viewport: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAwElEQVR4nO2XyRGAIAxFKYkSUhKVeLYA+1QvzIAMyQ/LxEMO/+BgwjMbGI7zCpYqH+IrEhQBpyo/pdENioNQ+8mGZABAPYC0MQUJASBgk1E1+zgACoC0FlIvQwCaypY6ZgiAJgA4XxVA+ZUcNdeiWU2rdaJZDaK8COVNEFJPzSiecTj1vgM4wK8ATNvQfBBx1OXatlHMAZgfRhlCCv1Xy47jlXIACMD8Wq6t7O/mqhYdMdzyayaFblUKGj+7ig3WAzMRVAmpfDvMAAAAAElFTkSuQmCC',
}
let cache = new Map<keyof typeof images, Electron.NativeImage>()
export let lockMenuIcon = (kind: keyof typeof images) => {
  let image = cache.get(kind)
  if (!image) {
    image = nativeImage.createFromBuffer(Buffer.from(images[kind], 'base64'), { scaleFactor: 2 })
    if (process.platform === 'darwin') image.setTemplateImage(true)
    cache.set(kind, image)
  }
  return image
}
