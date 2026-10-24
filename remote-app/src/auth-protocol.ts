import type { LoginSession } from './types'

export let authRedirect = 'bmux-remote://auth/callback'
export type NativeAuth = { protocol: 1; clientId: string; authorizationEndpoint: string; tokenEndpoint: string; revocationEndpoint: string }
let tokenPattern = /^[a-f0-9]{64}$/
let future = (value: unknown, now: number) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now
export let storedSession = (value: unknown, now = Date.now()): LoginSession | undefined => {
  if (!value || typeof value !== 'object') return
  let session = value as LoginSession
  if (typeof session.owner !== 'string' || !session.owner || !tokenPattern.test(session.accessToken) || typeof session.expiresAt !== 'string' || !Number.isFinite(Date.parse(session.expiresAt))) return
  let refreshable = typeof session.refreshToken === 'string' && tokenPattern.test(session.refreshToken) && future(session.refreshExpiresAt, now)
  if (future(session.expiresAt, now) || refreshable) return session
}
export let issuedSession = (value: unknown, owner?: string): LoginSession => {
  let session = storedSession(value)
  if (!session || !future(session.expiresAt, Date.now()) || !session.refreshToken || !tokenPattern.test(session.refreshToken) || !future(session.refreshExpiresAt, Date.now()) || (owner && session.owner !== owner)) throw new Error('The account service returned an invalid session.')
  return session
}
export let nativeAuth = (value: unknown, origin: string): NativeAuth => {
  if (!value || typeof value !== 'object') throw new Error('Mobile sign-in is unavailable. Try again later.')
  let config = value as NativeAuth
  if (config.protocol !== 1 || config.clientId !== 'bmux-remote') throw new Error('Mobile sign-in is unavailable. Try again later.')
  let endpoint = (path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid account service configuration.')
    let url = new URL(path, origin)
    let local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.origin !== new URL(origin).origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/api/')) throw new Error('Invalid account service configuration.')
    return url.href
  }
  return { protocol: 1, clientId: config.clientId, authorizationEndpoint: endpoint(config.authorizationEndpoint), tokenEndpoint: endpoint(config.tokenEndpoint), revocationEndpoint: endpoint(config.revocationEndpoint) }
}
export let authCode = (value: string, state: string) => {
  let url = new URL(value), expected = new URL(authRedirect)
  if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname || url.hash || url.username || url.password || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state || url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1) throw new Error('Sign-in could not be verified. Please try again.')
  let code = url.searchParams.get('code')
  if (!code || !/^[a-zA-Z0-9._~-]{16,512}$/.test(code)) throw new Error('Sign-in could not be verified. Please try again.')
  return code
}
