import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRemote } from './RemoteContext'
import { attentionStatus } from './types'
import { colors, radius, styles } from './theme'
import { Button } from './components/Button'
import { Sheet } from './components/Sheet'
import { ViewerScreen } from './components/ViewerScreen'

export let RemoteApp = ({ attentionId }: { attentionId?: string }) => {
  let remote = useRemote()
  let [section, setSection] = useState<'sessions' | 'attention' | 'settings'>('sessions')
  let [machine, setMachine] = useState('')
  let [search, setSearch] = useState('')
  let [history, setHistory] = useState(false)
  let [busy, setBusy] = useState(false)
  let [notice, setNotice] = useState('')
  let [disconnect, setDisconnect] = useState<string>()
  let { width } = useWindowDimensions()
  let split = width >= 768
  let pending = remote.attention.filter(item => ['pending', 'claimed', 'verifying'].includes(attentionStatus(item)))
  let action = async (run: () => Promise<unknown>) => { setBusy(true); try { await run() } catch (value) { remote.setError((value as Error).message) } finally { setBusy(false) } }
  useEffect(() => { if (attentionId) { remote.rememberAttention(attentionId); setSection('sessions') } }, [attentionId])
  useEffect(() => { if (remote.selection) setSection('sessions') }, [remote.selection])
  if (remote.loading) return <View style={[styles.screen, local.center]}><ActivityIndicator color={colors.accent} /></View>
  if (!remote.account) return <SafeAreaView style={[styles.screen, local.center]}>
    <View style={local.welcome}>
      <Text style={local.brand}>bmux remote</Text>
      <Text style={local.welcomeTitle}>Your browser, wherever you are.</Text>
      <Text style={local.welcomeBody}>Open your sessions. Help when an agent gets stuck. Pick up where you left off.</Text>
      <Button title="Sign in" primary busy={busy} onPress={() => void action(remote.login)} />
      {!!remote.error && <Text accessibilityRole="alert" style={local.errorText}>{remote.error}</Text>}
    </View>
  </SafeAreaView>
  let sessions = <View style={split ? local.sidebarWide : local.sidebar}>
    <ScrollView horizontal style={local.machineBar} contentContainerStyle={local.machineContent} showsHorizontalScrollIndicator={false}>
      {[{ id: '', service: 'All machines' }, ...remote.hosts].map(host => <Pressable key={host.id} accessibilityRole="button" accessibilityLabel={host.service} onPress={() => setMachine(host.id)} style={[local.machine, host.id === machine && local.machineSelected]}><View style={[local.dot, { backgroundColor: host.id ? colors.success : colors.accent }]} /><Text style={[local.machineText, host.id === machine && { color: colors.text }]}>{host.service}</Text></Pressable>)}
    </ScrollView>
    <View style={local.search}><Ionicons name="search" size={17} color={colors.secondary} /><TextInput style={local.searchInput} placeholder="Search sessions" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} accessibilityLabel="Search sessions" /></View>
    <ScrollView contentContainerStyle={local.list}>
      {remote.hosts.filter(host => !machine || host.id === machine).map(host => <View key={host.id} style={local.host}>
        <Text style={styles.label}>{host.service}</Text>
        {host.sessions.filter(session => (session.name + ' ' + session.panes.map(pane => pane.title).join(' ')).toLowerCase().includes(search.toLowerCase())).map(session => <View key={session.id} style={[local.session, remote.selection?.host === host.id && remote.selection.session === session.id && local.sessionSelected]}>
          <Pressable accessibilityRole="button" accessibilityLabel={'Open ' + session.name} onPress={() => { let pane = session.panes[0]; if (pane) void action(() => remote.watch({ host: host.id, generation: host.generation, session: session.id, pane: pane.id })) }} style={local.sessionHeading}>
            <Ionicons name="browsers-outline" size={20} color={colors.accent} />
            <View style={local.sessionText}><Text style={local.sessionName} numberOfLines={1}>{session.name}</Text><Text style={styles.secondary}>{session.panes.length} {session.panes.length === 1 ? 'page' : 'pages'}{host.permission === 'watch' ? ' · Watch' : ''}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
          {session.panes.length > 1 && session.panes.map(pane => <Pressable key={pane.id} accessibilityRole="button" accessibilityLabel={'Open ' + (pane.title || 'page')} style={local.pane} onPress={() => void action(() => remote.watch({ host: host.id, generation: host.generation, session: session.id, pane: pane.id }))}><View style={local.paneDot} /><Text style={local.paneTitle} numberOfLines={1}>{pane.title || 'Untitled page'}</Text></Pressable>)}
        </View>)}
      </View>)}
      {remote.hosts.length === 0 && <View style={local.empty}><Ionicons name="desktop-outline" size={32} color={colors.muted} /><Text style={styles.text}>{remote.connecting ? 'Connecting to your machines…' : 'Your machines will appear here'}</Text><Text style={styles.secondary}>Sessions stay on their owning machine.</Text><Button title="Refresh" busy={remote.connecting} onPress={remote.retry} /></View>}
    </ScrollView>
  </View>
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
    <View style={local.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Sessions" onPress={() => setSection('sessions')}><Text style={local.brand}>bmux remote</Text></Pressable>
      <View style={styles.row}>
        <Pressable style={local.iconButton} accessibilityRole="button" accessibilityLabel={'Attention, ' + pending.length + ' pending'} onPress={() => { remote.close(); setSection('attention'); void remote.refresh() }}><Ionicons name="notifications-outline" size={22} color={section === 'attention' ? colors.accent : colors.secondary} />{pending.length > 0 && <Text style={local.badge}>{pending.length}</Text>}</Pressable>
        <Pressable style={local.iconButton} accessibilityRole="button" accessibilityLabel="Settings" onPress={() => { remote.close(); setSection('settings'); void remote.refresh() }}><Ionicons name="settings-outline" size={22} color={section === 'settings' ? colors.accent : colors.secondary} /></Pressable>
      </View>
    </View>
    {!!remote.error && <View style={local.error}><Text accessibilityRole="alert" style={local.errorText}>{remote.error}</Text><Button title="Reconnect" disabled={remote.connecting} onPress={remote.retry} /><Button title="Dismiss" onPress={() => remote.setError('')} /></View>}
    {section === 'sessions' && <View style={local.body}>{(split || !remote.selection) && sessions}{remote.selection ? <View style={local.detail}><ViewerScreen /></View> : split && <View style={[local.detail, local.center]}><Ionicons name="browsers-outline" size={40} color={colors.muted} /><Text style={styles.secondary}>Select a session to watch</Text></View>}</View>}
    {section === 'attention' && <ScrollView contentContainerStyle={local.content}>
      <View style={[styles.row, local.sectionHeading]}><Text style={styles.title}>Attention</Text><Button title={history ? 'Pending' : 'History'} onPress={() => setHistory(!history)} /></View>
      {(history ? remote.attention : pending).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => { remote.rememberAttention(item.id); setSection('sessions') }} style={styles.card}>
        <View style={[styles.row, local.sectionHeading]}><Text style={styles.text}>{item.reason === 'help' ? 'Agent needs your help' : 'Browser needs attention'}</Text><Text style={{ color: attentionStatus(item) === 'resolved' ? colors.success : colors.warning }}>{attentionStatus(item)}</Text></View>
        <Text style={styles.secondary}>{new Date(item.created_at).toLocaleString()}</Text>
      </Pressable>)}
      {(history ? remote.attention : pending).length === 0 && <View style={local.empty}><Ionicons name="checkmark-circle-outline" size={34} color={colors.success} /><Text style={styles.text}>Nothing needs your attention</Text></View>}
    </ScrollView>}
    {section === 'settings' && <ScrollView contentContainerStyle={local.content}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.card}><Text style={styles.label}>Account</Text><Text style={styles.text}>{remote.account.name || remote.account.email || 'Signed in'}</Text>{!!remote.account.email && <Text style={styles.secondary}>{remote.account.email}</Text>}<Text style={styles.secondary}>Relay {remote.billing?.relay.active ? 'active' : 'inactive'}</Text><Button title="Sign out" busy={busy} onPress={() => void action(remote.logout)} /></View>
      {Platform.OS !== 'web' && <View style={styles.card}><Text style={styles.label}>Notifications</Text><Text style={styles.text}>Know when an agent needs your help.</Text><Button title="Enable notifications" busy={busy} onPress={() => void action(async () => { let enabled = await remote.enableNotifications(); setNotice(enabled ? 'Notifications enabled.' : 'Notifications are off. Enable them in system settings.') })} />{!!notice && <Text style={styles.secondary}>{notice}</Text>}</View>}
      <View style={styles.card}><View style={[styles.row, local.sectionHeading]}><Text style={styles.label}>Live views</Text><Text style={styles.secondary}>{remote.views.length} / {remote.billing?.relay.maxStreams ?? 2}</Text></View>{remote.views.map(view => <View key={view.connection} style={[styles.row, local.sectionHeading]}><View style={{ flex: 1 }}><Text style={styles.text}>{remote.hosts.find(item => item.id === view.host)?.service || 'Browser'}</Text><Text style={styles.secondary}>{view.pane}</Text></View><Button title="Disconnect" onPress={() => setDisconnect(view.connection)} /></View>)}{remote.views.length === 0 && <Text style={styles.secondary}>No live views</Text>}</View>
    </ScrollView>}
    <Sheet title="Disconnect this view?" visible={!!disconnect} close={() => setDisconnect(undefined)}><Text style={styles.text}>The browser and its background work will keep running.</Text><Button title="Disconnect" primary busy={busy} onPress={() => disconnect && void action(async () => { await remote.disconnectView(disconnect); setDisconnect(undefined) })} /></Sheet>
  </SafeAreaView>
}
let local = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 20 }, welcome: { width: '100%', maxWidth: 400, padding: 28, gap: 24 }, welcomeTitle: { color: colors.text, fontSize: 34, fontWeight: '600', lineHeight: 40 }, welcomeBody: { color: colors.secondary, fontSize: 16, lineHeight: 24 },
  brand: { color: colors.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.4 }, header: { minHeight: 60, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  iconButton: { minHeight: 44, minWidth: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' }, badge: { position: 'absolute', right: 0, top: 2, backgroundColor: colors.warning, color: colors.bg, fontSize: 10, fontWeight: '700', minWidth: 16, textAlign: 'center', borderRadius: 8, padding: 2 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 }, sidebar: { flex: 1 }, sidebarWide: { width: 340, flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.border }, detail: { flex: 1, minWidth: 0 },
  machineBar: { flexGrow: 0, maxHeight: 64 }, machineContent: { padding: 12, gap: 8, alignItems: 'center' }, machine: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.surface }, machineSelected: { backgroundColor: colors.grouped }, machineText: { color: colors.secondary, fontSize: 13, fontWeight: '500' }, dot: { width: 6, height: 6, borderRadius: 3 },
  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, gap: 8, backgroundColor: colors.surface, borderRadius: radius.sm }, searchInput: { color: colors.text, paddingVertical: 12, flex: 1, fontSize: 14 },
  list: { padding: 16, gap: 24 }, host: { gap: 10 }, session: { padding: 12, gap: 8, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' }, sessionSelected: { borderColor: colors.accent }, sessionHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 }, sessionText: { flex: 1, minWidth: 0, gap: 4 }, sessionName: { color: colors.text, fontWeight: '500', fontSize: 15 }, pane: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingLeft: 32 }, paneDot: { height: 4, width: 4, borderRadius: 2, backgroundColor: colors.muted }, paneTitle: { flex: 1, color: colors.secondary, fontSize: 13 },
  content: { padding: 24, gap: 20, maxWidth: 680, width: '100%', alignSelf: 'center' }, sectionHeading: { justifyContent: 'space-between' }, empty: { padding: 28, gap: 14, alignItems: 'center' }, error: { backgroundColor: 'rgba(255,69,58,0.1)', padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center' }, errorText: { color: colors.danger, fontSize: 14, flexShrink: 1 },
})
