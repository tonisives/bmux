import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { Link } from 'expo-router'
import { useRemote } from './RemoteContext'
import { pendingAttention } from './attention-presentation'
import { canManageHost } from './host-access'
import { colors, radius, styles } from './theme'
import { Button } from './components/Button'
import { Sheet } from './components/Sheet'
import { ViewerScreen } from './components/ViewerScreen'
import { NewSessionSheet } from './components/NewSessionSheet'
import { ProfilesSheet } from './components/ProfilesSheet'
import { IncludedBrowserCard } from './components/IncludedBrowserCard'
import { SessionList } from './components/SessionList'
import { DemoWorkspace } from './components/DemoWorkspace'
import { AttentionInbox, AttentionSummary } from './components/AttentionInbox'
import { NotificationSetup } from './components/NotificationSetup'
import { useCompactHeight, useSplitView } from './useSplitView'
import type { Host } from './types'
import type { RemoteQualityMode } from '../../src/shared/remote-management'

export let RemoteApp = ({ attentionId }: { attentionId?: string }) => {
  let remote = useRemote()
  let [section, setSection] = useState<'sessions' | 'attention' | 'settings'>('sessions')
  let [demo, setDemo] = useState(false)
  let [setup, setSetup] = useState(false)
  let [busy, setBusy] = useState(false)
  let [disconnect, setDisconnect] = useState<string>()
  let [newHost, setNewHost] = useState<Host>()
  let [profileHost, setProfileHost] = useState<Host>()
  let split = useSplitView()
  let compact = useCompactHeight()
  let hasSessions = remote.hosts.some(host => host.sessions.some(session => session.panes.length > 0))
  let pending = pendingAttention(remote.attention)
  let profileHosts = remote.hosts.filter(host => canManageHost(host) && host.capabilities?.profiles === 1)
  let openAttention = (id: string) => { remote.rememberAttention(id); setSection('sessions') }
  let action = async (run: () => Promise<unknown>) => { setBusy(true); try { await run() } catch (value) { remote.setError((value as Error).message) } finally { setBusy(false) } }
  useEffect(() => { if (attentionId) { setDemo(false); remote.rememberAttention(attentionId); setSection('sessions') } }, [attentionId])
  useEffect(() => { if (remote.selection) setSection('sessions') }, [remote.selection])
  let openDemo = () => { remote.close(); setDemo(true) }
  if (demo) return <DemoWorkspace close={() => setDemo(false)} connect={() => { setDemo(false); if (!remote.account) void action(remote.login); else setSetup(true) }} />
  if (remote.loading) return <View style={[styles.screen, local.center]}><ActivityIndicator color={colors.secondary} /><Button title="Try demo" onPress={openDemo} /></View>
  if (!remote.account) return <SafeAreaView style={[styles.screen, local.center]}>
    <View style={local.welcome}>
      <Text style={local.brand}>bmux remote</Text>
      <Text style={local.welcomeTitle}>Your sessions, wherever you are.</Text>
      <Text style={local.welcomeBody}>Explore two sample pages, or sign in to open your browsers.</Text>
      <View style={local.welcomeActions}><Button title="Try demo" primary onPress={openDemo} /><Button title="Sign in" busy={busy} onPress={() => void action(remote.login)} /></View>
      {!!remote.error && <Text accessibilityRole="alert" style={local.errorText}>{remote.error}</Text>}
      <HelpLinks />
    </View>
  </SafeAreaView>
  let sessions = <View style={split ? local.sidebarWide : local.sidebar}>
    <SessionList hosts={remote.hosts} attention={remote.attention} selection={remote.selection} select={selection => void action(() => remote.watch(selection))} create={setNewHost}
      header={<><AttentionSummary items={remote.attention} hosts={remote.hosts} open={openAttention} showAll={() => setSection('attention')} />{!hasSessions && <IncludedBrowserCard />}</>}
      empty={<View style={local.empty}><Ionicons name="desktop-outline" size={32} color={colors.secondary} /><Text style={styles.text}>{remote.connecting ? 'Connecting to your machines…' : 'Use your computer'}</Text><Text style={local.setupText}>Open bmux’s Remote settings on your computer and sign in with this account.</Text><Button title="Refresh" busy={remote.connecting} onPress={remote.retry} /></View>}
      footer={<View style={local.connectionOptions}>
        {hasSessions && <NotificationSetup compact />}
        <Pressable accessibilityRole="button" accessibilityLabel="Connect a machine" onPress={() => setSetup(true)} style={local.connectionRow}><Ionicons name="add" size={18} color={colors.secondary} /><Text style={styles.secondary}>Connect a machine</Text></Pressable>
        {hasSessions && <IncludedBrowserCard compact />}
        {!hasSessions && <Button title="Try demo" onPress={openDemo} />}
      </View>}
    />
  </View>
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
    {!(compact && section === 'sessions' && remote.selection) && <View style={local.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Sessions" onPress={() => setSection('sessions')}><Text style={local.brand}>bmux remote</Text></Pressable>
      <View style={styles.row}>
        <Pressable style={local.iconButton} accessibilityRole="button" accessibilityLabel={'Attention, ' + pending.length + ' pending'} onPress={() => { remote.close(); setSection('attention'); void remote.refresh() }}><Ionicons name="notifications-outline" size={22} color={section === 'attention' ? colors.accent : colors.secondary} />{pending.length > 0 && <Text style={local.badge}>{pending.length}</Text>}</Pressable>
        <Pressable style={local.iconButton} accessibilityRole="button" accessibilityLabel="Settings" onPress={() => { remote.close(); setSection('settings'); void remote.refresh() }}><Ionicons name="settings-outline" size={22} color={section === 'settings' ? colors.accent : colors.secondary} /></Pressable>
      </View>
    </View>}
    {!!remote.error && <View style={local.error}><Text accessibilityRole="alert" style={local.errorText}>{remote.error}</Text><Button title="Reconnect" disabled={remote.connecting} onPress={remote.retry} /><Button title="Dismiss" onPress={() => remote.setError('')} /></View>}
    {section === 'sessions' && <View style={local.body}>{(split || !remote.selection) && sessions}{remote.selection ? <View style={local.detail}><ViewerScreen /></View> : split && <View style={[local.detail, local.center]}><Ionicons name="browsers-outline" size={40} color={colors.muted} /><Text style={styles.secondary}>Select a session to watch</Text></View>}</View>}
    {section === 'attention' && <AttentionInbox items={remote.attention} hosts={remote.hosts} open={openAttention} dismiss={id => void action(() => remote.markAttention(id, { dismissed: true }))} busy={busy} loading={remote.loadingAttention} loadMore={remote.attentionCursor ? () => void action(remote.loadMoreAttention) : undefined} />}
    {section === 'settings' && <ScrollView contentContainerStyle={local.content}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.card}><Text style={styles.label}>Account</Text><Text style={styles.text}>{remote.account.name || remote.account.email || 'Signed in'}</Text>{!!remote.account.email && <Text style={styles.secondary}>{remote.account.email}</Text>}<Text style={styles.secondary}>Relay {remote.billing?.relay.active ? 'active' : 'inactive'}</Text><Button title="Sign out" busy={busy} onPress={() => void action(remote.logout)} /></View>
      <NotificationSetup />
      {remote.hosts.some(host => host.capabilities?.streamQuality === 1) && <View style={styles.card}><Text style={styles.label}>Data use</Text><View style={styles.row}>{(['auto', 'data-saver', 'quality'] as RemoteQualityMode[]).map(mode => <Button key={mode} title={mode === 'auto' ? 'Auto' : mode === 'data-saver' ? 'Data saver' : 'Quality'} primary={remote.streamQuality.mode === mode} onPress={() => void action(() => remote.streamQuality.setMode(mode))} />)}</View><Text style={styles.secondary}>Auto uses less data on cellular and full quality on Wi-Fi.</Text></View>}
      {profileHosts.length > 0 && <View style={styles.card}><Text style={styles.label}>Profiles</Text>{profileHosts.map(host => <View key={host.id} style={[styles.row, local.sectionHeading]}><Text style={[styles.text, { flex: 1 }]}>{host.service}</Text><Button title="Profiles" onPress={() => setProfileHost(host)} /></View>)}</View>}
      <View style={styles.card}><View style={[styles.row, local.sectionHeading]}><Text style={styles.label}>Live views</Text><Text style={styles.secondary}>{remote.views.length} / {remote.billing?.relay.maxStreams ?? 2}</Text></View>{remote.views.map(view => <View key={view.connection} style={[styles.row, local.sectionHeading]}><View style={{ flex: 1 }}><Text style={styles.text}>{remote.hosts.find(item => item.id === view.host)?.service || 'Browser'}</Text><Text style={styles.secondary}>{view.pane}</Text></View><Button title="Disconnect" onPress={() => setDisconnect(view.connection)} /></View>)}{remote.views.length === 0 && <Text style={styles.secondary}>No live views</Text>}</View>
      <Button title="Try demo" onPress={openDemo} />
      <HelpLinks />
    </ScrollView>}
    <Sheet title="Disconnect this view?" visible={!!disconnect} close={() => setDisconnect(undefined)}><Text style={styles.text}>The browser and its background work will keep running.</Text><Button title="Disconnect" primary busy={busy} onPress={() => disconnect && void action(async () => { await remote.disconnectView(disconnect); setDisconnect(undefined) })} /></Sheet>
    <NewSessionSheet host={newHost} close={() => { setNewHost(undefined); remote.close() }} created={() => setNewHost(undefined)} />
    <ProfilesSheet host={profileHost} close={() => { setProfileHost(undefined); remote.close() }} />
    <Sheet title="Connect a browser" visible={setup} close={() => setSetup(false)}>
      <IncludedBrowserCard />
      <Text style={styles.text}>Use your computer</Text><Text style={local.setupText}>Open bmux’s Remote settings on your computer and sign in with this account. Its sessions will appear here.</Text>
      <Button title="Refresh machines" busy={remote.connecting} onPress={() => { remote.retry(); setSetup(false) }} />
    </Sheet>
  </SafeAreaView>
}
let HelpLinks = () => <View style={local.helpLinks}>
  <Link href="https://bmux.cc/privacy/" target="_blank" rel="noreferrer" style={local.helpLink}>Privacy policy</Link>
  <Link href="https://tonis.dev/#contact" target="_blank" rel="noreferrer" style={local.helpLink}>Support</Link>
</View>
let local = StyleSheet.create({
  helpLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 }, helpLink: { color: colors.secondary, fontSize: 13, minHeight: 44, paddingVertical: 12 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 20 }, welcome: { width: '100%', maxWidth: 440, padding: 28, gap: 24 }, welcomeTitle: { color: colors.text, fontSize: 28, fontWeight: '600', lineHeight: 35 }, welcomeBody: { color: colors.secondary, fontSize: 16, lineHeight: 24 }, welcomeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  brand: { color: colors.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.4 }, header: { minHeight: 68, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  iconButton: { minHeight: 44, minWidth: 44, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', position: 'relative' }, badge: { position: 'absolute', right: 0, top: 2, backgroundColor: colors.warning, color: colors.bg, fontSize: 10, fontWeight: '700', minWidth: 16, textAlign: 'center', borderRadius: 8, padding: 2 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 }, sidebar: { flex: 1 }, sidebarWide: { width: 380, maxWidth: '45%', flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.border }, detail: { flex: 1, minWidth: 0 },
  connectionOptions: { gap: 4, paddingTop: 4 }, connectionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 }, setupText: { color: colors.secondary, fontSize: 14, lineHeight: 22, textAlign: 'left' },
  content: { padding: 24, gap: 20, maxWidth: 680, width: '100%', alignSelf: 'center' }, sectionHeading: { justifyContent: 'space-between' }, empty: { padding: 28, gap: 14, alignItems: 'center' }, error: { backgroundColor: 'rgba(255,69,58,0.1)', padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center' }, errorText: { color: colors.danger, fontSize: 14, flexShrink: 1 },
})
