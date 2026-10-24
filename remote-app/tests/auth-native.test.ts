import { beforeEach, expect, it, vi } from 'vitest'

let mocks = vi.hoisted(() => ({ readSession: vi.fn(), writeSession: vi.fn(async () => {}), clearSession: vi.fn(async () => {}), prompt: vi.fn(), request: vi.fn() }))
vi.mock('../src/api', () => ({ origin: 'https://remote.bmux.cc' }))
vi.mock('../src/storage', () => mocks)
vi.mock('expo-auth-session', () => ({
  CodeChallengeMethod: { S256: 'S256' }, ResponseType: { Code: 'code' },
  AuthRequest: class {
    state = 'original-state'
    codeVerifier = 'v'.repeat(64)
    constructor(config: unknown) { mocks.request(config) }
    promptAsync = mocks.prompt
  },
}))
let config = { nativeAuth: { protocol: 1, clientId: 'bmux-remote', authorizationEndpoint: '/api/auth/authorize', tokenEndpoint: '/api/auth/token', revocationEndpoint: '/api/auth/revoke' } }
let session = (owner = 'owner') => ({ owner, accessToken: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString(), refreshToken: 'b'.repeat(64), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })
let response = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('exchanges a verified PKCE callback and stores only the issued account session', async () => {
  let next = session()
  let fetcher = vi.fn(async (url: string | URL) => response(String(url).endsWith('/api/config') ? config : next))
  vi.stubGlobal('fetch', fetcher)
  mocks.prompt.mockResolvedValueOnce({ type: 'success', url: 'bmux-remote://auth/callback?state=original-state&code=' + 'c'.repeat(64) })
  let auth = await import('../src/auth.native')
  await auth.signIn()
  expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ usePKCE: true, codeChallengeMethod: 'S256', responseType: 'code' }))
  let exchange = fetcher.mock.calls.find(([url]) => String(url).endsWith('/api/auth/token'))
  expect(JSON.parse((exchange as unknown as [string, RequestInit])[1].body as string)).toEqual({ grant_type: 'authorization_code', client_id: 'bmux-remote', code: 'c'.repeat(64), code_verifier: 'v'.repeat(64), redirect_uri: 'bmux-remote://auth/callback' })
  expect(mocks.writeSession).toHaveBeenCalledWith(next)
})
it('does not exchange a callback from a different authorization attempt', async () => {
  let fetcher = vi.fn(async () => response(config))
  vi.stubGlobal('fetch', fetcher)
  mocks.prompt.mockResolvedValueOnce({ type: 'success', url: 'bmux-remote://auth/callback?state=other-state&code=' + 'c'.repeat(64) })
  let auth = await import('../src/auth.native')
  await expect(auth.signIn()).rejects.toThrow('Sign-in could not be verified')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(mocks.writeSession).not.toHaveBeenCalled()
})
it('coalesces concurrent refreshes so rotating tokens are used once', async () => {
  mocks.readSession.mockResolvedValue({ ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() })
  let next = { ...session(), accessToken: 'd'.repeat(64), refreshToken: 'e'.repeat(64) }
  let fetcher = vi.fn(async (url: string | URL) => response(String(url).endsWith('/api/config') ? config : next))
  vi.stubGlobal('fetch', fetcher)
  let auth = await import('../src/auth.native')
  expect(await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()])).toEqual([next.accessToken, next.accessToken, next.accessToken])
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/token'))).toHaveLength(1)
  expect(mocks.writeSession).toHaveBeenCalledTimes(1)
})
it('does not restore a session when sign-out occurs during refresh', async () => {
  mocks.readSession.mockResolvedValue({ ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() })
  let resolve!: (value: ReturnType<typeof response>) => void
  let deferred = new Promise<ReturnType<typeof response>>(done => { resolve = done })
  let fetcher = vi.fn(async (url: string | URL) => String(url).endsWith('/api/auth/token') ? deferred : response(config))
  vi.stubGlobal('fetch', fetcher)
  let auth = await import('../src/auth.native')
  let token = auth.accessToken()
  await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/api/auth/token'))).toBe(true))
  let logout = auth.signOut()
  resolve(response(session()))
  expect(await token).toBeUndefined()
  await logout
  expect(mocks.writeSession).not.toHaveBeenCalled()
  expect(mocks.clearSession).toHaveBeenCalledTimes(1)
})
it('rejects a refresh response that changes the existing owner', async () => {
  mocks.readSession.mockResolvedValue({ ...session(), expiresAt: new Date(Date.now() - 1000).toISOString() })
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => response(String(url).endsWith('/api/config') ? config : session('another-owner'))))
  let auth = await import('../src/auth.native')
  await expect(auth.accessToken()).rejects.toThrow('invalid session')
  expect(mocks.writeSession).not.toHaveBeenCalled()
})
