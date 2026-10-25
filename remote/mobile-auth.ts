import type http from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose'
import type { RemoteNativeCredentials } from '../src/shared/remote-mobile-auth'

export type LoginContext = { owner: string; tokenHash: string; nativeSession?: string }
type Options = { pool: Pool; origin: string; googleClientId: string; revoked: (session: string) => void; env?: NodeJS.ProcessEnv }
export let authHash = (value: string) => createHash('sha256').update(value).digest('hex')
let opaque = () => randomBytes(32).toString('hex')
let cookie = (request: http.IncomingMessage, name: string) => new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`).exec(request.headers.cookie ?? '')?.[1]
let invalid = () => new Error('Authentication flow unavailable')
export let createMobileAuth = ({ pool, origin, googleClientId, revoked, env = process.env }: Options) => {
  let secure = origin.startsWith('https:'), callback = 'bmux-remote://auth/callback'
  let appleClientId = env.BMUX_APPLE_CLIENT_ID, appleTeam = env.BMUX_APPLE_TEAM_ID, appleKeyId = env.BMUX_APPLE_KEY_ID, applePrivateKey = env.BMUX_APPLE_PRIVATE_KEY
  let appleEnabled = !!(appleClientId && appleTeam && appleKeyId && applePrivateKey)
  let appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
  let setCookie = (response: http.ServerResponse, name: string, value: string, age = 600, crossSite = false) => {
    let current = response.getHeader('Set-Cookie')
    let next = `${name}=${value}; HttpOnly; SameSite=${crossSite && secure ? 'None' : 'Lax'}; Path=${name === 'bmux_google_reauth' ? '/api/' : '/api/auth/'}; Max-Age=${age}${secure ? '; Secure' : ''}`
    response.setHeader('Set-Cookie', [...(Array.isArray(current) ? current : current ? [String(current)] : []), next])
  }
  let redirect = (response: http.ServerResponse, location: string) => { response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end() }
  let json = (response: http.ServerResponse, value: unknown) => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
  let expiredApple = (response: http.ServerResponse) => {
    let nonce = randomBytes(18).toString('base64')
    setCookie(response, 'bmux_apple_flow', '', 0)
    response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` })
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apple sign-in expired | bmux</title><style nonce="${nonce}">body{font:16px system-ui;margin:12vh auto;padding:24px;max-width:360px;color:#eee;background:#161616}a{color:inherit}p{line-height:1.5}</style></head><body><h1>Apple sign-in expired</h1><p>Start again to confirm your account and link Apple.</p><a href="/api/auth/providers/apple/link">Link Apple</a></body></html>`)
  }
  let transaction = async <T>(operation: (client: PoolClient) => Promise<T>) => { let client = await pool.connect(); try { await client.query('BEGIN'); let result = await operation(client); await client.query('COMMIT'); return result } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }
  let authenticate = async (request: http.IncomingMessage, webOnly = false): Promise<LoginContext> => {
    let bearer = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1]
    let token = webOnly ? cookie(request, 'bmux_session') : bearer ?? cookie(request, 'bmux_session')
    if (!token || webOnly && bearer) throw invalid()
    let tokenHash = authHash(token)
    let found = await pool.query('SELECT l.owner,a.session_id,s.revoked,s.expires FROM bmux_logins l LEFT JOIN bmux_mobile_access a ON a.token_hash=l.token_hash LEFT JOIN bmux_mobile_sessions s ON s.id=a.session_id WHERE l.token_hash=$1 AND l.expires>now()', [tokenHash])
    let row = found.rows[0]
    if (!row || row.session_id && (!bearer || webOnly || row.revoked || new Date(row.expires).getTime() <= Date.now())) throw invalid()
    return { owner: row.owner, tokenHash, ...(row.session_id ? { nativeSession: row.session_id } : {}) }
  }
  let revoke = async (client: PoolClient, session: string) => {
    await client.query('UPDATE bmux_mobile_sessions SET revoked=true WHERE id=$1', [session])
    await client.query('DELETE FROM bmux_push_devices p USING bmux_mobile_devices d WHERE d.session_id=$1 AND p.device=d.device_id', [session])
    await client.query('DELETE FROM bmux_mobile_devices WHERE session_id=$1', [session])
    await client.query('DELETE FROM bmux_logins l USING bmux_mobile_access a WHERE a.session_id=$1 AND l.token_hash=a.token_hash', [session])
  }
  let issue = async (client: PoolClient, owner: string, session: string, refreshExpiry: Date): Promise<RemoteNativeCredentials> => {
    let accessToken = opaque(), refreshToken = opaque(), expiresAt = new Date(Date.now() + 3600000)
    await client.query('DELETE FROM bmux_logins l USING bmux_mobile_access a WHERE a.session_id=$1 AND l.token_hash=a.token_hash', [session])
    await client.query('INSERT INTO bmux_logins(token_hash,owner,expires) VALUES($1,$2,$3)', [authHash(accessToken), owner, expiresAt])
    await client.query('INSERT INTO bmux_mobile_access(token_hash,session_id) VALUES($1,$2)', [authHash(accessToken), session])
    await client.query('INSERT INTO bmux_mobile_refresh(token_hash,session_id,expires) VALUES($1,$2,$3)', [authHash(refreshToken), session, refreshExpiry])
    return { owner, accessToken, expiresAt: expiresAt.toISOString(), refreshToken, refreshExpiresAt: refreshExpiry.toISOString() }
  }
  let googleReauthentication = async (request: http.IncomingMessage, payload: JWTPayload) => {
    let flow = cookie(request, 'bmux_google_reauth')
    if (!flow) return false
    let found = await pool.query("DELETE FROM bmux_provider_flows WHERE id_hash=$1 AND purpose='google-reauth' AND expires>now() AND owner=$2 AND nonce=$3 RETURNING owner", [authHash(flow), payload.sub, payload.nonce])
    if (!found.rowCount) throw invalid()
    return true
  }
  let recordGoogleLogin = async (tokenHash: string, owner: string, reauthenticated: boolean) => {
    await pool.query('INSERT INTO bmux_web_auth(token_hash,owner,google_reauthenticated_at) VALUES($1,$2,$3)', [tokenHash, owner, reauthenticated ? new Date() : null])
  }
  let signIn = (response: http.ServerResponse, nonceValue?: string, linking = false) => {
    let nonce = randomBytes(18).toString('base64')
    let options = JSON.stringify({ client_id: googleClientId, auto_select: false, ...(nonceValue ? { nonce: nonceValue } : {}) }).replaceAll('<', '\\u003c')
    let script = `let config=${options};config.callback=async({credential})=>{let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential})});if(!r.ok){document.querySelector('#status').textContent='Sign-in failed. Try again.';return}${linking ? "let link=await fetch('/api/auth/providers/apple/link/start',{method:'POST'});if(!link.ok){document.querySelector('#status').textContent='Linking failed. Sign in again.';return}location.assign((await link.json()).url)" : "location.assign('/api/auth/mobile/complete')"}};google.accounts.id.initialize(config);google.accounts.id.renderButton(document.querySelector('#google'),{theme:'outline',size:'large'});`
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'nonce-${nonce}' https://accounts.google.com; img-src https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` })
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${linking ? 'Link Apple' : 'Sign in'} | bmux</title><style nonce="${nonce}">body{font:16px system-ui;margin:12vh auto;padding:24px;max-width:360px;color:#eee;background:#161616}a{color:inherit}p{line-height:1.5}</style></head><body><h1>${linking ? 'Link Apple' : 'bmux remote'}</h1><p>${linking ? 'Confirm your existing Google account, then link Apple.' : 'Sign in to connect your browsers.'}</p><div id="google"></div>${appleEnabled && !linking ? '<p><a href="/api/auth/apple/start">Continue with Apple</a></p>' : ''}<p id="status"></p><script nonce="${nonce}" src="https://accounts.google.com/gsi/client"></script><script nonce="${nonce}">${script}</script></body></html>`)
  }
  let appleStart = async (request: http.IncomingMessage, response: http.ServerResponse, linking: boolean) => {
    if (!appleEnabled) throw invalid()
    let auth = linking ? await authenticate(request, true) : undefined
    if (auth && !(await pool.query("SELECT 1 FROM bmux_web_auth WHERE token_hash=$1 AND owner=$2 AND google_reauthenticated_at>now()-interval '5 minutes'", [auth.tokenHash, auth.owner])).rowCount) throw invalid()
    let state = opaque(), nonce = opaque()
    await pool.query("INSERT INTO bmux_provider_flows(id_hash,purpose,nonce,owner,login_hash,expires) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')", [authHash(state), linking ? 'apple-link' : 'apple-login', nonce, auth?.owner, auth?.tokenHash])
    setCookie(response, 'bmux_apple_flow', state, 600, true)
    let url = new URL('https://appleid.apple.com/auth/authorize')
    url.search = new URLSearchParams({ client_id: appleClientId!, redirect_uri: `${origin}/api/auth/apple/callback`, response_type: 'code', response_mode: 'form_post', scope: 'name email', state, nonce }).toString()
    if (linking) json(response, { url: url.href }); else redirect(response, url.href)
  }
  let route = async (request: http.IncomingMessage, response: http.ServerResponse, url: URL, readBody: () => Promise<Record<string, unknown>>) => {
    let path = url.pathname, method = request.method
    if (!path.startsWith('/api/auth/')) return false
    if (method === 'GET' && path === '/api/auth/mobile/start') {
      let state = url.searchParams.get('state'), challenge = url.searchParams.get('code_challenge')
      if (!state || !/^[A-Za-z0-9._~-]{16,256}$/.test(state) || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || url.searchParams.get('code_challenge_method') !== 'S256' || url.searchParams.get('redirect_uri') !== callback) throw invalid()
      let id = opaque()
      await pool.query("INSERT INTO bmux_mobile_flows(id_hash,state,challenge,redirect_uri,expires) VALUES($1,$2,$3,$4,now()+interval '10 minutes')", [authHash(id), state, challenge, callback])
      setCookie(response, 'bmux_mobile_flow', id, 600, true)
      redirect(response, '/api/auth/mobile/signin'); return true
    }
    if (method === 'GET' && path === '/api/auth/mobile/signin') { signIn(response); return true }
    if (method === 'GET' && path === '/api/auth/mobile/complete') {
      let auth = await authenticate(request, true), flow = cookie(request, 'bmux_mobile_flow'), code = opaque()
      if (!flow) throw invalid()
      let found = await pool.query("UPDATE bmux_mobile_flows SET code_hash=$1,owner=$2,code_expires=now()+interval '60 seconds' WHERE id_hash=$3 AND expires>now() AND code_hash IS NULL RETURNING state,redirect_uri", [authHash(code), auth.owner, authHash(flow)])
      if (!found.rowCount) throw invalid()
      setCookie(response, 'bmux_mobile_flow', '', 0)
      redirect(response, `${callback}?${new URLSearchParams({ code, state: found.rows[0].state })}`); return true
    }
    if (method === 'POST' && path === '/api/auth/mobile/exchange') {
      let { code, codeVerifier } = await readBody()
      if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code) || typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) throw invalid()
      let result = await transaction(async client => {
        let challenge = createHash('sha256').update(codeVerifier).digest('base64url')
        let found = await client.query('DELETE FROM bmux_mobile_flows WHERE code_hash=$1 AND challenge=$2 AND code_expires>now() AND expires>now() RETURNING owner', [authHash(code), challenge])
        if (!found.rows[0]?.owner) throw invalid()
        let owner = found.rows[0].owner, session = randomUUID(), expires = new Date(Date.now() + 30 * 86400000)
        await client.query('INSERT INTO bmux_mobile_sessions(id,owner,expires) VALUES($1,$2,$3)', [session, owner, expires])
        return issue(client, owner, session, expires)
      })
      json(response, result); return true
    }
    if (method === 'POST' && path === '/api/auth/mobile/refresh') {
      let { refreshToken } = await readBody()
      if (typeof refreshToken !== 'string' || !/^[a-f0-9]{64}$/.test(refreshToken)) throw invalid()
      let result = await transaction(async client => {
        let found = await client.query('SELECT r.*,s.owner,s.revoked,s.expires AS session_expires FROM bmux_mobile_refresh r JOIN bmux_mobile_sessions s ON s.id=r.session_id WHERE r.token_hash=$1 FOR UPDATE OF r,s', [authHash(refreshToken)])
        let row = found.rows[0]
        if (!row || row.revoked || new Date(row.expires).getTime() <= Date.now() || new Date(row.session_expires).getTime() <= Date.now()) return null
        if (row.consumed) { await revoke(client, row.session_id); return { revokedSession: row.session_id } }
        await client.query('UPDATE bmux_mobile_refresh SET consumed=true WHERE token_hash=$1', [authHash(refreshToken)])
        return issue(client, row.owner, row.session_id, new Date(row.session_expires))
      })
      if (!result) throw invalid()
      if ('revokedSession' in result) { revoked(result.revokedSession); throw invalid() }
      json(response, result); return true
    }
    if (method === 'POST' && path === '/api/auth/mobile/logout') {
      let auth = await authenticate(request)
      if (!auth.nativeSession) throw invalid()
      await transaction(client => revoke(client, auth.nativeSession!)); revoked(auth.nativeSession)
      json(response, { ok: true }); return true
    }
    if (method === 'GET' && path === '/api/auth/providers') {
      let auth = await authenticate(request, true)
      json(response, { appleEnabled, appleLinked: !!(await pool.query("SELECT 1 FROM bmux_provider_identities WHERE provider='apple' AND owner=$1", [auth.owner])).rowCount }); return true
    }
    if (method === 'GET' && path === '/api/auth/providers/apple/link') {
      if (!appleEnabled) throw invalid()
      let auth = await authenticate(request, true), id = opaque(), nonce = opaque()
      await pool.query("INSERT INTO bmux_provider_flows(id_hash,purpose,nonce,owner,login_hash,expires) VALUES($1,'google-reauth',$2,$3,$4,now()+interval '10 minutes')", [authHash(id), nonce, auth.owner, auth.tokenHash])
      setCookie(response, 'bmux_google_reauth', id); signIn(response, nonce, true); return true
    }
    if (method === 'POST' && path === '/api/auth/providers/apple/link/start') { await appleStart(request, response, true); return true }
    if (method === 'GET' && path === '/api/auth/apple/start') { await appleStart(request, response, false); return true }
    if (method === 'POST' && path === '/api/auth/apple/callback') {
      if (!appleEnabled) throw invalid()
      let raw = ''
      for await (let chunk of request) { raw += chunk; if (raw.length > 32768) throw invalid() }
      let input = new URLSearchParams(raw), state = input.get('state'), code = input.get('code')
      if (!state || !/^[a-f0-9]{64}$/.test(state) || !code || code.length > 4096) throw invalid()
      if (cookie(request, 'bmux_apple_flow') !== state) { expiredApple(response); return true }
      let flow = (await pool.query("DELETE FROM bmux_provider_flows WHERE id_hash=$1 AND purpose IN ('apple-login','apple-link') AND expires>now() RETURNING *", [authHash(state)])).rows[0]
      if (!flow) { expiredApple(response); return true }
      let key = await importPKCS8(applePrivateKey!, 'ES256')
      let secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: appleKeyId! }).setIssuer(appleTeam!).setSubject(appleClientId!).setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(key)
      let token = await fetch('https://appleid.apple.com/auth/token', { method: 'POST', body: new URLSearchParams({ client_id: appleClientId!, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: `${origin}/api/auth/apple/callback` }), signal: AbortSignal.timeout(10000) })
      if (!token.ok) throw invalid()
      let data = await token.json() as { id_token?: string }
      if (!data.id_token) throw invalid()
      let { payload } = await jwtVerify(data.id_token, appleKeys, { issuer: 'https://appleid.apple.com', audience: appleClientId, algorithms: ['RS256'], maxTokenAge: '10m' })
      if (!payload.sub || payload.nonce !== flow.nonce) throw invalid()
      if (flow.purpose === 'apple-link') {
        let linked = await transaction(async client => {
          let valid = await client.query("SELECT 1 FROM bmux_web_auth a JOIN bmux_logins l ON l.token_hash=a.token_hash WHERE a.token_hash=$1 AND a.owner=$2 AND l.expires>now() AND a.google_reauthenticated_at>now()-interval '5 minutes'", [flow.login_hash, flow.owner])
          if (!valid.rowCount) return undefined
          return client.query("INSERT INTO bmux_provider_identities(provider,subject,owner) VALUES('apple',$1,$2) ON CONFLICT(provider,subject) DO UPDATE SET subject=excluded.subject WHERE bmux_provider_identities.owner=excluded.owner RETURNING owner", [payload.sub, flow.owner])
        })
        if (!linked) { expiredApple(response); return true }
        if (!linked.rowCount) throw invalid()
        redirect(response, '/'); return true
      }
      let owner = (await pool.query("SELECT owner FROM bmux_provider_identities WHERE provider='apple' AND subject=$1", [payload.sub])).rows[0]?.owner
      if (!owner) { response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); response.end('Sign in with Google, then link Apple in account settings.'); return true }
      let loginToken = opaque()
      await pool.query("INSERT INTO bmux_logins(token_hash,owner,expires) VALUES($1,$2,now()+interval '30 days')", [authHash(loginToken), owner])
      response.setHeader('Set-Cookie', `bmux_session=${loginToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure`)
      redirect(response, cookie(request,'bmux_mobile_flow') ? '/api/auth/mobile/complete' : '/'); return true
    }
    return false
  }
  let bindDevice = async (auth: LoginContext, device: string) => {
    if (!auth.nativeSession) return
    let valid = await pool.query('SELECT 1 FROM bmux_mobile_sessions WHERE id=$1 AND owner=$2 AND NOT revoked AND expires>now()', [auth.nativeSession, auth.owner])
    if (!valid.rowCount) throw invalid()
    await pool.query('INSERT INTO bmux_mobile_devices(device_id,session_id) VALUES($1,$2) ON CONFLICT(device_id) DO UPDATE SET session_id=excluded.session_id', [device, auth.nativeSession])
  }
  return { route, authenticate, bindDevice, recordGoogleLogin, googleReauthentication, appleEnabled, clearGoogleReauthentication: (response: http.ServerResponse) => setCookie(response, 'bmux_google_reauth', '', 0) }
}
