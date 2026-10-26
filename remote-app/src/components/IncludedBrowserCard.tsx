import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRemote } from '../RemoteContext'
import { colors, styles } from '../theme'
import { Button } from './Button'
import { Sheet } from './Sheet'

export let IncludedBrowserCard = ({ compact = false }: { compact?: boolean }) => {
  let remote = useRemote(), included = remote.includedBrowser, browser = included.browser
  let [expanded, setExpanded] = useState(false)
  if (!browser) return null
  if (compact && (!browser.entitled || (browser.state === 'running' && remote.hosts.some(host => host.id === browser.target?.host && host.sessions.some(session => session.panes.length > 0))))) return null
  let pending = browser.state === 'starting' || browser.state === 'waking'
  let status = browser.state === 'sleeping' ? 'Sleeping' : browser.state === 'starting' ? 'Starting…' : browser.state === 'waking' ? 'Waking…' : browser.state === 'running' ? 'Ready' : browser.state === 'suspended' || browser.state === 'error' ? 'Unavailable' : 'Not started'
  let content = <>
    <Text style={styles.label}>Included browser</Text>
    <Text style={styles.text}>{status}</Text>
    {browser.entitled ? <Button title={browser.state === 'sleeping' ? 'Wake browser' : browser.state === 'error' ? 'Retry browser' : 'Open browser'} primary busy={included.opening || pending} disabled={!remote.viewer || browser.state === 'suspended'} onPress={() => { setExpanded(false); void included.open() }} /> : <Text style={styles.secondary}>Requires relay</Text>}
    {!!included.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{included.error}</Text>}
  </>
  return compact ? <>
    <Pressable accessibilityRole="button" accessibilityLabel="Included browser" onPress={() => setExpanded(true)} style={local.row}><Ionicons name="add" size={18} color={colors.secondary} /><Text style={styles.secondary}>Included browser</Text></Pressable>
    <Sheet title="Included browser" visible={expanded} close={() => setExpanded(false)}>{content}</Sheet>
  </> : <View style={styles.card}>{content}</View>
}
let local = StyleSheet.create({ row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 } })
