import { AuthRequest, CodeChallengeMethod, ResponseType } from 'expo-auth-session'
import * as Crypto from 'expo-crypto'
import { origin } from './api'
import { authCode, authRedirect, issuedSession, mobileAuthEndpoints } from './auth-protocol'
import { clearSession, readSession, writeSession } from './storage'
import type { RemoteNativeExchange, RemoteNativeRefresh } from '../../src/shared/remote-mobile-auth'
import type { LoginSession } from './types'

let endpoints = mobileAuthEndpoints(origin)
let revision = 0
let refreshing: Promise<string | undefined> | undefined
let signingIn = false, signingOut = false
export let prepareSignIn = async () => {}
let exchange = async (endpoint: string, body: RemoteNativeExchange | RemoteNativeRefresh) => {
  let response = await fetch(endpoint, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Object.assign(new Error(response.status === 400 || response.status === 401 ? 'Sign in to continue.' : 'The account service is unavailable.'), { status: response.status })
  return response.json() as Promise<unknown>
}
export let signIn = async (): Promise<void> => {
  if (signingIn || signingOut) return
  signingIn = true
  let attempt = ++revision
  try {
    let request = new AuthRequest({ clientId: 'bmux-remote', state: Crypto.randomUUID(), redirectUri: authRedirect, responseType: ResponseType.Code, usePKCE: true, codeChallengeMethod: CodeChallengeMethod.S256 })
    let config = await request.getAuthRequestConfigAsync()
    if (!config.codeChallenge || !request.codeVerifier) throw new Error('Sign-in could not be started.')
    let url = new URL(endpoints.start)
    url.search = new URLSearchParams({ state: request.state, code_challenge: config.codeChallenge, code_challenge_method: 'S256', redirect_uri: authRedirect, provider: 'google' }).toString()
    let result = await request.promptAsync({ authorizationEndpoint: endpoints.start }, { url: url.href })
    if (result.type === 'cancel' || result.type === 'dismiss') return
    if (result.type !== 'success') throw new Error('Sign-in could not be verified. Please try again.')
    let code = authCode(result.url, request.state)
    let session = issuedSession(await exchange(endpoints.exchange, { code, codeVerifier: request.codeVerifier }))
    if (revision === attempt && !signingOut) await writeSession(session)
  } finally { signingIn = false }
}
export let accessToken = async (): Promise<string | undefined> => {
  if (signingOut) return
  if (refreshing) return refreshing
  let attempt = revision
  let current = (async () => {
    let session = await readSession()
    if (!session || attempt !== revision || signingOut) return
    if (Date.parse(session.expiresAt) > Date.now() + 60000) return session.accessToken
    if (Date.parse(session.refreshExpiresAt) <= Date.now()) {
      if (Date.parse(session.expiresAt) > Date.now()) return session.accessToken
      await clearSession(); return
    }
    try {
      let next = issuedSession(await exchange(endpoints.refresh, { refreshToken: session.refreshToken }), session.owner)
      if (attempt !== revision) return
      await writeSession(next)
      return signingOut ? undefined : next.accessToken
    } catch (error) {
      let status = (error as { status?: number }).status
      if (attempt === revision && (status === 400 || status === 401)) await clearSession()
      throw error
    }
  })()
  refreshing = current
  void current.finally(() => { if (refreshing === current) refreshing = undefined }).catch(() => {})
  return refreshing
}
export let signOut = async (): Promise<void> => {
  if (signingOut) return
  signingOut = true
  try {
    await refreshing?.catch(() => {})
    revision++
    let session: LoginSession | undefined = await readSession()
    if (!session) return
    if (Date.parse(session.expiresAt) <= Date.now() && Date.parse(session.refreshExpiresAt) > Date.now()) session = issuedSession(await exchange(endpoints.refresh, { refreshToken: session.refreshToken }), session.owner)
    let response = await fetch(endpoints.logout, { method: 'POST', credentials: 'omit', headers: { Authorization: 'Bearer ' + session.accessToken }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Server sign-out could not be confirmed. Local sign-out is complete.')
  } finally { try { await clearSession() } finally { signingOut = false } }
}
