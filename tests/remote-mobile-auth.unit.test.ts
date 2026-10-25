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
  let response = { getHeader: (key: string) => headers.get(key), setHeader: (key: string, value: unknown) => headers.set(key, value), writeHead: vi.fn((value: number, values: Record<string, unknown>) => { status = value; for (let [key, value] of Object.entries(values)) headers.set(key, value) }), end: vi.fn() }
  let query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith('DELETE FROM bmux_provider_flows')) return { rows: [{ purpose: 'apple-login', nonce: 'expected-nonce' }], rowCount: 1 }
    if (sql.startsWith('SELECT owner FROM bmux_provider_identities')) return { rows: [{ owner: 'canonical-google-owner' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  })
  let privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  let options = { origin: 'https://remote.example', googleClientId: 'fixture', pool: { query }, revoked: vi.fn(), env: { BMUX_APPLE_CLIENT_ID: 'fixture-client', BMUX_APPLE_TEAM_ID: 'fixture-team', BMUX_APPLE_KEY_ID: 'fixture-key', BMUX_APPLE_PRIVATE_KEY: privateKey } }
  let auth = createMobileAuth(options as unknown as Parameters<typeof createMobileAuth>[0])
  let route = (request: unknown, path: string) => auth.route(request as http.IncomingMessage, response as unknown as http.ServerResponse, new URL(path, options.origin), async () => ({}))
  return { headers, response, query, route, status: () => status }
}

it('keeps the native PKCE flow available during the Apple cross-site form callback', async () => {
  let value = fixture()
  await value.route({ method: 'GET', headers: {} }, '/api/auth/mobile/start?' + new URLSearchParams({ state: 's'.repeat(32), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', redirect_uri: 'bmux-remote://auth/callback' }))
  expect(value.status()).toBe(303)
  expect(value.headers.get('Set-Cookie')).toEqual([expect.stringMatching(/^bmux_mobile_flow=[a-f0-9]{64}; HttpOnly; SameSite=None; Path=\/api\/auth\/; Max-Age=600; Secure$/)])
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
  vi.mocked(jwtVerify).mockResolvedValueOnce({ payload: { sub: 'apple-subject', nonce: 'different-nonce' } } as Awaited<ReturnType<typeof jwtVerify>>)
  let request = { method: 'POST', headers: { cookie: `bmux_apple_flow=${state}` }, async *[Symbol.asyncIterator]() { yield new URLSearchParams({ state, code: 'one-use-apple-code' }).toString() } }
  await expect(value.route(request, '/api/auth/apple/callback')).rejects.toThrow('Authentication flow unavailable')
  expect(value.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO bmux_logins'))).toBe(false)
})
