import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { WebSocketServer, WebSocket } from 'ws'
import { createRemoteJWKSet, jwtVerify } from 'jose'

let required = (name: string) => { let value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value }
let publicOrigin = new URL(required('BMUX_PUBLIC_ORIGIN')).origin
if (!publicOrigin.startsWith('https://') && !publicOrigin.startsWith('http://127.0.0.1:')) throw new Error('BMUX_PUBLIC_ORIGIN requires HTTPS')
let audience = required('BMUX_GOOGLE_CLIENT_ID')
let turnSecret = required('BMUX_TURN_SECRET')
let turnUrls = required('BMUX_TURN_URLS').split(',')
let pool = new Pool({ connectionString: required('DATABASE_URL'), max: 4 })
await pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
let googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
let digest = (value: string) => createHash('sha256').update(value).digest('hex')
let keyId = (key: { kty?: string; crv?: string; x?: string }) => {
  if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x)) throw new Error('Invalid public key')
  return digest(key.x)
}
type Peer = { socket: WebSocket; owner: string; id: string; role: 'host' | 'viewer'; service?: string; generation?: string; key: unknown; alive: boolean }
let peers = new Map<string, Peer>()
let tickets = new Map<string, { owner: string; id: string; key: unknown; expires: number }>()
let send = (peer: Peer, value: unknown) => { if (peer.socket.readyState === WebSocket.OPEN && peer.socket.bufferedAmount < 262144) peer.socket.send(JSON.stringify(value)) }
let hostsFor = (owner: string) => [...peers.values()].filter(peer => peer.owner === owner && peer.role === 'host').map(peer => ({ id: peer.id, generation: peer.generation, service: peer.service, key: peer.key }))
let publish = (owner: string) => { for (let peer of peers.values()) if (peer.owner === owner && peer.role === 'viewer') send(peer, { type: 'hosts', hosts: hostsFor(owner) }) }
let body = async (request: http.IncomingMessage) => {
  let text = ''
  for await (let chunk of request) { text += chunk; if (text.length > 131072) throw new Error('Request too large') }
  return JSON.parse(text || '{}')
}
let login = async (request: http.IncomingMessage) => {
  let token = /(?:^|;\s*)bmux_session=([a-f0-9]+)/.exec(request.headers.cookie ?? '')?.[1]
  if (!token) throw new Error('Login required')
  let result = await pool.query('SELECT owner FROM bmux_logins WHERE token_hash=$1 AND expires>now()', [digest(token)])
  if (!result.rowCount) throw new Error('Login expired')
  return result.rows[0].owner as string
}
let ice = (id: string) => { let username = `${Math.floor(Date.now() / 1000) + 600}:${id}`; return [{ urls: turnUrls, username, credential: createHmac('sha1', turnSecret).update(username).digest('base64') }] }
let server = http.createServer((request, response) => {
  let json = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
  void (async () => {
    let url = new URL(request.url ?? '/', publicOrigin)
    if (request.method === 'GET' && url.pathname === '/health') { await pool.query('SELECT 1'); json(200, { ok: true }); return }
    if (request.method === 'GET' && url.pathname === '/api/config') { json(200, { googleClientId: audience }); return }
    if (request.method === 'POST' && request.headers.origin !== publicOrigin) throw new Error('Invalid origin')
    if (request.method === 'POST' && url.pathname === '/api/login') {
      let { credential } = await body(request)
      let { payload } = await jwtVerify(credential, googleKeys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience, maxTokenAge: '1h' })
      if (!payload.sub || payload.email_verified !== true) throw new Error('Invalid login')
      let token = randomBytes(32).toString('hex')
      await pool.query("INSERT INTO bmux_logins VALUES ($1,$2,now()+interval '12 hours')", [digest(token), payload.sub])
      response.setHeader('Set-Cookie', `bmux_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${publicOrigin.startsWith('https:') ? '; Secure' : ''}`)
      json(200, { ok: true }); return
    }
    if (url.pathname.startsWith('/api/')) {
      let owner = await login(request)
      if (request.method === 'GET' && url.pathname === '/api/me') { json(200, { owner }); return }
      if (request.method === 'POST' && url.pathname === '/api/connect') {
        let { publicKey } = await body(request), id = keyId(publicKey)
        let found = await pool.query('SELECT owner,revoked FROM bmux_devices WHERE id=$1', [id])
        if (found.rowCount && (found.rows[0].owner !== owner || found.rows[0].revoked)) throw new Error('Device revoked')
        await pool.query('INSERT INTO bmux_devices (id,owner,public_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, owner, { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x }])
        let ticket = randomBytes(32).toString('hex')
        if (tickets.size >= 10000) throw new Error('Connection capacity reached')
        tickets.set(ticket, { owner, id, key: publicKey, expires: Date.now() + 30000 })
        json(200, { ticket, iceServers: ice(id) }); return
      }
      if (request.method === 'GET' && url.pathname === '/api/usage') {
        let result = await pool.query("SELECT u.service,sum(u.started)::float AS started,sum(u.succeeded)::float AS succeeded,sum(u.failed)::float AS failed,sum(u.browser_ms)::float AS browser_ms FROM bmux_usage u JOIN bmux_services s ON s.id=u.service WHERE s.owner=$1 AND u.day>=CURRENT_DATE-29 GROUP BY u.service", [owner])
        json(200, result.rows); return
      }
      if (request.method === 'POST' && url.pathname === '/api/revoke') {
        let { id } = await body(request)
        await pool.query('UPDATE bmux_devices SET revoked=true WHERE id=$1 AND owner=$2', [id, owner])
        if (peers.get(id)?.owner !== owner) { json(200, { ok: true }); return }
        peers.get(id)?.socket.close(1008, 'Revoked')
        for (let peer of peers.values()) if (peer.owner === owner && peer.role === 'host') send(peer, { type: 'revoked', id })
        json(200, { ok: true }); return
      }
      json(404, { error: 'Not found' }); return
    }
    if (request.method !== 'GET') { json(404, { error: 'Not found' }); return }
    let filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    if (!/^(index\.html|assets\/[A-Za-z0-9_.-]+)$/.test(filename)) { json(404, { error: 'Not found' }); return }
    let file = await fs.readFile(path.join(import.meta.dirname, 'dist', filename))
    response.writeHead(200, { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'self' https://accounts.google.com; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" })
    response.end(file)
  })().catch(() => json(401, { error: 'Request unavailable or unauthorized' }))
})
let sockets = new WebSocketServer({ noServer: true, maxPayload: 262144 })
server.on('upgrade', (request, socket, head) => {
  void (async () => {
    let url = new URL(request.url ?? '/', publicOrigin)
    if (peers.size >= 10000) throw new Error('Connection capacity reached')
    if (url.pathname !== '/connect') throw new Error('Invalid endpoint')
    let peer: Omit<Peer, 'socket'>
    let token = request.headers.authorization?.replace(/^Bearer /, '')
    if (token) {
      let found = await pool.query('SELECT id,owner,public_key FROM bmux_services WHERE token_hash=$1 AND NOT revoked', [digest(token)])
      if (!found.rowCount) throw new Error('Invalid enrollment')
      let id = url.searchParams.get('host'), generation = url.searchParams.get('generation')
      if (!id || !generation || !/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(generation) || peers.has(id)) throw new Error('Invalid host identity')
      peer = { owner: found.rows[0].owner, id, role: 'host', service: found.rows[0].id, generation, key: found.rows[0].public_key, alive: true }
    } else {
      if (request.headers.origin !== publicOrigin) throw new Error('Invalid origin')
      let ticket = url.searchParams.get('ticket') ?? '', enrollment = tickets.get(ticket)
      tickets.delete(ticket)
      if (!enrollment || enrollment.expires <= Date.now()) throw new Error('Invalid ticket')
      let device = await pool.query('SELECT id FROM bmux_devices WHERE id=$1 AND owner=$2 AND NOT revoked', [enrollment.id, enrollment.owner])
      if (!device.rowCount) throw new Error('Device revoked')
      peers.get(enrollment.id)?.socket.close(1000, 'Reconnected')
      peer = { owner: enrollment.owner, id: enrollment.id, role: 'viewer', key: enrollment.key, alive: true }
    }
    sockets.handleUpgrade(request, socket, head, connection => {
      let current: Peer = { ...peer, socket: connection }
      peers.set(current.id, current)
      connection.on('pong', () => { current.alive = true })
      connection.on('error', () => undefined)
      send(current, { type: 'ready', id: current.id, iceServers: ice(current.id) })
      publish(current.owner)
      connection.on('message', raw => {
        void (async () => {
          let message = JSON.parse(raw.toString())
          if (message.type === 'signal') {
            let target = peers.get(message.to)
            if (!target || target.owner !== current.owner || target.role === current.role) throw new Error('Invalid route')
            send(target, { type: 'signal', from: current.id, envelope: message.envelope }); return
          }
          if (message.type === 'usage' && current.role === 'host') {
            let values = ['sequence', 'started', 'succeeded', 'failed', 'active', 'browserMs'].map(key => message[key])
            let day = message.day ?? new Date().toISOString().slice(0, 10)
            if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || day > new Date().toISOString().slice(0, 10) || Date.parse(day) < Date.now() - 30 * 86400000) throw new Error('Invalid usage day')
            if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid usage')
            await pool.query('INSERT INTO bmux_usage (service,host,generation,sequence,started,succeeded,failed,active,browser_ms,day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (service,host,generation,day) DO UPDATE SET sequence=excluded.sequence,started=excluded.started,succeeded=excluded.succeeded,failed=excluded.failed,active=excluded.active,browser_ms=excluded.browser_ms,recorded=now() WHERE bmux_usage.sequence<excluded.sequence', [current.service, current.id, current.generation, ...values, day])
          }
        })().catch(() => connection.close(1008, 'Invalid message'))
      })
      connection.on('close', () => { if (peers.get(current.id) !== current) return; peers.delete(current.id); publish(current.owner); for (let other of peers.values()) if (other.owner === current.owner) send(other, { type: 'disconnected', id: current.id }) })
    })
  })().catch(() => socket.destroy())
})
let timer = setInterval(() => {
  for (let [ticket, value] of tickets) if (value.expires <= Date.now()) tickets.delete(ticket)
  for (let peer of peers.values()) { if (!peer.alive) peer.socket.terminate(); else { peer.alive = false; peer.socket.ping() } }
  void pool.query("DELETE FROM bmux_usage WHERE recorded<now()-interval '30 days'; DELETE FROM bmux_logins WHERE expires<now()").catch(() => undefined)
  void pool.query('SELECT id FROM bmux_services WHERE revoked').then(result => { for (let row of result.rows) for (let peer of peers.values()) if (peer.service === row.id) peer.socket.close(1008, 'Revoked') }).catch(() => { for (let peer of peers.values()) peer.socket.close(1011, 'Authorization unavailable') })
}, 15000)
server.listen(Number(process.env.PORT ?? 8788), '0.0.0.0')
for (let signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { clearInterval(timer); for (let peer of peers.values()) peer.socket.close(); server.close(() => { void pool.end() }) })
