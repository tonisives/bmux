import * as SecureStore from 'expo-secure-store'
import type { LoginSession } from './types'
import { storedSession } from './auth-protocol'

let sessionKey = 'bmux.remote.session'
export let readSession = async (): Promise<LoginSession | undefined> => {
  let value = await SecureStore.getItemAsync(sessionKey)
  if (!value) return
  try {
    let session = storedSession(JSON.parse(value))
    if (session) return session
  } catch {}
  await clearSession()
}
export let writeSession = (session: LoginSession) => SecureStore.setItemAsync(sessionKey, JSON.stringify(session))
export let clearSession = () => SecureStore.deleteItemAsync(sessionKey)
export let readSecret = (key: string) => SecureStore.getItemAsync(key)
export let writeSecret = (key: string, value: string) => SecureStore.setItemAsync(key, value)
