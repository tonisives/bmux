import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { Link } from 'expo-router'
import { useRemote } from './RemoteContext'
import { pendingAttention } from './attention-presentation'
import { canManageHost } from './host-access'
import { colors, styles } from './theme'
import { Button } from './components/Button'
import { Brand } from './components/Brand'
import { Sheet } from './components/Sheet'
import { ViewerScreen } from './components/ViewerScreen'
import { NewSessionSheet } from './components/NewSessionSheet'
import { ProfilesSheet } from './components/ProfilesSheet'
import { IncludedBrowserCard } from './components/IncludedBrowserCard'
import { SessionList } from './components/SessionList'
import { DemoWorkspace } from './components/DemoWorkspace'
import { AttentionInbox } from './components/AttentionInbox'
import { NotificationSetup } from './components/NotificationSetup'
import { RemoteHeader, RemoteTabs, type RemoteTab } from './components/RemoteNavigation'
import { useSplitView } from './useSplitView'
import type { Host } from './types'
import type { RemoteQualityMode } from '../../src/shared/remote-management'

export let RemoteApp = ({ attentionId }: { attentionId?: string }) => {
  let remote = useRemote()
  let [section, setSection] = useState<RemoteTab | 'attention'>('sessions')
  let [focusSearch, setFocusSearch] = useState(0)
  let [demo, setDemo] = useState(false)
  let [setup, setSetup] = useState(false)
  let [busy, setBusy] = useState(false)
  let [disconnect, setDisconnect] = useState<string>()
  let [newHost, setNewHost] = useState<Host>()
  let [profileHost, setProfileHost] = useState<Host>()
  let split = useSplitView()
  let pending = pendingAttention(remote.attention)
  let profileHosts = remote.hosts.filter(host => canManageHost(host) && host.capabilities?.profiles === 1)
  let openAttention = (id: string) => { remote.rememberAttention(id); setSection('sessions') }
  let action = async (run: () => Promise<unknown>) => { setBusy(true); try { await run() } catch (value) { remote.setError((value as Error).message) } finally { setBusy(false) } }
  useEffect(() => { if (attentionId) { setDemo(false); remote.rememberAttention(attentionId); setSection('sessions') } }, [attentionId])
  useEffect(() => { if (remote.selection) setSection('sessions') }, [remote.selection])
  let openDemo = () => { remote.close(); setDemo(true) }
  let selectTab = (tab: RemoteTab) => {
    remote.close(); setSection(tab)
    if (tab === 'search') setFocusSearch(value => value + 1)
    if (tab === 'settings') void remote.refresh()
  }
  if (demo) return <DemoWorkspace close={() => setDemo(false)} connect={() => { setDemo(false); if (!remote.account) void action(remote.login); else setSetup(true) }} />
  if (remote.loading) return <View style={[styles.screen, local.center]}><ActivityIndicator color={colors.secondary} /><Button title="Demo" onPress={openDemo} /></View>
  if (!remote.account) return <SafeAreaView style={[styles.screen, local.center]}>
    <View style={local.welcome}>
      <Brand />
      <View style={local.welcomeActions}><Button title="Sign in" primary busy={busy} onPress={() => void action(remote.login)} /><Button title="Demo" onPress={openDemo} /></View>
      {!!remote.error && <Text accessibilityRole="alert" style={local.errorText}>{remote.error}</Text>}
      <HelpLinks />
    </View>
  </SafeAreaView>
  let sessions = <View style={split ? local.sidebarWide : local.sidebar}>
    <SessionList hosts={remote.hosts} attention={remote.attention} selection={remote.selection} select={selection => void action(() => remote.watch(selection))} create={setNewHost} searchVisible={split || section === 'search'} focusSearch={focusSearch}
      empty={<View style={local.empty}><Text style={styles.secondary}>{remote.connecting ? 'Connecting…' : 'No sessions'}</Text><Button title="Connect a machine" onPress={() => setSetup(true)} /></View>}
    />
  </View>
  let viewing = (section === 'sessions' || section === 'search') && !!remote.selection && !split
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
    {!viewing && <RemoteHeader notifications={pending.length} onNotifications={() => { remote.close(); setSection('attention'); void remote.refresh() }} />}
    {!!remote.error && <View style={local.error}><Text accessibilityRole="alert" style={local.errorText}>{remote.error}</Text><Button title="Reconnect" disabled={remote.connecting} onPress={remote.retry} /><Button title="Dismiss" onPress={() => remote.setError('')} /></View>}
    {(section === 'sessions' || section === 'search') && <View style={local.body}>{(split || !remote.selection) && sessions}{remote.selection ? <View style={local.detail}><ViewerScreen /></View> : split && <View style={[local.detail, local.center]}><Text style={styles.secondary}>Select a session</Text></View>}</View>}
    {section === 'attention' && <AttentionInbox items={remote.attention} hosts={remote.hosts} open={openAttention} dismiss={id => void action(() => remote.markAttention(id, { dismissed: true }))} busy={busy} loading={remote.loadingAttention} loadMore={remote.attentionCursor ? () => void action(remote.loadMoreAttention) : undefined} />}
    {section === 'settings' && <ScrollView contentContainerStyle={local.content}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.card}><Text style={styles.label}>Account</Text><Text style={styles.text}>{remote.account.name || remote.account.email || 'Signed in'}</Text>{!!remote.account.email && <Text style={styles.secondary}>{remote.account.email}</Text>}<Text style={styles.secondary}>Relay {remote.billing?.relay.active ? 'active' : 'inactive'}</Text><Button title="Sign out" busy={busy} onPress={() => void action(remote.logout)} /></View>
      <View style={styles.card}><Text style={styles.label}>Machines</Text><Pressable accessibilityRole="button" accessibilityLabel="Connect a machine" onPress={() => setSetup(true)} style={local.connectionRow}><Ionicons name="add" size={18} color={colors.secondary} /><Text style={styles.text}>Connect a machine</Text></Pressable></View>
      <IncludedBrowserCard compact />
      <NotificationSetup />
      {remote.hosts.some(host => host.capabilities?.streamQuality === 1) && <View style={styles.card}><Text style={styles.label}>Data use</Text><View style={styles.row}>{(['auto', 'data-saver', 'quality'] as RemoteQualityMode[]).map(mode => <Button key={mode} title={mode === 'auto' ? 'Auto' : mode === 'data-saver' ? 'Data saver' : 'Quality'} primary={remote.streamQuality.mode === mode} onPress={() => void action(() => remote.streamQuality.setMode(mode))} />)}</View><Text style={styles.secondary}>Auto uses less data on cellular and full quality on Wi-Fi.</Text></View>}
      {profileHosts.length > 0 && <View style={styles.card}><Text style={styles.label}>Profiles</Text>{profileHosts.map(host => <View key={host.id} style={[styles.row, local.sectionHeading]}><Text style={[styles.text, { flex: 1 }]}>{host.service}</Text><Button title="Profiles" onPress={() => setProfileHost(host)} /></View>)}</View>}
      <View style={styles.card}><View style={[styles.row, local.sectionHeading]}><Text style={styles.label}>Live views</Text><Text style={styles.secondary}>{remote.views.length} / {remote.billing?.relay.maxStreams ?? 2}</Text></View>{remote.views.map(view => <View key={view.connection} style={[styles.row, local.sectionHeading]}><View style={{ flex: 1 }}><Text style={styles.text}>{remote.hosts.find(item => item.id === view.host)?.service || 'Browser'}</Text><Text style={styles.secondary}>{view.pane}</Text></View><Button title="Disconnect" onPress={() => setDisconnect(view.connection)} /></View>)}{remote.views.length === 0 && <Text style={styles.secondary}>No live views</Text>}</View>
      <Button title="Demo" onPress={openDemo} />
      <HelpLinks />
    </ScrollView>}
    {!viewing && <RemoteTabs active={section === 'attention' ? 'sessions' : section} select={selectTab} />}
    <Sheet title="Disconnect this view?" visible={!!disconnect} close={() => setDisconnect(undefined)}><Text style={styles.text}>The browser and its background work will keep running.</Text><Button title="Disconnect" primary busy={busy} onPress={() => disconnect && void action(async () => { await remote.disconnectView(disconnect); setDisconnect(undefined) })} /></Sheet>
    <NewSessionSheet host={newHost} close={() => { setNewHost(undefined); remote.close() }} created={() => setNewHost(undefined)} />
    <ProfilesSheet host={profileHost} close={() => { setProfileHost(undefined); remote.close() }} />
    <Sheet title="Connect a machine" visible={setup} close={() => setSetup(false)}>
      <IncludedBrowserCard />
      <Text style={local.setupText}>Open Remote settings in bmux on your computer and sign in with this account.</Text>
      <Button title="Refresh" busy={remote.connecting} onPress={() => { remote.retry(); setSetup(false) }} />
    </Sheet>
  </SafeAreaView>
}
let HelpLinks = () => <View style={local.helpLinks}>
  <Link href="https://bmux.cc/privacy/" target="_blank" rel="noreferrer" style={local.helpLink}>Privacy policy</Link>
  <Link href="https://tonis.dev/#contact" target="_blank" rel="noreferrer" style={local.helpLink}>Support</Link>
</View>
let local = StyleSheet.create({
  helpLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 }, helpLink: { color: colors.secondary, fontSize: 13, minHeight: 44, paddingVertical: 12 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 20 }, welcome: { width: '100%', maxWidth: 440, padding: 28, gap: 24 }, welcomeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 }, sidebar: { flex: 1 }, sidebarWide: { width: 380, maxWidth: '45%', flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.border }, detail: { flex: 1, minWidth: 0 },
  connectionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 }, setupText: { color: colors.secondary, fontSize: 14, lineHeight: 22, textAlign: 'left' },
  content: { padding: 24, gap: 20, maxWidth: 680, width: '100%', alignSelf: 'center' }, sectionHeading: { justifyContent: 'space-between' }, empty: { padding: 28, gap: 14, alignItems: 'center' }, error: { backgroundColor: 'rgba(255,69,58,0.1)', padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center' }, errorText: { color: colors.danger, fontSize: 14, flexShrink: 1 },
})
