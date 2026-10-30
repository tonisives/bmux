import { origin } from './api'

export let accessToken = async (): Promise<string | undefined> => undefined

type GoogleWindow = Window & { google?: { accounts: { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (result: { access_token?: string }) => void; error_callback: () => void }) => { requestAccessToken: () => void } } } } }
let client: { requestAccessToken: () => void } | undefined
let preparing: Promise<{ appleEnabled: boolean }> | undefined
let pending: { resolve: () => void; reject: (error: Error) => void } | undefined
let prepare = async () => {
  let response = await fetch(new URL('/api/config', origin))
  if (!response.ok) throw new Error('Sign-in unavailable.')
  let config = await response.json() as { googleClientId: string; appleEnabled?: boolean }
  let google = (window as GoogleWindow).google
  if (!google) {
    await new Promise<void>((resolve, reject) => {
      let script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? ''
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Sign-in could not load.'))
      document.head.appendChild(script)
    })
    google = (window as GoogleWindow).google
  }
  if (!google || !config.googleClientId) throw new Error('Sign-in unavailable.')
  client = google.accounts.oauth2.initTokenClient({
    client_id: config.googleClientId, scope: 'openid email profile',
    callback: result => {
      let attempt = pending
      if (!attempt) return
      if (!result.access_token) { pending = undefined; attempt.reject(new Error('Sign-in cancelled.')); return }
      void fetch(new URL('/api/login', origin), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: result.access_token }) })
        .then(response => { if (!response.ok) throw new Error('Sign-in failed.'); pending = undefined; attempt.resolve() }).catch(error => { pending = undefined; attempt.reject(error) })
    },
    error_callback: () => { let attempt = pending; pending = undefined; attempt?.reject(new Error('Sign-in cancelled.')) },
  })
  return { appleEnabled: config.appleEnabled === true }
}
export let prepareSignIn = () => {
  preparing ??= prepare().catch(error => { preparing = undefined; throw error })
  return preparing
}
export let signIn = (provider: 'google' | 'apple' = 'google'): Promise<void> => {
  if (provider === 'apple') { window.location.assign(new URL('/api/auth/apple/start', origin).href); return Promise.resolve() }
  if (!client) return Promise.reject(new Error('Sign-in is still loading. Please try again.'))
  if (pending) return Promise.reject(new Error('Sign-in is already open.'))
  return new Promise<void>((resolve, reject) => {
    pending = { resolve, reject }
    try { client!.requestAccessToken() }
    catch (error) { pending = undefined; reject(error) }
  })
}
export let signOut = async () => {
  let response = await fetch(new URL('/api/logout', origin), { method: 'POST', credentials: 'same-origin' })
  if (!response.ok) throw new Error('Sign-out unavailable.')
}
