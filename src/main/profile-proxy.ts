import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Server } from 'proxy-chain'
import type { ProfileProxy, ProxyProtocol } from '../shared/types'

export type ProxyCredentials = { username: string; password: string }
type CredentialStoreOptions = { directory: string; available: () => boolean; encrypt: (text: string) => Buffer; decrypt: (data: Buffer) => string }
type Relay = { server: Server; username: string; password: string; host: string; port: number }

let mapping = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Proxy settings must be a mapping')
  return value as Record<string, unknown>
}

export let parseProfileProxy = (raw: unknown): ProfileProxy => {
  let value = mapping(raw)
  if (Object.keys(value).some(key => !['protocol', 'host', 'port', 'authenticated'].includes(key))) throw new Error('Unknown proxy setting')
  if (!['http', 'https', 'socks5'].includes(String(value.protocol))) throw new Error('Proxy protocol must be http, https, or socks5')
  if (typeof value.host !== 'string') throw new Error('Proxy host is required')
  let host = value.host.trim()
  if (!host || host.length > 253 || /[\s/@?#]/.test(host)) throw new Error('Invalid proxy host')
  if (!Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535) throw new Error('Proxy port must be between 1 and 65535')
  if (typeof value.authenticated !== 'boolean') throw new Error('Proxy authenticated flag is required')
  return { protocol: value.protocol as ProxyProtocol, host, port: Number(value.port), authenticated: value.authenticated }
}

let credentialFile = (directory: string, profileId: string) => {
  if (!/^profile_[a-zA-Z0-9_-]+$/.test(profileId)) throw new Error('Invalid profile ID')
  return path.join(directory, `${profileId}.bin`)
}

export let createProxyCredentialStore = (options: CredentialStoreOptions) => {
  let get = (profileId: string): ProxyCredentials | undefined => {
    let file = credentialFile(options.directory, profileId)
    if (!fs.existsSync(file)) return undefined
    if (!options.available()) throw new Error('Secure proxy credential storage is unavailable')
    let value: unknown
    try { value = JSON.parse(options.decrypt(fs.readFileSync(file))) } catch { throw new Error('Could not decrypt proxy credentials') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid proxy credentials')
    let credentials = value as Record<string, unknown>
    if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || !credentials.username || !credentials.password) throw new Error('Invalid proxy credentials')
    return { username: credentials.username, password: credentials.password }
  }
  let set = (profileId: string, credentials?: ProxyCredentials) => {
    let file = credentialFile(options.directory, profileId)
    if (!credentials) { try { fs.unlinkSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }; return }
    if (!credentials.username || !credentials.password) throw new Error('Proxy username and password are required')
    if (!options.available()) throw new Error('Secure proxy credential storage is unavailable')
    fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    let temporary = `${file}.tmp`, encrypted = options.encrypt(JSON.stringify(credentials))
    let descriptor = fs.openSync(temporary, 'w', 0o600)
    try { fs.writeFileSync(descriptor, encrypted); fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    fs.renameSync(temporary, file)
  }
  return { get, set, has: (profileId: string) => fs.existsSync(credentialFile(options.directory, profileId)) }
}

let proxyHost = (host: string) => host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
let upstreamUrl = (proxy: ProfileProxy, credentials?: ProxyCredentials) => {
  let authentication = credentials ? `${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@` : ''
  let protocol = proxy.protocol === 'socks5' ? 'socks5h' : proxy.protocol
  return `${protocol}://${authentication}${proxyHost(proxy.host)}:${proxy.port}`
}

export let createProfileProxyRelays = (credentials: ReturnType<typeof createProxyCredentialStore>) => {
  let relays = new Map<string, Relay>()
  let create = async (profileId: string, proxy: ProfileProxy, replacement?: ProxyCredentials) => {
    let upstreamCredentials = proxy.authenticated ? replacement ?? credentials.get(profileId) : undefined
    if (proxy.authenticated && !upstreamCredentials) throw new Error('Proxy credentials are required')
    let username = randomBytes(18).toString('hex'), password = randomBytes(24).toString('hex')
    let server = new Server({
      host: '127.0.0.1', port: 0, verbose: false, authRealm: 'bmux',
      prepareRequestFunction: request => request.username !== username || request.password !== password
        ? { requestAuthentication: true, failMsg: 'Proxy authentication required' }
        : { upstreamProxyUrl: upstreamUrl(proxy, upstreamCredentials) },
    })
    server.on('requestFailed', () => undefined)
    await server.listen()
    let relay = { server, username, password, host: '127.0.0.1', port: server.port }
    let previous = relays.get(profileId)
    relays.set(profileId, relay)
    if (previous) await previous.server.close(true)
    return relay
  }
  let close = async (profileId: string) => {
    let relay = relays.get(profileId)
    relays.delete(profileId)
    if (relay) await relay.server.close(true)
  }
  let closeAll = async () => { let current = [...relays.values()]; relays.clear(); await Promise.all(current.map(relay => relay.server.close(true))) }
  let authentication = (host: string, port: number) => [...relays.values()].find(relay => relay.host === host && relay.port === port)
  return { create, close, closeAll, authentication, get: (profileId: string) => relays.get(profileId) }
}
