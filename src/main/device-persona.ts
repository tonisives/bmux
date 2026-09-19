import type { DevicePersona, DevicePlatform, DevicePreset } from '../shared/types'

export const DEVICE_PRESETS: Record<Exclude<DevicePreset, 'custom'>, Pick<DevicePersona, 'platform' | 'width' | 'height' | 'deviceScaleFactor'>> = {
  'pixel-8': { platform: 'android', width: 412, height: 915, deviceScaleFactor: 2.625 },
  'galaxy-s24': { platform: 'android', width: 360, height: 780, deviceScaleFactor: 3 },
  'iphone-15-pro': { platform: 'ios', width: 393, height: 852, deviceScaleFactor: 3 },
  'iphone-15-pro-max': { platform: 'ios', width: 430, height: 932, deviceScaleFactor: 3 },
}

const finiteRange = (value: unknown, name: string, minimum: number, maximum: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  return value
}

export let parseDevicePersona = (value: unknown): DevicePersona => {
  let candidate = value as Partial<DevicePersona>
  if (!candidate || typeof candidate !== 'object') throw new Error('Invalid device persona')
  let presets = [...Object.keys(DEVICE_PRESETS), 'custom']
  if (!presets.includes(String(candidate.preset))) throw new Error('Choose a supported device preset')
  let preset = candidate.preset as DevicePreset
  let dimensions = preset === 'custom' ? undefined : DEVICE_PRESETS[preset]
  let platform = dimensions?.platform ?? candidate.platform
  if (!['android', 'ios'].includes(String(platform))) throw new Error('Device platform must be Android or iOS')
  if (!['portrait', 'landscape'].includes(String(candidate.orientation))) throw new Error('Choose portrait or landscape orientation')
  if (typeof candidate.locale !== 'string' || !candidate.locale.trim()) throw new Error('Locale is required')
  let locale: string
  try { locale = Intl.getCanonicalLocales(candidate.locale.trim())[0] }
  catch { throw new Error('Enter a valid locale') }
  if (!locale) throw new Error('Enter a valid locale')
  if (typeof candidate.timezone !== 'string' || !candidate.timezone.trim()) throw new Error('Timezone is required')
  let timezone: string
  try { timezone = new Intl.DateTimeFormat('en-US', { timeZone: candidate.timezone.trim() }).resolvedOptions().timeZone }
  catch { throw new Error('Enter a valid IANA timezone') }
  let geolocation: DevicePersona['geolocation']
  if (candidate.geolocation !== undefined) {
    let location = candidate.geolocation
    if (!location || typeof location !== 'object') throw new Error('Invalid geolocation')
    geolocation = {
      latitude: finiteRange(location.latitude, 'Latitude', -90, 90),
      longitude: finiteRange(location.longitude, 'Longitude', -180, 180),
      accuracy: finiteRange(location.accuracy, 'Accuracy', 0, 100000),
    }
  }
  return {
    preset,
    platform: platform as DevicePlatform,
    width: dimensions?.width ?? finiteRange(candidate.width, 'Width', 240, 1440),
    height: dimensions?.height ?? finiteRange(candidate.height, 'Height', 320, 2560),
    deviceScaleFactor: dimensions?.deviceScaleFactor ?? finiteRange(candidate.deviceScaleFactor, 'DPR', 1, 4),
    orientation: candidate.orientation as DevicePersona['orientation'],
    locale,
    timezone,
    ...(geolocation ? { geolocation } : {}),
  }
}

export let deviceViewport = (persona: DevicePersona) => persona.orientation === 'portrait'
  ? { width: persona.width, height: persona.height, angle: 0, type: 'portraitPrimary' }
  : { width: persona.height, height: persona.width, angle: 90, type: 'landscapePrimary' }

export let deviceLabel = (persona?: DevicePersona) => !persona ? 'desktop' : ({
  'pixel-8': 'Pixel 8',
  'galaxy-s24': 'Galaxy S24',
  'iphone-15-pro': 'iPhone 15 Pro',
  'iphone-15-pro-max': 'iPhone 15 Pro Max',
  custom: persona.platform === 'android' ? 'Android' : 'iOS',
}[persona.preset])

export let deviceUserAgent = (persona: DevicePersona, chromeVersion = process.versions.chrome ?? '0.0.0.0') => {
  if (persona.platform === 'ios') return 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
  let major = chromeVersion.split('.')[0]
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`
}

export let deviceUserAgentMetadata = (persona: DevicePersona, chromeVersion = process.versions.chrome ?? '0.0.0.0') => {
  if (persona.platform === 'ios') return undefined
  let major = chromeVersion.split('.')[0]
  let brands = [{ brand: 'Not_A Brand', version: '99' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }]
  return { brands, fullVersionList: brands.map(brand => ({ ...brand, version: brand.brand === 'Not_A Brand' ? '99.0.0.0' : chromeVersion })), fullVersion: chromeVersion, platform: 'Android', platformVersion: '10.0.0', architecture: '', model: '', mobile: true, bitness: '', wow64: false }
}

export let fittedDeviceBounds = (container: { x: number; y: number; width: number; height: number }, persona: DevicePersona) => {
  let viewport = deviceViewport(persona)
  let scale = Math.min(1, container.width / viewport.width, container.height / viewport.height)
  let width = Math.max(1, Math.floor(viewport.width * scale)), height = Math.max(1, Math.floor(viewport.height * scale))
  return { x: Math.round(container.x + (container.width - width) / 2), y: Math.round(container.y + (container.height - height) / 2), width, height, scale }
}
