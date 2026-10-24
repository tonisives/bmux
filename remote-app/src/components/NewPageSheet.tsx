import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TextInput } from 'react-native'
import * as Crypto from 'expo-crypto'
import { useRemote } from '../RemoteContext'
import { browserAddress } from '../address'
import { colors, styles } from '../theme'
import type { RemoteManagementParams, RemoteProfile } from '../../../src/shared/remote-management'
import { Button } from './Button'
import { Sheet } from './Sheet'

export let NewPageSheet = ({ visible, close, created }: { visible: boolean; close: () => void; created: () => void }) => {
  let remote = useRemote()
  let [profiles, setProfiles] = useState<RemoteProfile[]>([]), [profile, setProfile] = useState(''), [url, setUrl] = useState('')
  let [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  let operation = useRef<{ request: string; params: RemoteManagementParams['pages.create'] } | undefined>(undefined)
  let selected = remote.selection, session = remote.state?.sessions.find(item => item.id === selected?.session)
  let lease = selected && remote.state?.controls[selected.session]
  let controlling = lease?.owner === remote.viewer?.id
  useEffect(() => {
    if (!visible) return
    let active = true
    setLoading(true); setError(''); setUrl(''); setProfiles([]); operation.current = undefined
    void remote.rpc('profiles.list', {}).then(value => {
      if (active) { setProfiles(value.profiles); setProfile(session?.defaultProfileId ?? value.profiles.find(item => item.isDefault)?.id ?? '') }
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [visible, selected?.host, selected?.generation, selected?.session])
  let create = async () => {
    if (!selected || !session?.revision || !lease || !controlling || busy) return
    setBusy(true); setError('')
    try {
      let address = browserAddress(url)
      operation.current ??= { request: Crypto.randomUUID(), params: { session: selected.session, generation: lease.generation, expectedRevision: session.revision, ...(profile ? { profileId: profile } : {}), ...(address ? { url: address } : {}) } }
      if (operation.current.params.generation !== lease.generation) throw new Error('Control changed. Close this sheet and try again.')
      let target = await remote.rpc('pages.create', operation.current.params, operation.current.request)
      created()
      await remote.openTarget({ id: selected.host, generation: selected.generation }, target)
    } catch (error) {
      if ((error as { code?: string }).code === 'STALE_REVISION') { operation.current = undefined; remote.viewer?.send({ type: 'state' }) }
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  return <Sheet title="New page" visible={visible} close={close}>
    {loading ? <ActivityIndicator color={colors.accent} /> : <>
      <Text style={styles.label}>Profile</Text>
      <ScrollView horizontal contentContainerStyle={styles.row}>{profiles.map(item => <Button key={item.id} title={item.name + (item.isDefault ? ' · Default' : '')} primary={item.id === profile} disabled={busy} onPress={() => { setProfile(item.id); operation.current = undefined }} />)}</ScrollView>
      <TextInput value={url} onChangeText={value => { setUrl(value); operation.current = undefined }} editable={!busy} onSubmitEditing={() => void create()} style={styles.input} placeholder="Address (optional)" placeholderTextColor={colors.muted} accessibilityLabel="New page address" keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={2048} />
      <Button title="Create page" primary busy={busy} disabled={!controlling || !session?.revision} onPress={() => void create()} />
    </>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
  </Sheet>
}
