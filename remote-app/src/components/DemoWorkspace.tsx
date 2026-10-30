import { useEffect, useState } from 'react'
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { colors, styles } from '../theme'
import { useSplitView } from '../useSplitView'
import type { Host, Selection } from '../types'
import { Button } from './Button'
import { RemoteHeader, RemoteTabs, type RemoteTab } from './RemoteNavigation'
import { SessionList } from './SessionList'
import { Sheet } from './Sheet'

let demoHost: Host = {
  id: 'demo', service: 'Demo Mac', generation: 'demo', permission: 'control',
  key: { kty: 'OKP', crv: 'Ed25519', x: '' },
  sessions: [{ id: 'demo-session', name: 'demo', panes: [{ id: 'demo-docs', title: 'Docs' }, { id: 'demo-notes', title: 'Notes' }] }],
}
let pageSelection = (pane: string): Selection => ({ host: demoHost.id, generation: demoHost.generation, session: 'demo-session', pane })

export let DemoWorkspace = ({ close, connect }: { close: () => void; connect: () => void }) => {
  let split = useSplitView()
  let [tab, setTab] = useState<RemoteTab>('sessions')
  let [selection, setSelection] = useState<Selection>()
  let [controlling, setControlling] = useState(false)
  let [details, setDetails] = useState(false)
  let [notifications, setNotifications] = useState(false)
  let [focusSearch, setFocusSearch] = useState(0)
  let [note, setNote] = useState('')
  let [saved, setSaved] = useState(false)
  let notes = selection?.pane === 'demo-notes'
  let title = notes ? 'Notes' : 'Docs'
  let open = (value: Selection) => { setSelection(value); setControlling(false); setDetails(false) }
  let back = () => { setSelection(undefined); setTab('sessions') }
  useEffect(() => {
    if (Platform.OS !== 'android' || !selection || split) return
    let subscription = BackHandler.addEventListener('hardwareBackPress', () => { setSelection(undefined); setTab('sessions'); return true })
    return () => subscription.remove()
  }, [selection, split])
  let selectTab = (value: RemoteTab) => { setTab(value); if (value === 'search') setFocusSearch(count => count + 1) }
  let list = <View style={split ? local.sidebar : local.list}>
    {tab === 'settings' ? <ScrollView contentContainerStyle={local.settings}>
      <Text style={styles.title}>Settings</Text>
      <Button title="Sign in with Google" onPress={connect} />
      <Button title="Exit demo" onPress={close} />
    </ScrollView> : <SessionList hosts={[demoHost]} selection={selection} select={open} searchVisible={split || tab === 'search'} focusSearch={focusSearch} />}
    <RemoteTabs active={tab} select={selectTab} />
  </View>
  return <SafeAreaView style={styles.screen}>
    {(split || !selection) && <RemoteHeader demo notifications={0} onNotifications={() => setNotifications(true)} />}
    <View style={local.workspace}>
      {(split || !selection) && list}
      {selection ? <View style={local.detail}>
        <View style={local.titleBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to sessions" onPress={back} style={local.back}><Ionicons name="chevron-back" size={24} color={colors.text} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Page details" onPress={() => setDetails(true)} style={local.pageTitle}>
            <Text style={local.title} numberOfLines={1}>{title}</Text><Text style={local.demo}>Demo</Text><Ionicons name="chevron-down" size={16} color={colors.secondary} />
          </Pressable>
        </View>
        <ScrollView testID="demo-browser-page" style={local.page} contentContainerStyle={local.pageContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {notes ? <>
            <Text style={local.contentTitle}>Notes</Text>
            <TextInput value={note} onChangeText={value => { setNote(value); setSaved(false) }} editable={controlling} accessibilityLabel="Demo note" accessibilityState={{ disabled: !controlling }} placeholder="Write a note" placeholderTextColor="#777777" multiline style={local.note} />
            <Pressable accessibilityRole="button" accessibilityLabel="Save note" disabled={!controlling || !note.trim()} accessibilityState={{ disabled: !controlling || !note.trim() }} onPress={() => setSaved(true)} style={[local.save, (!controlling || !note.trim()) && local.disabled]}><Text style={local.saveText}>Save</Text></Pressable>
            {saved && <Text accessibilityLiveRegion="polite" style={local.body}>Saved</Text>}
          </> : <>
            <Text style={local.wordmark}>BMUX</Text>
            <Text style={local.contentTitle}>Sessions</Text>
            <Text style={local.body}>A session contains windows and pages.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Open notes page" disabled={!controlling} accessibilityState={{ disabled: !controlling }} onPress={() => open(pageSelection('demo-notes'))} style={[local.pageLink, !controlling && local.disabled]}><Text style={local.linkText}>Notes</Text><Ionicons name="arrow-forward" size={18} color="#242424" /></Pressable>
          </>}
        </ScrollView>
      </View> : split && <View style={[local.detail, local.empty]}><Text style={styles.secondary}>Select a page</Text></View>}
    </View>
    <Sheet title="Page details" visible={details && !!selection} close={() => setDetails(false)}>
      <Text style={styles.secondary}>{notes ? 'notes.example' : 'docs.example'}</Text>
      <Text style={styles.text}>Sample page</Text>
      <Text style={styles.secondary}>{controlling ? 'Control' : 'Watch'}</Text>
      <Button title={controlling ? 'Release' : 'Take control'} onPress={() => { setControlling(value => !value); setDetails(false) }} />
    </Sheet>
    <Sheet title="Notifications" visible={notifications} close={() => setNotifications(false)}><Text style={styles.secondary}>No notifications</Text></Sheet>
  </SafeAreaView>
}

let local = StyleSheet.create({
  workspace: { flex: 1, minHeight: 0, flexDirection: 'row' }, sidebar: { width: 340, maxWidth: '45%', minHeight: 0, borderRightWidth: 1, borderRightColor: colors.border }, list: { flex: 1, minHeight: 0 }, detail: { flex: 1, minWidth: 0, minHeight: 0 }, empty: { alignItems: 'center', justifyContent: 'center' }, settings: { padding: 20, gap: 20, flexGrow: 1 },
  titleBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.border }, back: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, pageTitle: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 }, title: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, fontWeight: '600' }, demo: { color: colors.secondary, fontSize: 12 },
  page: { flex: 1, backgroundColor: '#fafafa' }, pageContent: { padding: 28, gap: 24, flexGrow: 1 }, wordmark: { fontSize: 13, letterSpacing: 2, fontWeight: '600', color: '#666666' }, contentTitle: { fontSize: 30, lineHeight: 36, fontWeight: '600', color: '#242424' }, body: { color: '#555555', fontSize: 16, lineHeight: 24 }, pageLink: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 12 }, linkText: { color: '#242424', fontSize: 16, textDecorationLine: 'underline' },
  note: { minHeight: 180, borderWidth: 1, borderColor: '#d5d5d5', borderRadius: 8, padding: 16, fontSize: 16, lineHeight: 24, color: '#242424', textAlignVertical: 'top' }, save: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, backgroundColor: '#242424' }, saveText: { color: '#ffffff', fontSize: 15 }, disabled: { opacity: 0.4 },
})
