import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import type http from 'node:http'
import { createMobileAuth } from '../remote/mobile-auth'
import { jwtVerify } from 'jose'

vi.mock('jose', async () => {
  let actual = await vi.importActual<typeof import('jose')>('jose')
  return { ...actual, createRemoteJWKSet: vi.fn(), jwtVerify: vi.fn(async () => ({ payload: { sub: 'apple-subject', nonce: 'expected-nonce' } })) }
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

let fixture = () => {
  let headers = new Map<string, unknown>(), status = 0
  let response = { getHeader: (key: string) => headers.get(key), setHeader: (key: string, value: unknown) => headers.set(key, value), writeHead: vi.fn((value: number, values: Record<string, unknown>) => { status = value; for (let [key, value] of Object.entries(values)) headers.set(key, value) }), end: vi.fn((_value?: string) => {}) }
  let query = vi.fn(async (sql: string, _params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    if (sql.startsWith('DELETE FROM bmux_provider_flows')) return { rows: [{ purpose: 'apple-login', nonce: 'expected-nonce' }], rowCount: 1 }
    if (sql.startsWith('SELECT owner FROM bmux_provider_identities')) return { rows: [{ owner: 'canonical-google-owner' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  })
  let privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  let options = { origin: 'https://remote.example', googleClientId: 'fixture', pool: { query, connect: async () => ({ query, release: vi.fn() }) }, revoked: vi.fn(), webRevoked: vi.fn(), env: { BMUX_APPLE_CLIENT_ID: 'fixture-client', BMUX_APPLE_TEAM_ID: 'fixture-team', BMUX_APPLE_KEY_ID: 'fixture-key', BMUX_APPLE_PRIVATE_KEY: privateKey } }
  let auth = createMobileAuth(options as unknown as Parameters<typeof createMobileAuth>[0])
  let route = (request: unknown, path: string) => auth.route(request as http.IncomingMessage, response as unknown as http.ServerResponse, new URL(path, options.origin), async () => ({}))
  return { headers, response, query, route, webRevoked: options.webRevoked, status: () => status }
}

it.each(['authenticate', 'delete'])('keeps web logout retryable when the database fails during %s', async stage => {
  let value = fixture()
  if (stage === 'delete') {
    value.query.mockResolvedValueOnce({ rows: [{ owner: 'fixture-owner' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
  }
  value.query.mockRejectedValueOnce(new Error('Database unavailable'))
  await value.route({ method: 'POST', headers: { origin: 'https://remote.example', cookie: `bmux_session=${'a'.repeat(64)}` } }, '/api/logout')
  expect(value.status()).toBe(503)
  expect(value.response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Sign-out unavailable' }))
  expect(value.headers.has('Set-Cookie')).toBe(false)
  expect(value.webRevoked).not.toHaveBeenCalled()
  if (stage === 'delete') expect(value.query).toHaveBeenCalledWith('ROLLBACK')
})

it('keeps the native PKCE flow available during the Apple cross-site form callback', async () => {
  let value = fixture()
  await value.route({ method: 'GET', headers: {} }, '/api/auth/mobile/start?' + new URLSearchParams({ state: 's'.repeat(32), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', redirect_uri: 'bmux-remote://auth/callback' }))
  expect(value.status()).toBe(303)
  expect(value.headers.get('Set-Cookie')).toEqual([expect.stringMatching(/^bmux_mobile_flow=[a-f0-9]{64}; HttpOnly; SameSite=None; Path=\/api\/auth\/; Max-Age=600; Secure$/)])
})

it('keeps an explicit native Google sign-in on the Google provider', async () => {
  let value = fixture()
  await value.route({ method: 'GET', headers: {} }, '/api/auth/mobile/start?' + new URLSearchParams({ state: 's'.repeat(32), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', redirect_uri: 'bmux-remote://auth/callback', provider: 'google' }))
  expect(value.headers.get('Location')).toBe('/api/auth/mobile/signin?provider=google')
  await value.route({ method: 'GET', headers: {} }, '/api/auth/mobile/signin?provider=google')
  let html = value.response.end.mock.calls.at(-1)?.[0] as string
  expect(html).toContain("text:'signin_with'")
  expect(html).not.toContain('Continue with Apple')
})

it.each([false, true])('recovers an unlinked Apple account with Google and retains the native flow: %s', async native => {
  let value = fixture(), state = 'a'.repeat(64)
  value.query.mockResolvedValueOnce({ rows: [{ purpose: 'apple-login', nonce: 'expected-nonce' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id_token: 'fixture-identity-token' }) })))
  let request = { method: 'POST', headers: { cookie: `bmux_apple_flow=${state}${native ? '; bmux_mobile_flow=' + 'b'.repeat(64) : ''}` }, async *[Symbol.asyncIterator]() { yield new URLSearchParams({ state, code: 'one-use-apple-code' }).toString() } }
  await value.route(request, '/api/auth/apple/callback')
  expect(value.status()).toBe(200)
  expect(value.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  let html = value.response.end.mock.calls.at(-1)?.[0] as string
  expect(html).toContain('This Apple account is not linked yet.')
  expect(html).toContain(native ? 'location.assign("/api/auth/mobile/complete")' : 'location.assign("/?view=account")')
  expect(html).toContain('https://accounts.google.com/gsi/client')
  expect(html).not.toContain('Continue with Apple')
  expect(value.headers.get('Set-Cookie')).toEqual([expect.stringContaining('bmux_apple_flow=;')])
  expect(value.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bmux_logins') || sql.startsWith('INSERT INTO bmux_provider_identities'))).toBe(false)
})

it('lets a signed-out app open Apple linking through Google sign-in', async () => {
  let value = fixture()
  await value.route({ method: 'GET', headers: {} }, '/api/auth/providers/apple/link')
  expect(value.status()).toBe(200)
  expect(value.response.end).toHaveBeenCalledWith(expect.stringContaining('location.assign("/api/auth/providers/apple/link")'))
  expect(value.query).not.toHaveBeenCalled()
})

it('allows native account settings to read Apple linking status', async () => {
  let value = fixture()
  value.query.mockResolvedValueOnce({ rows: [{ owner: 'canonical-google-owner', session_id: 'native-session', revoked: false, expires: new Date(Date.now() + 60000) }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
  await value.route({ method: 'GET', headers: { authorization: 'Bearer ' + 'a'.repeat(64) } }, '/api/auth/providers')
  expect(value.status()).toBe(200)
  expect(value.response.end).toHaveBeenCalledWith(JSON.stringify({ appleEnabled: true, appleLinked: true }))
  expect(value.query).toHaveBeenLastCalledWith(expect.stringContaining("provider='apple' AND owner=$1"), ['canonical-google-owner'])
})

it('finishes linked Apple native sign-in through the canonical owner and the PKCE handoff', async () => {
  let value = fixture(), state = 'a'.repeat(64)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id_token: 'fixture-identity-token' }) })))
  let request = { method: 'POST', headers: { cookie: `bmux_apple_flow=${state}; bmux_mobile_flow=${'b'.repeat(64)}` }, async *[Symbol.asyncIterator]() { yield new URLSearchParams({ state, code: 'one-use-apple-code' }).toString() } }
  await value.route(request, '/api/auth/apple/callback')
  expect(jwtVerify).toHaveBeenCalledWith('fixture-identity-token', undefined, { issuer: 'https://appleid.apple.com', audience: 'fixture-client', algorithms: ['RS256'], maxTokenAge: '10m' })
  expect(value.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO bmux_logins'), [expect.stringMatching(/^[a-f0-9]{64}$/), 'canonical-google-owner'])
  expect(value.headers.get('Set-Cookie')).toMatch(/^bmux_session=[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/)
  expect(value.headers.get('Location')).toBe('/api/auth/mobile/complete')
  expect(value.status()).toBe(303)
})

it('rejects Apple nonce substitution before reading or issuing an owner login', async () => {
  let value = fixture(), state = 'a'.repeat(64)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id_token: 'fixture-identity-token' }) })))
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: { sub: 'apple-subject', nonce: 'different-nonce' }, protectedHeader: { alg: 'RS256' } })
  let request = { method: 'POST', headers: { cookie: `bmux_apple_flow=${state}` }, async *[Symbol.asyncIterator]() { yield new URLSearchParams({ state, code: 'one-use-apple-code' }).toString() } }
  await expect(value.route(request, '/api/auth/apple/callback')).rejects.toThrow('Authentication flow unavailable')
  expect(value.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bmux_logins'))).toBe(false)
})

it.each(['cookie', 'flow'])('offers a fresh Apple link when the callback %s has expired', async expired => {
  let value = fixture(), state = 'a'.repeat(64), fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  if (expired === 'flow') value.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
  let request = { method: 'POST', headers: { cookie: expired === 'cookie' ? '' : `bmux_apple_flow=${state}` }, async *[Symbol.asyncIterator]() { yield new URLSearchParams({ state, code: 'expired-apple-code' }).toString() } }
  await value.route(request, '/api/auth/apple/callback')
  expect(value.status()).toBe(401)
  expect(value.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  expect(value.response.end).toHaveBeenCalledWith(expect.stringContaining('href="/api/auth/providers/apple/link"'))
  expect(fetch).not.toHaveBeenCalled()
  expect(value.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bmux_logins'))).toBe(false)
})

it('requires fresh Google confirmation again when it expires during Apple linking', async () => {
  let value = fixture(), state = 'a'.repeat(64)
  value.query.mockResolvedValueOnce({ rows: [{ purpose: 'apple-link', nonce: 'expected-nonce', owner: 'canonical-google-owner', login_hash: 'fixture-login' }], rowCount: 1 })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id_token: 'fixture-identity-token' }) })))
  let request = { method: 'POST', headers: { cookie: `bmux_apple_flow=${state}` }, async *[Symbol.asyncIterator]() { yield new URLSearchParams({ state, code: 'one-use-apple-code' }).toString() } }
  await value.route(request, '/api/auth/apple/callback')
  expect(value.status()).toBe(401)
  expect(value.response.end).toHaveBeenCalledWith(expect.stringContaining('Apple sign-in expired'))
  expect(value.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bmux_provider_identities'))).toBe(false)
})
