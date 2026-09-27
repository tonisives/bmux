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
let ready = false, stopped = false
let initialize = async () => {
  let schema = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  let retryable = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', '57P03', '53300'])
  while (!stopped) {
    try { await pool.query(schema); ready = true; return }
    catch (error) {
      if (!retryable.has((error as { code?: string }).code ?? '')) throw error
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }
}
let googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
let digest = (value: string) => createHash('sha256').update(value).digest('hex')
let keyId = (key: { kty?: string; crv?: string; x?: string }) => {
  if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x)) throw new Error('Invalid public key')
  return digest(key.x)
}
type ListedSession = { id: string; name: string; panes: { id: string; title: string }[] }
type Peer = { socket: WebSocket; owner: string; id: string; role: 'host' | 'viewer'; service?: string; generation?: string; key: unknown; alive: boolean; sessions?: ListedSession[] }
let peers = new Map<string, Peer>()
let tickets = new Map<string, { owner: string; id: string; key: unknown; expires: number; desktop: boolean }>()
let send = (peer: Peer, value: unknown) => { if (peer.socket.readyState === WebSocket.OPEN && peer.socket.bufferedAmount < 262144) peer.socket.send(JSON.stringify(value)) }
let permission = async (user: string, host: Peer): Promise<'watch' | 'control' | undefined> => {
  if (user === host.owner) return 'control'
  let result = await pool.query('SELECT permission FROM bmux_grants WHERE service=$1 AND user_id=$2', [host.service, user])
  return result.rows[0]?.permission
}
let visibleHosts = async (owner: string) => {
  let granted = await pool.query('SELECT service,permission FROM bmux_grants WHERE user_id=$1', [owner])
  let accessByService = new Map<string, 'watch' | 'control'>(granted.rows.map(row => [row.service, row.permission]))
  let hosts = []
  for (let host of peers.values()) {
    if (host.role !== 'host') continue
    let access = owner === host.owner ? 'control' : accessByService.get(host.service!)
    if (access) hosts.push({ id: host.id, generation: host.generation, service: host.service, key: host.key, permission: access, sessions: host.sessions ?? [] })
  }
  return hosts
}
let publish = async () => {
  for (let viewer of peers.values()) if (viewer.role === 'viewer') send(viewer, { type: 'hosts', hosts: await visibleHosts(viewer.owner) })
}
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
    if (!ready) { json(503, { error: 'Service starting' }); return }
    if (request.method === 'GET' && url.pathname === '/health') { await pool.query('SELECT 1'); json(200, { ok: true }); return }
    if (request.method === 'GET' && url.pathname === '/api/config') { json(200, { googleClientId: audience }); return }
    if (request.method === 'POST' && request.headers.origin !== publicOrigin) throw new Error('Invalid origin')
    if (request.method === 'POST' && url.pathname === '/api/login') {
      let { credential, accessToken } = await body(request)
      let owner: string | undefined
      if (typeof credential === 'string') {
        let { payload } = await jwtVerify(credential, googleKeys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience, maxTokenAge: '1h' })
        if (payload.email_verified === true && typeof payload.sub === 'string') owner = payload.sub
      } else if (typeof accessToken === 'string' && accessToken.length <= 4096) {
        let verified = await fetch('https://oauth2.googleapis.com/tokeninfo', { method: 'POST', body: new URLSearchParams({ access_token: accessToken }), signal: AbortSignal.timeout(10000) })
        if (!verified.ok) throw new Error('Invalid login')
        let info = await verified.json() as { audience?: string; issued_to?: string; user_id?: string; verified_email?: boolean | string; expires_in?: number | string; scope?: string }
        let scopes = info.scope?.split(' ') ?? []
        if (info.audience === audience && info.issued_to === audience && (info.verified_email === true || info.verified_email === 'true') && Number(info.expires_in) > 0 && (scopes.includes('email') || scopes.includes('https://www.googleapis.com/auth/userinfo.email')) && typeof info.user_id === 'string') owner = info.user_id
      }
      if (!owner) throw new Error('Invalid login')
      let token = randomBytes(32).toString('hex')
      await pool.query("INSERT INTO bmux_logins VALUES ($1,$2,now()+interval '30 days')", [digest(token), owner])
      response.setHeader('Set-Cookie', `bmux_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${publicOrigin.startsWith('https:') ? '; Secure' : ''}`)
      json(200, { ok: true }); return
    }
    if (url.pathname.startsWith('/api/')) {
      let owner = await login(request)
      if (request.method === 'GET' && url.pathname === '/api/me') { json(200, { owner }); return }
      if (request.method === 'GET' && url.pathname === '/api/hosts') { json(200, await visibleHosts(owner)); return }
      if (request.method === 'GET' && url.pathname === '/api/services') {
        let result = await pool.query('SELECT id,revoked FROM bmux_services WHERE owner=$1 ORDER BY id', [owner])
        json(200, result.rows); return
      }
      if (request.method === 'POST' && url.pathname === '/api/services') {
        let { service } = await body(request)
        if (typeof service !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(service)) { json(400, { error: 'Use lowercase letters, numbers and hyphens for the service name' }); return }
        let key = randomBytes(32).toString('hex')
        let created = await pool.query('INSERT INTO bmux_services (id,owner,token_hash) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING RETURNING id', [service, owner, digest(key)])
        if (!created.rowCount) { json(409, { error: 'Service name unavailable' }); return }
        json(200, { service, key }); return
      }
      if (request.method === 'POST' && url.pathname === '/api/services/revoke') {
        let { service } = await body(request)
        await pool.query('UPDATE bmux_services SET revoked=true WHERE id=$1 AND owner=$2', [service, owner])
        for (let peer of peers.values()) if (peer.role === 'host' && peer.service === service && peer.owner === owner) peer.socket.close(1008, 'Revoked')
        json(200, { ok: true }); return
      }
      if (request.method === 'POST' && url.pathname === '/api/services/rotate') {
        let { service } = await body(request), key = randomBytes(32).toString('hex')
        let changed = await pool.query('UPDATE bmux_services SET token_hash=$1 WHERE id=$2 AND owner=$3 AND NOT revoked RETURNING id', [digest(key), service, owner])
        if (!changed.rowCount) { json(404, { error: 'Service not found' }); return }
        for (let peer of peers.values()) if (peer.role === 'host' && peer.service === service && peer.owner === owner) peer.socket.close(1008, 'Key rotated')
        json(200, { service, key }); return
      }
      if (request.method === 'GET' && url.pathname === '/api/grants') {
        let result = await pool.query('SELECT g.service,g.user_id,g.permission FROM bmux_grants g JOIN bmux_services s ON s.id=g.service WHERE s.owner=$1 ORDER BY g.service,g.user_id', [owner])
        json(200, result.rows); return
      }
      if (request.method === 'POST' && url.pathname === '/api/grants') {
        let { service, user, permission: access } = await body(request)
        if (typeof user !== 'string' || !/^[0-9]{1,32}$/.test(user) || !['watch', 'control', null].includes(access)) { json(400, { error: 'Enter a valid account ID and permission' }); return }
        let found = await pool.query('SELECT revoked FROM bmux_services WHERE id=$1 AND owner=$2', [service, owner])
        if (!found.rowCount || user === owner || (access && found.rows[0].revoked)) { json(400, { error: 'Choose an active service and another account' }); return }
        if (access) await pool.query('INSERT INTO bmux_grants (service,user_id,permission) VALUES ($1,$2,$3) ON CONFLICT (service,user_id) DO UPDATE SET permission=excluded.permission', [service, user, access])
        else await pool.query('DELETE FROM bmux_grants WHERE service=$1 AND user_id=$2', [service, user])
        for (let peer of peers.values()) if (peer.role === 'viewer' && peer.owner === user) for (let host of peers.values()) if (host.role === 'host' && host.service === service) send(host, { type: access ? 'authorized' : 'revoked', id: peer.id, key: peer.key, permission: access })
        void publish().catch(() => undefined)
        json(200, { ok: true }); return
      }
      if (request.method === 'POST' && url.pathname === '/api/connect') {
        let { publicKey } = await body(request), id = keyId(publicKey)
        let found = await pool.query('SELECT owner,revoked FROM bmux_devices WHERE id=$1', [id])
        if (found.rowCount && (found.rows[0].owner !== owner || found.rows[0].revoked)) throw new Error('Device revoked')
        await pool.query('INSERT INTO bmux_devices (id,owner,public_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, owner, { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x }])
        let ticket = randomBytes(32).toString('hex')
        if (tickets.size >= 10000) throw new Error('Connection capacity reached')
        tickets.set(ticket, { owner, id, key: publicKey, expires: Date.now() + 30000, desktop: request.headers['x-bmux-desktop'] === '1' })
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
        for (let peer of peers.values()) if (peer.role === 'host' && await permission(owner, peer)) send(peer, { type: 'revoked', id })
        json(200, { ok: true }); return
      }
      json(404, { error: 'Not found' }); return
    }
    if (request.method !== 'GET') { json(404, { error: 'Not found' }); return }
    let filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    if (!/^(index\.html|assets\/[A-Za-z0-9_.-]+)$/.test(filename)) { json(404, { error: 'Not found' }); return }
    let file = await fs.readFile(path.join(import.meta.dirname, 'dist', filename))
    let nonce = randomBytes(18).toString('base64')
    if (filename === 'index.html') file = Buffer.from(file.toString().replace('<head>', `<head><meta name="csp-nonce" content="${nonce}">`))
    response.writeHead(200, { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': `default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; img-src 'self' https://cdn.digthree.tonis.dev; style-src 'self' 'nonce-${nonce}' https://accounts.google.com; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` })
    response.end(file)
  })().catch(() => json(401, { error: 'Request unavailable or unauthorized' }))
})
let sockets = new WebSocketServer({ noServer: true, maxPayload: 262144 })
server.on('upgrade', (request, socket, head) => {
  void (async () => {
    if (!ready) throw new Error('Service starting')
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
      let supplied = url.searchParams.get('key')
      let key = supplied ? JSON.parse(Buffer.from(supplied, 'base64url').toString()) : found.rows[0].public_key
      if (!key) throw new Error('Host key required')
      keyId(key)
      peer = { owner: found.rows[0].owner, id, role: 'host', service: found.rows[0].id, generation, key, alive: true }
    } else {
      let ticket = url.searchParams.get('ticket') ?? '', enrollment = tickets.get(ticket)
      tickets.delete(ticket)
      if (!enrollment || enrollment.expires <= Date.now()) throw new Error('Invalid ticket')
      if (request.headers.origin !== publicOrigin && !(enrollment.desktop && (request.headers.origin === 'null' || request.headers.origin === 'file://'))) throw new Error('Invalid origin')
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
      void publish().catch(() => undefined)
      connection.on('message', raw => {
        void (async () => {
          let message = JSON.parse(raw.toString())
          if (message.type === 'signal') {
            let target = peers.get(message.to)
            if (!target || target.role === current.role) throw new Error('Invalid route')
            let host = current.role === 'host' ? current : target
            let viewer = current.role === 'viewer' ? current : target
            let access = await permission(viewer.owner, host)
            if (!access) { send(current, { type: 'signal-error', to: target.id, error: 'Access revoked' }); return }
            if (current.role === 'viewer') send(host, { type: 'authorized', id: viewer.id, key: viewer.key, permission: access })
            send(target, { type: 'signal', from: current.id, envelope: message.envelope }); return
          }
          if (message.type === 'sessions' && current.role === 'host') {
            let sessions = message.sessions
            if (!Array.isArray(sessions) || sessions.length > 100 || !sessions.every((session: ListedSession) =>
              typeof session.id === 'string' && session.id.length <= 128 && typeof session.name === 'string' && session.name.length <= 256 &&
              Array.isArray(session.panes) && session.panes.length <= 100 && session.panes.every(pane =>
                typeof pane.id === 'string' && pane.id.length <= 128 && typeof pane.title === 'string' && pane.title.length <= 512))) throw new Error('Invalid sessions')
            current.sessions = sessions
            await publish(); return
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
      connection.on('close', () => {
        if (peers.get(current.id) !== current) return
        peers.delete(current.id)
        void publish().catch(() => undefined)
        void (async () => { for (let other of peers.values()) if (other.role !== current.role && await permission(current.role === 'viewer' ? current.owner : other.owner, current.role === 'host' ? current : other)) send(other, { type: 'disconnected', id: current.id }) })().catch(() => undefined)
      })
    })
  })().catch(() => socket.destroy())
})
let timer = setInterval(() => {
  if (!ready) return
  for (let [ticket, value] of tickets) if (value.expires <= Date.now()) tickets.delete(ticket)
  for (let peer of peers.values()) { if (!peer.alive) peer.socket.terminate(); else { peer.alive = false; peer.socket.ping() } }
  void pool.query("DELETE FROM bmux_usage WHERE recorded<now()-interval '30 days'; DELETE FROM bmux_logins WHERE expires<now()").catch(() => undefined)
  void pool.query('SELECT id FROM bmux_services WHERE revoked').then(result => { for (let row of result.rows) for (let peer of peers.values()) if (peer.service === row.id) peer.socket.close(1008, 'Revoked') }).catch(() => { for (let peer of peers.values()) peer.socket.close(1011, 'Authorization unavailable') })
}, 15000)
server.listen(Number(process.env.PORT ?? 8788), '0.0.0.0')
void initialize().catch(error => { console.error(`Database initialization failed: ${(error as { code?: string }).code ?? 'unknown'}`); process.exit(1) })
for (let signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { stopped = true; clearInterval(timer); for (let peer of peers.values()) peer.socket.close(); server.close(() => { void pool.end() }) })
