import { useEffect, useState } from 'react'
import { AppState, Linking, Text, View } from 'react-native'
import { origin } from '../api'
import { useRemote } from '../RemoteContext'
import { styles } from '../theme'
import { Button } from './Button'

export let AccountProviders = () => {
  let { api, setError } = useRemote()
  let [providers, setProviders] = useState<{ appleEnabled: boolean; appleLinked: boolean }>()
  useEffect(() => {
    let active = true
    let refresh = () => { void api<{ appleEnabled: boolean; appleLinked: boolean }>('/api/auth/providers').then(value => { if (active) setProviders(value) }).catch(() => {}) }
    refresh()
    let listener = AppState.addEventListener('change', state => { if (state === 'active') refresh() })
    return () => { active = false; listener.remove() }
  }, [api])
  if (!providers?.appleEnabled) return null
  return <View style={styles.card}><Text style={styles.label}>Sign-in methods</Text>{providers.appleLinked ? <Text style={styles.secondary}>Apple linked</Text> : <Button title="Link Apple" onPress={() => { void Linking.openURL(new URL('/api/auth/providers/apple/link', origin).href).catch(value => setError(value.message)) }} />}</View>
}
