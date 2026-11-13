import { useEffect, useRef, useState } from 'react'
import { api } from './client'

export let useGoogleLogin = (success: () => Promise<void> | void, failure: (error: unknown) => void) => {
  let [ready, setReady] = useState(false)
  let client = useRef<{ requestAccessToken: () => void } | undefined>(undefined), callbacks = useRef({ success, failure })
  callbacks.current = { success, failure }
  useEffect(() => {
    let cancelled = false, script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true
    script.nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? ''
    script.onload = () => { void api('/api/config').then(config => {
      if (cancelled) return
      let google = (window as any).google
      client.current = google.accounts.oauth2.initTokenClient({ client_id: config.googleClientId, scope: 'openid email', error_callback: () => callbacks.current.failure(new Error('Google sign-in closed. Try again.')), callback: (response: { access_token?: string }) => {
        if (!response.access_token) { callbacks.current.failure(new Error('Google sign-in failed. Try again.')); return }
        void api('/api/login', { accessToken: response.access_token }).then(() => callbacks.current.success()).catch(error => callbacks.current.failure(error))
      } })
      setReady(true)
    }).catch(error => callbacks.current.failure(error)) }
    script.onerror = () => callbacks.current.failure(new Error('Google sign-in could not load. Try again.'))
    document.head.append(script)
    return () => { cancelled = true; script.remove() }
  }, [])
  return { ready, signIn: () => client.current?.requestAccessToken() }
}
