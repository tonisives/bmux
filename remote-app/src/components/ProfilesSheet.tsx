import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { useRemote } from '../RemoteContext'
import { proxyDraft } from '../proxy'
import { colors, styles } from '../theme'
import type { Host } from '../types'
import type { RemoteManagementResults, RemoteProfile, RemoteProxy, RemoteProxyCredentials } from '../../../src/shared/remote-management'
import { Button } from './Button'
import { Sheet } from './Sheet'

export let ProfilesSheet = ({ host, close }: { host?: Host; close: () => void }) => {
  let remote = useRemote()
  let [profiles, setProfiles] = useState<RemoteProfile[]>([]), [selected, setSelected] = useState('')
  let [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  let [enabled, setEnabled] = useState(false), [protocol, setProtocol] = useState<RemoteProxy['protocol']>('http')
  let [address, setAddress] = useState(''), [port, setPort] = useState('')
  let [credentials, setCredentials] = useState<RemoteProxyCredentials['action']>('keep'), [username, setUsername] = useState(''), [password, setPassword] = useState('')
  let [test, setTest] = useState<RemoteManagementResults['profiles.proxy.test']>()
  let request = useRef('')
  let currentHost = useRef('')
  currentHost.current = host ? host.id + ':' + host.generation : ''
  let profile = profiles.find(item => item.id === selected)
  let connection = profile?.connections.find(item => item.id === profile.defaultConnectionId)
  let editable = host?.permission === 'control' && host.capabilities?.proxy === 1 && !profile?.proxyLocked
  let changed = () => { request.current = ''; setTest(undefined); setNotice(''); setError('') }
  let load = async () => {
    if (!host) return
    let key = currentHost.current
    setLoading(true); setError('')
    try { let value = await remote.profiles(host); if (currentHost.current === key) { setProfiles(value); setSelected(value.find(item => item.isDefault)?.id ?? value[0]?.id ?? '') } }
    catch (error) { if (currentHost.current === key) setError((error as Error).message) }
    finally { if (currentHost.current === key) setLoading(false) }
  }
  useEffect(() => {
    setProfiles([]); setSelected(''); setUsername(''); setPassword(''); setNotice(''); setTest(undefined)
    if (host) void load()
  }, [host?.id, host?.generation])
  useEffect(() => {
    setEnabled(!!connection?.proxy); setProtocol(connection?.proxy?.protocol ?? 'http'); setAddress(connection?.proxy?.host ?? ''); setPort(String(connection?.proxy?.port ?? 8080))
    setCredentials(connection?.credentialsPresent ? 'keep' : 'clear'); setUsername(''); setPassword(''); request.current = ''; setTest(undefined); setError('')
  }, [profile?.id, profile?.revision])
  useEffect(() => { setNotice('') }, [profile?.id])
  let draft = () => proxyDraft(protocol, address, port, credentials, !!connection?.credentialsPresent, username, password)
  let save = async () => {
    if (!profile || !editable) return
    setBusy(true); setError('')
    try {
      let params = enabled ? draft() : { proxy: null, credentials: { action: 'clear' as const } }
      if (params.credentials.action === 'replace' && !profile.credentialStorageAvailable) throw new Error('Credential storage is unavailable on this host.')
      request.current ||= Crypto.randomUUID()
      let result = await remote.rpc('profiles.proxy.set', { profileId: profile.id, expectedRevision: profile.revision, ...params }, request.current)
      setProfiles(items => items.map(item => item.id === result.profile.id ? result.profile : item)); setUsername(''); setPassword('')
      setNotice('Saved for new pages.'); request.current = ''
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  let check = async () => {
    if (!profile) return
    setBusy(true); setError(''); setTest(undefined)
    try {
      let result = await remote.rpc('profiles.proxy.test', { profileId: profile.id, expectedRevision: profile.revision, ...(enabled && editable ? { draft: draft() } : { connectionId: profile.defaultConnectionId }) })
      setTest(result)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Sheet title="Profiles" visible={!!host} close={close}>
    <Text style={styles.secondary}>{host?.service}</Text>
    {loading ? <ActivityIndicator color={colors.accent} /> : profiles.length ? <>
      <ScrollView horizontal contentContainerStyle={styles.row}>{profiles.map(item => <Button key={item.id} title={item.name + (item.isDefault ? ' · Default' : '')} primary={item.id === selected} disabled={busy} onPress={() => setSelected(item.id)} />)}</ScrollView>
      <Text style={styles.label}>Connection for new pages</Text>
      <View style={styles.row}><Button title="Direct" primary={!enabled} disabled={!editable || busy} onPress={() => { setEnabled(false); changed() }} /><Button title="Proxy" primary={enabled} disabled={!editable || busy} onPress={() => { setEnabled(true); changed() }} /></View>
      {enabled && <>
        <View style={styles.row}>{(['http', 'https', 'socks5'] as const).map(value => <Button key={value} title={value.toUpperCase()} primary={protocol === value} disabled={!editable || busy} onPress={() => { setProtocol(value); changed() }} />)}</View>
        <TextInput value={address} onChangeText={value => { setAddress(value); changed() }} editable={editable && !busy} style={styles.input} placeholder="Proxy host" placeholderTextColor={colors.muted} accessibilityLabel="Proxy host" autoCapitalize="none" autoCorrect={false} maxLength={253} />
        <TextInput value={port} onChangeText={value => { setPort(value); changed() }} editable={editable && !busy} style={styles.input} placeholder="Port" placeholderTextColor={colors.muted} accessibilityLabel="Proxy port" keyboardType="number-pad" maxLength={5} />
        <Text style={styles.label}>Authentication</Text>
        <View style={styles.row}>{(connection?.credentialsPresent ? ['keep', 'replace', 'clear'] as const : ['clear', 'replace'] as const).map(value => <Button key={value} title={value === 'keep' ? 'Keep saved' : value === 'replace' ? 'Set credentials' : 'None'} primary={credentials === value} disabled={!editable || busy || value === 'replace' && !profile?.credentialStorageAvailable} onPress={() => { setCredentials(value); setUsername(''); setPassword(''); changed() }} />)}</View>
        {credentials === 'replace' && <>
          <TextInput value={username} onChangeText={value => { setUsername(value); changed() }} editable={!busy} style={styles.input} placeholder="Username" placeholderTextColor={colors.muted} accessibilityLabel="Proxy username" autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={512} />
          <TextInput value={password} onChangeText={value => { setPassword(value); changed() }} editable={!busy} style={styles.input} placeholder="Password" placeholderTextColor={colors.muted} accessibilityLabel="Proxy password" secureTextEntry autoComplete="off" textContentType="none" maxLength={512} />
        </>}
      </>}
      {profile?.proxyLocked && <Text style={styles.secondary}>This profile’s connection is managed by its host.</Text>}
      <View style={styles.row}>
        <Button title="Test connection" busy={busy} disabled={host?.capabilities?.proxy !== 1 || !enabled} onPress={() => void check()} />
        {editable && <Button title="Save connection" primary busy={busy} onPress={() => void save()} />}
      </View>
      {!!test && <View style={{ gap: 4 }}><Text style={styles.text}>{test.ip}{test.region ? ' · ' + test.region : ''}</Text><Text style={styles.secondary}>Checked {new Date(test.checkedAt).toLocaleTimeString()}</Text></View>}
      {!!notice && <Text style={styles.secondary}>{notice}</Text>}
    </> : <Button title="Reload profiles" onPress={() => void load()} />}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
  </Sheet>
}
