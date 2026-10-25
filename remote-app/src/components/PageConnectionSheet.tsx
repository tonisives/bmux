import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { useRemote } from '../RemoteContext'
import { colors, styles } from '../theme'
import type { RemoteManagementParams, RemoteProfile } from '../../../src/shared/remote-management'
import { Button } from './Button'
import { Sheet } from './Sheet'

export let PageConnectionSheet = ({ visible, close, reopened }: { visible: boolean; close: () => void; reopened: () => void }) => {
  let remote = useRemote()
  let selected = remote.selection, session = remote.state?.sessions.find(item => item.id === selected?.session)
  let pane = session?.windows.flatMap(item => item.panes).find(item => item.id === selected?.pane)
  let lease = selected && remote.state?.controls[selected.session]
  let controlling = !!lease && lease.owner === remote.viewer?.id
  let [profile, setProfile] = useState<RemoteProfile>(), [connection, setConnection] = useState('')
  let [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  let operation = useRef<{ request: string; params: RemoteManagementParams['pages.reopen'] } | undefined>(undefined)
  useEffect(() => {
    if (!visible) return
    let active = true
    setLoading(true); setProfile(undefined); setError(''); operation.current = undefined
    void remote.rpc('profiles.list', {}).then(value => {
      if (!active) return
      let profile = value.profiles.find(item => item.id === pane?.profileId)
      if (!profile) throw new Error('This page’s profile is no longer available.')
      setProfile(profile); setConnection(profile.defaultConnectionId)
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [visible, selected?.host, selected?.generation, selected?.session, selected?.pane])
  let apply = async () => {
    if (!selected || !session?.revision || !profile || !lease || !controlling || busy) return
    setBusy(true); setError('')
    try {
      operation.current ??= { request: Crypto.randomUUID(), params: { session: selected.session, pane: selected.pane, generation: lease.generation, expectedRevision: session.revision, profileId: profile.id, connectionId: connection } }
      if (operation.current.params.generation !== lease.generation) throw new Error('Control changed. Close this sheet and try again.')
      let target = await remote.rpc('pages.reopen', operation.current.params, operation.current.request)
      reopened()
      await remote.openTarget({ id: selected.host, generation: selected.generation }, target)
    } catch (error) {
      if ((error as { code?: string }).code === 'STALE_REVISION') { operation.current = undefined; remote.viewer?.send({ type: 'state' }) }
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  return <Sheet title="Page connection" visible={visible} close={close}>
    {loading ? <ActivityIndicator color={colors.accent} /> : profile && <>
      <Text style={styles.label}>{profile.name}</Text>
      {profile.connections.map(item => <View key={item.id} style={{ gap: 4 }}>
        <Button title={(item.proxy ? item.proxy.host + ':' + item.proxy.port : 'Direct') + (item.id === profile.defaultConnectionId ? ' · Default' : '')} primary={connection === item.id} disabled={busy} onPress={() => { setConnection(item.id); operation.current = undefined }} />
        {item.id === pane?.connectionId && <Text style={styles.secondary}>Current connection</Text>}
      </View>)}
      <Text style={styles.secondary}>Reopening reloads this page with the selected connection.</Text>
      <Button title="Reopen page" primary busy={busy} disabled={!controlling || !session?.revision || connection === pane?.connectionId} onPress={() => void apply()} />
    </>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
  </Sheet>
}
