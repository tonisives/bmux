import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('../src/api', () => ({ origin: 'https://remote.bmux.cc' }))
let callback: (result: { access_token?: string }) => void
let cancelled: () => void
let requestAccessToken = vi.fn()
let initialize = vi.fn((options: { callback: typeof callback; error_callback: typeof cancelled }) => {
  callback = options.callback; cancelled = options.error_callback
  return { requestAccessToken }
})
let fetcher = vi.fn()
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient: initialize } } } })
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ googleClientId: 'fixture-client' }) })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

it('opens Google synchronously from the click after preparation and exchanges its token for a cookie', async () => {
  let auth = await import('../src/auth')
  await auth.prepareSignIn()
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'fixture-client', scope: 'openid email profile' }))
  let completion = auth.signIn()
  expect(requestAccessToken).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
  callback({ access_token: 'fixture-google-token' })
  await completion
  expect(fetcher).toHaveBeenLastCalledWith(new URL('https://remote.bmux.cc/api/login'), expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ accessToken: 'fixture-google-token' }) }))
})
it('allows a new attempt after a popup is cancelled or a login is rejected', async () => {
  let auth = await import('../src/auth')
  await auth.prepareSignIn()
  let first = auth.signIn()
  cancelled()
  await expect(first).rejects.toThrow('Sign-in cancelled')
  fetcher.mockResolvedValueOnce({ ok: false })
  let second = auth.signIn()
  callback({ access_token: 'rejected-token' })
  await expect(second).rejects.toThrow('Sign-in failed')
  let third = auth.signIn()
  callback({ access_token: 'accepted-token' })
  await third
  expect(requestAccessToken).toHaveBeenCalledTimes(3)
})
it('coalesces preparation and retries a failed configuration request', async () => {
  let auth = await import('../src/auth')
  fetcher.mockResolvedValueOnce({ ok: false })
  let first = auth.prepareSignIn()
  expect(auth.prepareSignIn()).toBe(first)
  await expect(first).rejects.toThrow('Sign-in unavailable')
  await auth.prepareSignIn()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(initialize).toHaveBeenCalledTimes(1)
})
