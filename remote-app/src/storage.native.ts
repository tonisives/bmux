import * as SecureStore from 'expo-secure-store'
import type { LoginSession } from './types'

let sessionKey = 'bmux.remote.session'
export let readSession = async (): Promise<LoginSession | undefined> => {
  let value = await SecureStore.getItemAsync(sessionKey)
  if (!value) return
  try {
    let session = JSON.parse(value) as LoginSession
    let expires = Date.parse(session.expiresAt)
    if (/^[a-f0-9]{64}$/.test(session.accessToken) && typeof session.owner === 'string' && session.owner && Number.isFinite(expires) && expires > Date.now()) return session
  } catch {}
  await clearSession()
}
export let writeSession = (session: LoginSession) => SecureStore.setItemAsync(sessionKey, JSON.stringify(session))
export let clearSession = () => SecureStore.deleteItemAsync(sessionKey)
export let readSecret = (key: string) => SecureStore.getItemAsync(key)
export let writeSecret = (key: string, value: string) => SecureStore.setItemAsync(key, value)
