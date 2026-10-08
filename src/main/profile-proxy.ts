import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { isIP } from 'node:net'
import path from 'node:path'
import { Server } from 'proxy-chain'
import type { ProfileProxy, ProxyProtocol } from '../shared/types'

export type ProxyCredentials = { username: string; password: string }
type CredentialStoreOptions = { directory: string; available: () => boolean; encrypt: (text: string) => Buffer; decrypt: (data: Buffer) => string }
type Relay = { server: Server; username: string; password: string; host: string; port: number; failures: number; httpsAgent?: https.Agent }

export let requiredHostProxy = (endpoint?: string): ProfileProxy | undefined => {
  if (!endpoint) return undefined
  let url: URL
  try { url = new URL(endpoint) } catch { throw new Error('Invalid BMUX_REQUIRED_PROXY endpoint') }
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('BMUX_REQUIRED_PROXY must be an unauthenticated proxy endpoint')
  return parseProfileProxy({ protocol: url.protocol.slice(0, -1), host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : 1080)), authenticated: false })
}

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
    // CONNECT's Host identifies the destination. TLS must authenticate the proxy.
    let httpsAgent = proxy.protocol === 'https' ? new https.Agent({ servername: isIP(proxy.host) ? '' : proxy.host }) : undefined
    let server = new Server({
      host: '127.0.0.1', port: 0, verbose: false, authRealm: 'bmux',
      prepareRequestFunction: request => request.username !== username || request.password !== password
        ? { requestAuthentication: true, failMsg: 'Proxy authentication required' }
        : { upstreamProxyUrl: upstreamUrl(proxy, upstreamCredentials), httpsAgent },
    })
    await server.listen()
    let relay = { server, username, password, host: '127.0.0.1', port: server.port, failures: 0, httpsAgent }
    server.on('requestFailed', () => { relay.failures++ })
    let previous = relays.get(profileId)
    relays.set(profileId, relay)
    if (previous) { await previous.server.close(true); previous.httpsAgent?.destroy() }
    return relay
  }
  let close = async (profileId: string) => {
    let relay = relays.get(profileId)
    relays.delete(profileId)
    if (relay) { await relay.server.close(true); relay.httpsAgent?.destroy() }
  }
  let closeAll = async () => { let current = [...relays.values()]; relays.clear(); await Promise.all(current.map(async relay => { await relay.server.close(true); relay.httpsAgent?.destroy() })) }
  let authentication = (host: string, port: number) => [...relays.values()].find(relay => relay.host === host && relay.port === port)
  return { create, close, closeAll, authentication, get: (profileId: string) => relays.get(profileId) }
}

let proxyResponseError = (status: number) => {
  if ([401, 407, 597].includes(status)) return 'Proxy authentication failed. Check your provider service username and password.'
  if (status === 593) return 'Proxy host could not be found. Check the host name.'
  if (status === 594) return 'Proxy refused the connection. Check the protocol and port.'
  if (status === 504) return 'Proxy connection timed out.'
  return `Proxy could not establish a connection (HTTP ${status}). Check the server, protocol and credentials.`
}

// Probe the same authenticated loopback relay used by Chromium. Reading CONNECT
// ourselves preserves upstream errors that Chromium reduces to net::ERR_FAILED.
export let testProxyRelay = (relay: Pick<Relay, 'host' | 'port' | 'username' | 'password'>, endpoint: string) => new Promise<{ ip: string; region?: string; checkedAt: number }>((resolve, reject) => {
  let target = new URL(endpoint)
  if (!['http:', 'https:'].includes(target.protocol)) { reject(new Error('Invalid proxy test URL')); return }
  let authorization = `Basic ${Buffer.from(`${relay.username}:${relay.password}`).toString('base64')}`
  let requests: http.ClientRequest[] = [], tunnel: import('node:net').Socket | undefined, agent: https.Agent | undefined
  let finished = false
  let finish = (error?: Error, result?: { ip: string; region?: string; checkedAt: number }) => {
    if (finished) return
    finished = true; clearTimeout(timer)
    for (let request of requests) request.destroy()
    tunnel?.destroy(); agent?.destroy()
    if (error) reject(error)
    else resolve(result!)
  }
  let fail = (error: NodeJS.ErrnoException) => {
    let message = error.code?.includes('CERT') || error.code?.includes('TLS') || error.code?.includes('SELF_SIGNED')
      ? 'Proxy test could not verify the secure connection certificate.'
      : error.code === 'ECONNREFUSED' ? 'Proxy refused the connection. Check the protocol and port.'
        : error.code === 'ENOTFOUND' ? 'Proxy host could not be found. Check the host name.'
          : 'Proxy connection failed. Check the server, protocol and credentials.'
    finish(new Error(message))
  }
  let timer = setTimeout(() => finish(new Error('Proxy connection timed out.')), 10000)
  let response = (incoming: http.IncomingMessage) => {
    if (!incoming.statusCode || incoming.statusCode < 200 || incoming.statusCode >= 300) { finish(new Error(proxyResponseError(incoming.statusCode ?? 0))); return }
    let chunks: Buffer[] = [], size = 0
    incoming.on('data', chunk => {
      size += chunk.length
      if (size > 65536) { finish(new Error('Proxy test returned an invalid response.')); return }
      chunks.push(Buffer.from(chunk))
    })
    incoming.on('error', fail)
    incoming.on('end', () => {
      try {
        let value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ip?: unknown; city?: unknown; region?: unknown; country?: unknown }
        if (typeof value.ip !== 'string' || !isIP(value.ip)) throw new Error('Invalid address')
        let locations = [value.city, value.region, value.country].filter((item): item is string => typeof item === 'string' && !!item.trim() && item.length <= 120)
        let region = [...new Set(locations.map(item => item.trim()))].join(', ')
        finish(undefined, { ip: value.ip, ...(region ? { region } : {}), checkedAt: Date.now() })
      } catch { finish(new Error('Proxy test returned an invalid address.')) }
    })
  }
  let request = http.request({ host: relay.host, port: relay.port, method: target.protocol === 'https:' ? 'CONNECT' : 'GET', path: target.protocol === 'https:' ? `${target.hostname}:${target.port || 443}` : target.href, headers: { Host: target.host, 'Proxy-Authorization': authorization }, agent: false })
  requests.push(request); request.on('error', fail)
  if (target.protocol === 'http:') request.on('response', response)
  else request.on('connect', (incoming, socket, head) => {
    tunnel = socket
    if (finished) { socket.destroy(); return }
    if (incoming.statusCode !== 200) { finish(new Error(proxyResponseError(incoming.statusCode ?? 0))); return }
    if (head.length) socket.unshift(head)
    agent = new https.Agent({ keepAlive: false })
    agent.createConnection = () => tls.connect({ socket, host: target.hostname, servername: isIP(target.hostname) ? undefined : target.hostname })
    let secure = https.get(target, { agent, headers: { Accept: 'application/json' } }, response)
    requests.push(secure); secure.on('error', fail)
  })
  request.end()
})
