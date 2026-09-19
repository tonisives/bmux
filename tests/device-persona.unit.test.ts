import { describe, expect, it } from 'vitest'
import { DEVICE_PRESETS, deviceUserAgent, deviceUserAgentMetadata, deviceViewport, fittedDeviceBounds, parseDevicePersona } from '../src/main/device-persona'

let persona = (overrides: Record<string, unknown> = {}) => parseDevicePersona({ preset: 'iphone-15-pro', orientation: 'portrait', locale: 'en-US', timezone: 'America/New_York', ...overrides })

describe('device personas', () => {
  it('keeps the preset catalog dimensions exact', () => {
    expect(DEVICE_PRESETS).toEqual({
      'pixel-8': { platform: 'android', width: 412, height: 915, deviceScaleFactor: 2.625 },
      'galaxy-s24': { platform: 'android', width: 360, height: 780, deviceScaleFactor: 3 },
      'iphone-15-pro': { platform: 'ios', width: 393, height: 852, deviceScaleFactor: 3 },
      'iphone-15-pro-max': { platform: 'ios', width: 430, height: 932, deviceScaleFactor: 3 },
    })
  })

  it('uses the maintained Safari 27 frozen iOS token', () => {
    expect(deviceUserAgent(persona())).toBe('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1')
    expect(deviceUserAgentMetadata(persona())).toBeUndefined()
  })

  it('canonicalizes identity fields and validates custom bounds', () => {
    let custom = parseDevicePersona({ preset: 'custom', platform: 'android', width: 240, height: 2560, deviceScaleFactor: 4, orientation: 'landscape', locale: 'en-us', timezone: 'US/Eastern', geolocation: { latitude: 1, longitude: 2, accuracy: 3 } })
    expect(custom.locale).toBe('en-US')
    expect(custom.timezone).toBe('America/New_York')
    expect(deviceViewport(custom)).toMatchObject({ width: 2560, height: 240, angle: 90 })
    expect(() => parseDevicePersona({ ...custom, width: 239 })).toThrow('Width')
  })

  it('centers a full screen without upscaling', () => {
    expect(fittedDeviceBounds({ x: 10, y: 20, width: 1000, height: 1000 }, persona())).toEqual({ x: 314, y: 94, width: 393, height: 852, scale: 1 })
    let fitted = fittedDeviceBounds({ x: 0, y: 0, width: 200, height: 300 }, persona())
    expect(fitted.scale).toBeLessThan(1)
    expect(fitted.width).toBeLessThanOrEqual(200)
    expect(fitted.height).toBeLessThanOrEqual(300)
  })
})
