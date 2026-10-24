import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { useRemote } from '../RemoteContext'
import { browserAddress } from '../address'
import { colors, styles } from '../theme'
import type { Host } from '../types'
import type { RemoteProfile } from '../../../src/shared/remote-management'
import { Button } from './Button'
import { Sheet } from './Sheet'

export let NewSessionSheet = ({ host, close, created }: { host?: Host; close: () => void; created: () => void }) => {
  let remote = useRemote()
  let [profiles, setProfiles] = useState<RemoteProfile[]>([])
  let [profile, setProfile] = useState('')
  let [name, setName] = useState(''), [url, setUrl] = useState('')
  let [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  let request = useRef('')
  useEffect(() => {
    if (!host) return
    let active = true
    setLoading(true); setError(''); setName(''); setUrl(''); setProfile(''); setProfiles([]); request.current = ''
    void (host.capabilities?.profiles === 1 ? remote.profiles(host) : remote.manage(host).then(() => [] as RemoteProfile[])).then(value => {
      if (active) { setProfiles(value); setProfile(value.find(item => item.isDefault)?.id ?? '') }
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [host?.id, host?.generation])
  let create = async () => {
    if (!host || busy) return
    setBusy(true); setError('')
    try {
      let address = browserAddress(url)
      request.current ||= Crypto.randomUUID()
      let target = await remote.rpc('sessions.create', { ...(name.trim() ? { name: name.trim() } : {}), ...(profile ? { profileId: profile } : {}), ...(address ? { url: address } : {}) }, request.current)
      created()
      await remote.openTarget(host, target)
    } catch (error) { setError((error as Error).message); remote.setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Sheet title="New session" visible={!!host} close={close}>
    <Text style={styles.secondary}>{host?.service}</Text>
    {loading ? <ActivityIndicator color={colors.accent} /> : <>
      <Text style={styles.label}>Profile</Text>
      <ScrollView horizontal contentContainerStyle={styles.row}>
        {profiles.length ? profiles.map(item => <Button key={item.id} title={item.name + (item.isDefault ? ' · Default' : '')} primary={item.id === profile} onPress={() => { setProfile(item.id); request.current = '' }} />) : <Text style={styles.text}>Default profile</Text>}
      </ScrollView>
      <TextInput value={name} onChangeText={value => { setName(value); request.current = '' }} style={styles.input} placeholder="Session name (optional)" placeholderTextColor={colors.muted} accessibilityLabel="Session name" maxLength={80} />
      <TextInput value={url} onChangeText={value => { setUrl(value); request.current = '' }} style={styles.input} placeholder="Address (optional)" placeholderTextColor={colors.muted} accessibilityLabel="New session address" keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={2048} onSubmitEditing={() => void create()} />
      <Button title="Create session" primary busy={busy} onPress={() => void create()} />
    </>}
    {!!error && <View><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text></View>}
  </Sheet>
}
