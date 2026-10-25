import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Attention, Host, Selection } from '../types'
import { paneAttention } from '../attention-presentation'
import { canManageHost } from '../host-access'
import { colors, radius, styles } from '../theme'
import { Button } from './Button'

export let SessionList = ({ hosts, attention = [], selection, select, create, header, footer, empty }: {
  hosts: Host[]; selection?: Selection; select: (selection: Selection) => void; create?: (host: Host) => void
  attention?: Attention[]
  header?: ReactNode; footer?: ReactNode; empty?: ReactNode
}) => {
  let [machine, setMachine] = useState('')
  let [search, setSearch] = useState('')
  let available = hosts.filter(host => !machine || host.id === machine)
  let creator = available.find(host => canManageHost(host) && host.capabilities?.sessionCreate === 1)
  return <View style={local.screen}>
    <ScrollView horizontal style={local.machineBar} contentContainerStyle={local.machineContent} showsHorizontalScrollIndicator={false}>
      {[{ id: '', service: 'All machines' }, ...hosts].map(host => <Pressable key={host.id} accessibilityRole="button" accessibilityLabel={host.service} accessibilityState={{ selected: host.id === machine }} onPress={() => setMachine(host.id)} style={[local.machine, host.id === machine && local.machineSelected]}>
        <View style={[local.dot, { backgroundColor: host.id ? colors.success : colors.secondary }]} /><Text style={[local.machineText, host.id === machine && local.selectedText]}>{host.service}</Text>
      </Pressable>)}
    </ScrollView>
    <View style={local.toolbar}>
      <View style={local.search}><Ionicons name="search" size={17} color={colors.secondary} /><TextInput style={local.searchInput} placeholder="Search sessions" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} accessibilityLabel="Search sessions" /></View>
      {!!create && !!creator && <Button title="New session" onPress={() => create(creator)} />}
    </View>
    <ScrollView style={local.scroll} contentContainerStyle={local.list}>
      {header}
      {available.map(host => <View key={host.id} style={local.host}>
        <Text style={local.hostName}>{host.service}</Text>
        {host.sessions.filter(session => (session.name + ' ' + session.panes.map(pane => pane.title).join(' ')).toLowerCase().includes(search.toLowerCase())).map(session => {
          let selected = selection?.host === host.id && selection.session === session.id
          let requests = session.panes.map(pane => paneAttention(attention, { host: host.id, generation: host.generation, session: session.id, pane: pane.id })).filter(Boolean)
          let needsHelp = requests.some(item => item?.status === 'pending')
          let open = (pane: string) => select({ host: host.id, generation: host.generation, session: session.id, pane })
          return <View key={session.id} style={[local.session, selected && local.sessionSelected]}>
            <Pressable accessibilityRole="button" accessibilityLabel={'Open ' + session.name} onPress={() => { if (session.panes[0]) open(session.panes[0].id) }} style={local.sessionHeading}>
              <View style={local.sessionIcon}><Ionicons name="browsers-outline" size={21} color={colors.text} /></View>
              <View style={local.sessionText}><Text style={local.sessionName} numberOfLines={1}>{session.name}</Text><Text style={styles.secondary}>{session.panes.length} {session.panes.length === 1 ? 'page' : 'pages'}{host.permission === 'watch' ? ' · Watch' : ''}{requests.length > 0 && <Text style={local.needsHelp}>{needsHelp ? ' · Needs help' : ' · Checking'}</Text>}</Text></View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
            {session.panes.length > 1 && <View style={local.panes}>{session.panes.map(pane => {
              let request = paneAttention(attention, { host: host.id, generation: host.generation, session: session.id, pane: pane.id })
              return <Pressable key={pane.id} accessibilityRole="button" accessibilityLabel={'Open ' + (pane.title || 'page')} accessibilityState={{ selected: selected && selection?.pane === pane.id }} accessibilityHint={request ? request.status === 'verifying' ? 'The agent is checking the result' : 'Needs your help' : undefined} style={[local.pane, selected && selection?.pane === pane.id && local.paneSelected]} onPress={() => open(pane.id)}>
              <Ionicons name="globe-outline" size={15} color={colors.secondary} /><Text style={local.paneTitle} numberOfLines={1}>{pane.title || 'Untitled page'}</Text>
              {!!request && <Ionicons name={request.status === 'verifying' ? 'hourglass-outline' : 'hand-left-outline'} size={15} color={colors.warning} accessibilityLabel={request.status === 'verifying' ? 'Checking' : 'Needs help'} />}
            </Pressable>})}</View>}
          </View>
        })}
      </View>)}
      {hosts.length === 0 && empty}
      {footer}
    </ScrollView>
  </View>
}

let local = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 }, scroll: { flex: 1 },
  machineBar: { flexGrow: 0, maxHeight: 68 }, machineContent: { padding: 16, gap: 8, alignItems: 'center' },
  machine: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'transparent' }, machineSelected: { backgroundColor: colors.grouped, borderColor: colors.borderLight }, machineText: { color: colors.secondary, fontSize: 13, fontWeight: '500' }, selectedText: { color: colors.text }, dot: { width: 6, height: 6, borderRadius: 3 },
  toolbar: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 8 }, search: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8, backgroundColor: colors.surface, borderRadius: radius.pill }, searchInput: { minWidth: 0, color: colors.text, paddingVertical: 13, flex: 1, fontSize: 14 },
  list: { padding: 16, gap: 24, paddingBottom: 32 }, host: { gap: 10 }, hostName: { color: colors.secondary, fontSize: 13, fontWeight: '600', paddingHorizontal: 8 },
  session: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1, borderColor: 'transparent', overflow: 'hidden' }, sessionSelected: { borderColor: colors.borderLight }, sessionHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 76, paddingHorizontal: 16, paddingVertical: 14 }, sessionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.grouped, alignItems: 'center', justifyContent: 'center' }, sessionText: { flex: 1, minWidth: 0, gap: 5 }, sessionName: { color: colors.text, fontWeight: '600', fontSize: 16 },
  panes: { paddingHorizontal: 8, paddingBottom: 8, gap: 2 }, pane: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: radius.sm }, paneSelected: { backgroundColor: colors.grouped }, paneTitle: { flex: 1, color: colors.secondary, fontSize: 14 }, needsHelp: { color: colors.warning },
})
