import type { DevicePersona } from './types'

// Screen and camera measurements in the existing 1024 × 1536 frame assets.
let frames = {
  ios: { x: 180, y: 32, width: 664, height: 1464, radius: 108, camera: { x: 407, y: 56, width: 210, height: 60 } },
  pixel: { x: 202, y: 42, width: 620, height: 1438, radius: 76, camera: { x: 494, y: 70, width: 36, height: 36 } },
  galaxy: { x: 184, y: 48, width: 654, height: 1440, radius: 68, camera: { x: 494, y: 64, width: 34, height: 34 } },
}
export let deviceFrameScreen = (device: DevicePersona) => device.platform === 'ios' ? frames.ios : device.preset === 'galaxy-s24' ? frames.galaxy : frames.pixel

export let deviceScreenShape = (device: DevicePersona, size: { width: number; height: number }) => {
  let screen = deviceFrameScreen(device), portrait = device.orientation === 'portrait'
  let sx = (portrait ? size.width : size.height) / screen.width
  let sy = (portrait ? size.height : size.width) / screen.height
  let camera = { x: (screen.camera.x - screen.x) * sx, y: (screen.camera.y - screen.y) * sy, width: screen.camera.width * sx, height: screen.camera.height * sy }
  if (!portrait) camera = { x: size.width - camera.y - camera.height, y: camera.x, width: camera.height, height: camera.width }
  return { radius: screen.radius * Math.min(sx, sy), camera }
}
