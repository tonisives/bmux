import { beforeEach, expect, it, vi } from 'vitest'
import type { LoginSession } from '../src/types'

let mocks = vi.hoisted(() => ({ readSession: vi.fn(), writeSession: vi.fn(), clearSession: vi.fn(), prompt: vi.fn(), request: vi.fn() }))
vi.mock('../src/api', () => ({ origin: 'https://remote.bmux.cc' }))
vi.mock('../src/storage', () => mocks)
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixture-auth-state-1234567890' }))
vi.mock('expo-auth-session', () => ({
  CodeChallengeMethod: { S256: 'S256' }, ResponseType: { Code: 'code' },
  AuthRequest: class {
    state: string
    codeVerifier = 'v'.repeat(64)
    constructor(config: { state: string }) { this.state = config.state; mocks.request(config) }
    getAuthRequestConfigAsync = async () => ({ codeChallenge: 'p'.repeat(43) })
    promptAsync = mocks.prompt
  },
}))
let persisted: LoginSession | undefined
let session = (owner = 'owner'): LoginSession => ({ owner, accessToken: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString(), refreshToken: 'b'.repeat(64), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })
let response = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.unstubAllGlobals()
  persisted = undefined
  mocks.readSession.mockImplementation(async () => persisted)
  mocks.writeSession.mockImplementation(async (value: LoginSession) => { persisted = value })
  mocks.clearSession.mockImplementation(async () => { persisted = undefined })
})

it('opens hosted S256 authorization and exchanges only the verified code and verifier', async () => {
  let next = session()
  let fetcher = vi.fn(async (_url: string | URL, _init?: RequestInit) => response(next))
  vi.stubGlobal('fetch', fetcher)
  mocks.prompt.mockResolvedValueOnce({ type: 'success', url: 'bmux-remote://auth/callback?state=fixture-auth-state-1234567890&code=' + 'c'.repeat(64) })
  let auth = await import('../src/auth.native')
  await auth.signIn()
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ usePKCE: true, codeChallengeMethod: 'S256', responseType: 'code' }))
  let url = new URL(mocks.prompt.mock.calls[0][1].url)
  expect(url.origin + url.pathname).toBe('https://remote.bmux.cc/api/auth/mobile/start')
  expect(url.searchParams.get('state')).toBe('fixture-auth-state-1234567890')
  expect(url.searchParams.get('code_challenge')).toBe('p'.repeat(43))
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('redirect_uri')).toBe('bmux-remote://auth/callback')
  expect(String(fetcher.mock.calls[0][0])).toBe('https://remote.bmux.cc/api/auth/mobile/exchange')
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ code: 'c'.repeat(64), codeVerifier: 'v'.repeat(64) })
  expect(persisted).toEqual(next)
})
it('does not exchange a callback from a different authorization attempt', async () => {
  let fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  mocks.prompt.mockResolvedValueOnce({ type: 'success', url: 'bmux-remote://auth/callback?state=other-state&code=' + 'c'.repeat(64) })
  let auth = await import('../src/auth.native')
  await expect(auth.signIn()).rejects.toThrow('Sign-in could not be verified')
  expect(fetcher).not.toHaveBeenCalled()
  expect(persisted).toBeUndefined()
})
it('coalesces concurrent refreshes so rotating tokens are used once', async () => {
  persisted = { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() }
  let next = { ...session(), accessToken: 'd'.repeat(64), refreshToken: 'e'.repeat(64) }
  let fetcher = vi.fn(async (_url: string | URL, _init?: RequestInit) => response(next))
  vi.stubGlobal('fetch', fetcher)
  let auth = await import('../src/auth.native')
  expect(await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()])).toEqual([next.accessToken, next.accessToken, next.accessToken])
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(String(fetcher.mock.calls[0][0])).toBe('https://remote.bmux.cc/api/auth/mobile/refresh')
  expect(persisted).toEqual(next)
})
it('revokes the rotated session and clears it when sign-out occurs during refresh', async () => {
  persisted = { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() }
  let next = { ...session(), accessToken: 'd'.repeat(64), refreshToken: 'e'.repeat(64) }
  let resolve!: (value: ReturnType<typeof response>) => void
  let deferred = new Promise<ReturnType<typeof response>>(done => { resolve = done })
  let fetcher = vi.fn(async (url: string | URL, _init?: RequestInit) => String(url).endsWith('/refresh') ? deferred : response({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  let auth = await import('../src/auth.native')
  let token = auth.accessToken()
  await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/refresh'))).toBe(true))
  let logout = auth.signOut()
  resolve(response(next))
  expect(await token).toBeUndefined()
  await logout
  let revocation = fetcher.mock.calls.find(([url]) => String(url).endsWith('/logout'))!
  expect(revocation[1]?.headers).toEqual({ Authorization: 'Bearer ' + next.accessToken })
  expect(persisted).toBeUndefined()
  expect(await auth.accessToken()).toBeUndefined()
})
it('rejects a refresh response that changes the existing owner', async () => {
  persisted = { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() }
  vi.stubGlobal('fetch', vi.fn(async () => response(session('another-owner'))))
  let auth = await import('../src/auth.native')
  await expect(auth.accessToken()).rejects.toThrow('invalid session')
  expect(persisted?.owner).toBe('owner')
})
it('clears a session rejected by the refresh service', async () => {
  persisted = { ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
  let auth = await import('../src/auth.native')
  await expect(auth.accessToken()).rejects.toThrow('Sign in to continue')
  expect(persisted).toBeUndefined()
})
