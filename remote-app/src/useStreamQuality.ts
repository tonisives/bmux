import { useEffect, useRef, useState } from 'react'
import NetInfo from '@react-native-community/netinfo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import type { RemoteNetwork, RemoteQualityMode, RemoteStreamQuality } from '../../src/shared/remote-management'
import { qualityNetwork } from './stream-quality'

export let useStreamQuality = (owner: string | undefined, readyKey: string | undefined, request: (message: Record<string, unknown>, requestId?: string) => Promise<unknown>, error: (value: string) => void) => {
  let [mode, updateMode] = useState<RemoteQualityMode>('auto')
  let [network, setNetwork] = useState<RemoteNetwork>('unknown')
  let [applied, setApplied] = useState<RemoteStreamQuality>()
  let [loaded, setLoaded] = useState(false)
  let key = useRef<string | undefined>(undefined)
  useEffect(() => {
    let active = true
    key.current = undefined; setLoaded(false); updateMode('auto')
    if (!owner) return
    void Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, owner).then(async digest => {
      let storageKey = 'bmux.remote.quality.' + digest
      let value = await AsyncStorage.getItem(storageKey)
      if (active) { key.current = storageKey; updateMode(value === 'quality' || value === 'data-saver' ? value : 'auto'); setLoaded(true) }
    }).catch(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [owner])
  useEffect(() => {
    let active = true
    let unsubscribe = NetInfo.addEventListener(state => { if (active) setNetwork(qualityNetwork(state)) })
    return () => { active = false; unsubscribe() }
  }, [])
  useEffect(() => {
    let active = true
    setApplied(undefined)
    if (!readyKey || !loaded) return
    void request({ type: 'quality', mode, network }).then(value => { if (active) setApplied(value as RemoteStreamQuality) }).catch(value => { if (active) error(value.message) })
    return () => { active = false }
  }, [readyKey, loaded, mode, network, request, error])
  return {
    mode, network, applied,
    setMode: async (value: RemoteQualityMode) => {
      updateMode(value)
      if (key.current) await AsyncStorage.setItem(key.current, value)
    },
  }
}
