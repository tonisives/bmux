import { AuthRequest, CodeChallengeMethod, ResponseType } from 'expo-auth-session'
import { origin } from './api'
import { authCode, authRedirect, issuedSession, nativeAuth } from './auth-protocol'
import { clearSession, readSession, writeSession } from './storage'
import type { LoginSession } from './types'

let revision = 0
let refreshing: Promise<string | undefined> | undefined
let signingIn = false
let configuration = async () => {
  let response = await fetch(new URL('/api/config', origin), { credentials: 'omit', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('The account service is unavailable.')
  let config = await response.json() as { nativeAuth?: unknown }
  return nativeAuth(config.nativeAuth, origin)
}
let exchange = async (endpoint: string, body: Record<string, string>) => {
  let response = await fetch(endpoint, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  if (!response.ok) {
    let error = new Error(response.status === 400 || response.status === 401 ? 'Sign in to continue.' : 'The account service is unavailable.')
    Object.assign(error, { status: response.status })
    throw error
  }
  return response.json() as Promise<unknown>
}
export let signIn = async (): Promise<void> => {
  if (signingIn) return
  signingIn = true
  let attempt = ++revision
  try {
    let config = await configuration()
    let request = new AuthRequest({ clientId: config.clientId, redirectUri: authRedirect, responseType: ResponseType.Code, usePKCE: true, codeChallengeMethod: CodeChallengeMethod.S256, scopes: ['openid', 'email', 'profile'] })
    let result = await request.promptAsync({ authorizationEndpoint: config.authorizationEndpoint })
    if (result.type === 'cancel' || result.type === 'dismiss') return
    if (result.type !== 'success' || !request.codeVerifier) throw new Error('Sign-in could not be verified. Please try again.')
    let code = authCode(result.url, request.state)
    let session = issuedSession(await exchange(config.tokenEndpoint, { grant_type: 'authorization_code', client_id: config.clientId, code, code_verifier: request.codeVerifier, redirect_uri: authRedirect }))
    if (revision === attempt) await writeSession(session)
  } finally { signingIn = false }
}
export let accessToken = async (): Promise<string | undefined> => {
  if (refreshing) return refreshing
  let attempt = revision
  let current = (async () => {
    let session = await readSession()
    if (!session || attempt !== revision) return
    if (Date.parse(session.expiresAt) > Date.now() + 60000) return session.accessToken
    if (!session.refreshToken || !session.refreshExpiresAt || Date.parse(session.refreshExpiresAt) <= Date.now()) {
      if (Date.parse(session.expiresAt) > Date.now()) return session.accessToken
      await clearSession()
      return
    }
    try {
      let config = await configuration()
      let next = issuedSession(await exchange(config.tokenEndpoint, { grant_type: 'refresh_token', client_id: config.clientId, refresh_token: session.refreshToken! }), session.owner)
      if (attempt !== revision) return
      await writeSession(next)
      return next.accessToken
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
  revision++
  await refreshing?.catch(() => {})
  let session: LoginSession | undefined = await readSession()
  try {
    if (!session) return
    let config = await configuration()
    let response = await fetch(config.revocationEndpoint, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: config.clientId, token: session.refreshToken ?? session.accessToken, token_type_hint: session.refreshToken ? 'refresh_token' : 'access_token' }), signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Server sign-out could not be confirmed. Local sign-out is complete.')
  } finally { await clearSession() }
}
