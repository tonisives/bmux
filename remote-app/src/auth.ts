import { origin } from './api'

type GoogleWindow = Window & { google?: { accounts: { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (result: { access_token?: string }) => void; error_callback: () => void }) => { requestAccessToken: () => void } } } } }
export let signIn = async () => {
  let config = await fetch(new URL('/api/config', origin)).then(value => value.json()) as { googleClientId: string }
  let google = (window as GoogleWindow).google
  if (!google) {
    await new Promise<void>((resolve, reject) => {
      let script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Sign-in could not load.'))
      document.head.appendChild(script)
    })
    google = (window as GoogleWindow).google
  }
  let client = google
  if (!client) throw new Error('Sign-in unavailable.')
  await new Promise<void>((resolve, reject) => client.accounts.oauth2.initTokenClient({
    client_id: config.googleClientId, scope: 'openid email profile',
    callback: result => {
      if (!result.access_token) { reject(new Error('Sign-in cancelled.')); return }
      void fetch(new URL('/api/login', origin), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: result.access_token }) })
        .then(response => { if (!response.ok) throw new Error('Sign-in failed.'); resolve() }).catch(reject)
    },
    error_callback: () => reject(new Error('Sign-in cancelled.')),
  }).requestAccessToken())
}
export let signOut = async () => {
  let response = await fetch(new URL('/api/logout', origin), { method: 'POST', credentials: 'same-origin' })
  if (!response.ok) throw new Error('Sign-out unavailable.')
}
