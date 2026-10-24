import Constants from 'expo-constants'
import type { AccountApi } from '../../src/shared/remote-account'

export let origin = new URL(Constants.expoConfig?.extra?.remoteOrigin ?? 'https://remote.bmux.cc').origin
export let createApi = (readToken: () => Promise<string | undefined>, base = origin): AccountApi => async <T>(path: string, value?: unknown): Promise<T> => {
  let token = await readToken()
  let response = await fetch(new URL(path, base), {
    credentials: 'same-origin',
    method: value === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    let result = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(response.status === 401 ? 'Sign in to continue.' : result.error ?? 'Request unavailable.')
  }
  return response.json() as Promise<T>
}
