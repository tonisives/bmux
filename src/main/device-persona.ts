import type { DevicePersona } from '../shared/types'
import { deviceUserAgent as userAgent, deviceUserAgentMetadata as userAgentMetadata } from '../shared/device-persona'

export { DEVICE_PRESETS, parseDevicePersona, deviceViewport, deviceLabel, fittedDeviceBounds } from '../shared/device-persona'
export let deviceUserAgent = (persona: DevicePersona, chromeVersion = process.versions.chrome ?? '0.0.0.0') => userAgent(persona, chromeVersion)
export let deviceUserAgentMetadata = (persona: DevicePersona, chromeVersion = process.versions.chrome ?? '0.0.0.0') => userAgentMetadata(persona, chromeVersion)
