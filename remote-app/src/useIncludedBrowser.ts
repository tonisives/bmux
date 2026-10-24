import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import type { AccountApi, IncludedBrowser } from '../../src/shared/remote-account'
import type { Host } from './types'

export let useIncludedBrowser = (owner: string | undefined, api: AccountApi, watch: (host: Pick<Host, 'id' | 'generation'>, target: { session: string; pane: string }) => Promise<void>) => {
  let [browser, setBrowser] = useState<IncludedBrowser>()
  let [opening, setOpening] = useState(false), [error, setError] = useState('')
  let currentOwner = useRef(owner), intent = useRef(false), key = useRef(''), starting = useRef(false)
  currentOwner.current = owner
  let update = useCallback((value: IncludedBrowser, expectedOwner: string) => {
    if (currentOwner.current !== expectedOwner) return
    setBrowser(current => current && current.revision > value.revision ? current : value)
  }, [])
  let refresh = useCallback(async () => {
    let current = currentOwner.current
    if (!current) return
    let value = await api<IncludedBrowser>('/api/hosted-browser')
    update(value, current)
  }, [api, update])
  useEffect(() => {
    let active = true
    intent.current = false; starting.current = false; key.current = ''; setBrowser(undefined); setOpening(false); setError('')
    if (!owner) return
    void Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, owner).then(value => { if (active) key.current = 'bmux.remote.browser-open.' + value })
    void refresh().catch(() => {})
    return () => { active = false }
  }, [owner, refresh])
  useEffect(() => {
    if (!owner || !browser) return
    let pending = browser.state === 'starting' || browser.state === 'waking'
    let timer = setInterval(() => { if (AppState.currentState !== 'background') void refresh().catch(() => {}) }, pending ? Math.max(1000, Math.min(browser.retryAfterMs ?? 3000, 15000)) : 15000)
    return () => clearInterval(timer)
  }, [owner, browser?.state, browser?.retryAfterMs, refresh])
  useEffect(() => {
    if (!owner || !browser || !intent.current || starting.current) return
    if (browser.state === 'error' || browser.state === 'suspended' || !browser.entitled) {
      intent.current = false; setOpening(false); setError(browser.error?.message ?? (browser.entitled ? 'The browser is unavailable. Try again later.' : 'An active relay subscription is required.'))
      if (key.current) void AsyncStorage.removeItem(key.current)
      return
    }
    if (!browser.target || browser.state !== 'running' || AppState.currentState === 'background') return
    let current = owner, target = browser.target
    intent.current = false; starting.current = true
    void watch({ id: target.host, generation: target.generation }, target).then(async () => { if (currentOwner.current === current && key.current) await AsyncStorage.removeItem(key.current) }).catch(value => { if (currentOwner.current === current) setError(value.message) }).finally(() => { if (currentOwner.current === current) { starting.current = false; setOpening(false) } })
  }, [owner, browser, watch])
  useEffect(() => {
    let listener = AppState.addEventListener('change', state => {
      if (state === 'background') { intent.current = false; setOpening(false) }
      if (state === 'active') void refresh().catch(() => {})
    })
    return () => listener.remove()
  }, [refresh])
  return {
    browser, opening, error,
    open: async () => {
      let current = currentOwner.current
      if (!current || opening || starting.current) return
      intent.current = true; setOpening(true); setError('')
      try {
        let storageKey = key.current || 'bmux.remote.browser-open.' + await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, current)
        let requestId = await AsyncStorage.getItem(storageKey) || Crypto.randomUUID()
        await AsyncStorage.setItem(storageKey, requestId)
        if (currentOwner.current !== current) return
        key.current = storageKey
        update(await api<IncludedBrowser>('/api/hosted-browser/open', { requestId }), current)
      } catch (error) { if (currentOwner.current === current) { intent.current = false; setOpening(false); setError((error as Error).message) } }
    },
    refresh,
  }
}
