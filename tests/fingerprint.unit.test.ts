import { describe, expect, it } from 'vitest'
import { parseFingerprint, sameFingerprintProxy } from '../src/shared/fingerprint'
import { initialModel, validateModel } from '../src/main/model'

let profile = { version: 1, id: 'fingerprint_example', name: 'Mobile US', proxy: { protocol: 'https', host: 'proxy.example', port: 443, authenticated: true }, device: { preset: 'pixel-8', orientation: 'portrait', locale: 'en-US', timezone: 'America/Los_Angeles' }, viewport: { width: 412, height: 915 } }

describe('portable fingerprint profiles', () => {
  it('exports only configuration and survives model persistence', () => {
    let value = parseFingerprint({ ...profile, username: 'private-user', password: 'private-password', cookies: ['private-cookie'], proxy: { ...profile.proxy, password: 'private-password' } })
    expect(JSON.stringify(value)).not.toContain('private-')
    expect(value.device).toMatchObject({ platform: 'android', width: 412, deviceScaleFactor: 2.625 })
    let model = initialModel()
    model.fingerprints = [value]
    expect(validateModel(JSON.parse(JSON.stringify(model))).fingerprints).toEqual([value])
    expect(value.viewport).toEqual({ width: 412, height: 915 })
  })

  it.each([null, { ...profile, version: 2 }, { ...profile, id: '../profile' }, { ...profile, name: '' }, { ...profile, viewport: { width: -1, height: 800 } }, { ...profile, viewport: { width: 1280, height: 0.5 } }, { ...profile, proxy: { ...profile.proxy, host: 'user:password@proxy.example' } }, { ...profile, device: { ...profile.device, timezone: 'Missing/Timezone' } }])('rejects malformed shared configuration %j', input => {
    expect(() => parseFingerprint(input)).toThrow()
  })

  it('compares endpoints independently of property order and hostname case', () => {
    expect(sameFingerprintProxy({ protocol: 'https', host: 'PROXY.example', port: 443, authenticated: true }, { authenticated: true, host: 'proxy.example', port: 443, protocol: 'https' })).toBe(true)
    expect(sameFingerprintProxy(undefined, undefined)).toBe(true)
    expect(sameFingerprintProxy(undefined, { protocol: 'http', host: 'proxy.example', port: 80, authenticated: false })).toBe(false)
  })

  it('rejects duplicate and invalid stored profiles', () => {
    let model = initialModel(), value = parseFingerprint(profile)
    model.fingerprints = [value, value]
    expect(() => validateModel(model)).toThrow('Duplicate fingerprint profile')
  })
})
