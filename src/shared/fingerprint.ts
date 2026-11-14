import { parseDevicePersona } from './device-persona'
import type { DevicePersona, ProfileProxy, ViewportSize } from './types'

export type FingerprintProfile = { version: 1; id: string; name: string; proxy?: ProfileProxy; device?: DevicePersona; viewport?: ViewportSize }

export let parseFingerprint = (input: unknown): FingerprintProfile => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid fingerprint profile')
  let value = input as FingerprintProfile
  if (value.version !== 1 || typeof value.id !== 'string' || !/^fingerprint_[a-zA-Z0-9_-]+$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || /[\x00-\x1f\x7f]/.test(value.name)) throw new Error('Invalid fingerprint profile')
  let proxy: ProfileProxy | undefined
  if (value.proxy !== undefined) {
    let item = value.proxy
    if (!item || !['http', 'https', 'socks5'].includes(item.protocol) || typeof item.host !== 'string' || !item.host || item.host.length > 253 || /[\s/@?#]/.test(item.host) || !Number.isInteger(item.port) || item.port < 1 || item.port > 65535 || typeof item.authenticated !== 'boolean' || item.route !== undefined && (typeof item.route !== 'string' || !/^[a-z0-9-]{1,80}$/.test(item.route))) throw new Error('Invalid fingerprint proxy')
    proxy = { protocol: item.protocol, host: item.host, port: item.port, authenticated: item.authenticated, ...(item.route ? { route: item.route } : {}) }
  }
  let viewport: ViewportSize | undefined
  if (value.viewport !== undefined) {
    let item = value.viewport
    if (!item || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 16384 || item.height > 16384) throw new Error('Invalid fingerprint viewport')
    viewport = { width: item.width, height: item.height }
  }
  return { version: 1, id: value.id, name: value.name.trim(), ...(proxy ? { proxy } : {}), ...(value.device ? { device: parseDevicePersona(value.device) } : {}), ...(viewport ? { viewport } : {}) }
}

export let sameFingerprintProxy = (first?: ProfileProxy, second?: ProfileProxy) => first?.protocol === second?.protocol && first?.host.toLowerCase() === second?.host.toLowerCase() && first?.port === second?.port && first?.authenticated === second?.authenticated && first?.route === second?.route
