import { useState } from 'react'
import { Linking, Platform, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRemote } from '../RemoteContext'
import { colors, styles } from '../theme'
import { Button } from './Button'

export let NotificationSetup = ({ compact = false }: { compact?: boolean }) => {
  let remote = useRemote()
  let [busy, setBusy] = useState(false)
  let [off, setOff] = useState(false)
  let [error, setError] = useState('')
  if (Platform.OS === 'web' || compact && remote.notificationsEnabled) return null
  let enable = async () => {
    setBusy(true); setError('')
    try { setOff(!await remote.enableNotifications()) }
    catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <View style={styles.card}>
    <View style={local.heading}><Ionicons name={remote.notificationsEnabled ? 'notifications' : 'notifications-outline'} size={20} color={colors.secondary} /><Text style={local.title}>{remote.notificationsEnabled ? 'Notifications enabled' : 'Get help alerts'}</Text></View>
    <Text style={styles.secondary}>{off ? 'Enable notifications in system settings.' : 'Know when a browser check or agent needs you.'}</Text>
    {!remote.notificationsEnabled && <View style={styles.row}><Button title={off ? 'Open system settings' : 'Enable alerts'} busy={busy} onPress={() => off ? void Linking.openSettings().catch(error => setError(error.message)) : void enable()} /></View>}
    {!!error && <Text accessibilityRole="alert" style={local.error}>{error}</Text>}
  </View>
}
let local = StyleSheet.create({ heading: { flexDirection: 'row', gap: 10, alignItems: 'center' }, title: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 }, error: { color: colors.danger, fontSize: 13, lineHeight: 20 } })
