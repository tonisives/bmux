import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { colors, radius, styles } from '../theme'
import { useCompactHeight, useSplitView } from '../useSplitView'
import type { Attention, Host, Selection } from '../types'
import { Button } from './Button'
import { Brand } from './Brand'
import { SessionList } from './SessionList'
import { AttentionInbox, AttentionSummary } from './AttentionInbox'

let demoHost: Host = {
  id: 'demo', service: 'Demo browser', generation: 'demo', permission: 'control',
  key: { kty: 'OKP', crv: 'Ed25519', x: '' },
  sessions: [{ id: 'demo-research', name: 'Shopping research', panes: [{ id: 'demo-shop', title: 'Field Notes' }, { id: 'demo-prices', title: 'Price tracker' }] }],
}
let firstPage: Selection = { host: demoHost.id, generation: demoHost.generation, session: 'demo-research', pane: 'demo-shop' }

export let DemoWorkspace = ({ close, connect }: { close: () => void; connect: () => void }) => {
  let split = useSplitView()
  let compact = useCompactHeight()
  let [selection, setSelection] = useState<Selection | undefined>(firstPage)
  let [controlling, setControlling] = useState(false)
  let [confirmed, setConfirmed] = useState(false)
  let [resumed, setResumed] = useState(false)
  let [inbox, setInbox] = useState(false)
  let [createdAt] = useState(() => new Date().toISOString())
  let prices = selection?.pane === 'demo-prices'
  let attention: Attention = { ...firstPage, id: 'demo-help', episode: 'demo-stock', reason: 'help', status: resumed ? 'resolved' : 'pending', resolved: resumed, revision: resumed ? 2 : 1, online: true, createdAt }
  let openInbox = () => { setControlling(false); setInbox(true) }
  let openAttention = () => { setControlling(false); setSelection(firstPage); setInbox(false) }
  let resume = () => { setResumed(true); setControlling(false) }
  return <SafeAreaView style={styles.screen}>
    <View style={[local.header, compact && local.compactHeader]}>
      <View style={local.identity}><Brand /><View style={local.demoBadge}><Text style={local.demoText}>Demo</Text></View></View>
      <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel={'Attention, ' + (resumed ? 0 : 1) + ' pending'} style={local.bell} onPress={openInbox}><Ionicons name="notifications-outline" size={21} color={colors.secondary} />{!resumed && <View style={local.badge}><Text style={local.badgeText}>1</Text></View>}</Pressable><Button title="Exit demo" onPress={close} /></View>
    </View>
    <View style={local.workspace}>
      {(split || (!selection && !inbox)) && <View style={split ? local.sidebar : local.list}>
        <SessionList hosts={[demoHost]} attention={[attention]} selection={selection} select={value => { setSelection(value); setInbox(false) }} header={<AttentionSummary items={[attention]} hosts={[demoHost]} open={openAttention} showAll={openInbox} />} footer={<View style={local.guide}>
          <Text style={local.guideTitle}>Your browser, in one step</Text><Text style={local.description}>Sign in to open your included browser or connect your computer.</Text><Button title="Use my browser" onPress={connect} />
        </View>} />
      </View>}
      {inbox ? <View style={local.detail}><AttentionInbox items={[attention]} hosts={[demoHost]} open={openAttention} /></View> : selection ? <View style={local.detail}>
        <View style={[local.toolbar, compact && local.compactToolbar]}>{!(compact && split) && <Button title="Sessions" onPress={() => setSelection(undefined)} />}<View style={local.heading}><Text style={styles.text} numberOfLines={1}>{prices ? 'Price tracker' : 'Field Notes'}</Text><Text style={styles.secondary}>{compact ? controlling ? 'Control' : 'Watch' : 'Sample page'}</Text></View><Button title={controlling ? 'Release' : 'Take control'} primary={!controlling} onPress={() => setControlling(!controlling)} /></View>
        <View style={[local.attention, compact && local.compactAttention]}>
          <View style={[local.attentionHeading, compact && local.compactAttentionHeading]}><Ionicons name={resumed ? 'checkmark-circle-outline' : 'hand-left-outline'} size={20} color={resumed ? colors.success : colors.warning} />
            <View style={local.heading}><Text style={local.attentionTitle} numberOfLines={compact ? 1 : undefined}>{resumed ? 'Demo agent resumed' : 'Demo agent needs your help'}</Text>{!compact && <Text style={styles.secondary}>{resumed ? 'Stock confirmed. The sample task is complete.' : confirmed ? 'Stock confirmed. Resume when you’re ready.' : 'Take control and confirm the notebook is in stock.'}</Text>}</View>
          </View>
          {!resumed && confirmed && <Button title="Resume demo agent" disabled={!controlling} onPress={resume} />}
        </View>
        {!compact && <View style={local.address}><Ionicons name="lock-closed-outline" size={13} color={colors.secondary} /><Text style={styles.secondary}>{prices ? 'tracker.example/notebooks' : 'fieldnotes.example/notebooks'}</Text></View>}
        <ScrollView testID="demo-browser-page" style={local.page} contentContainerStyle={local.pageContent}>
          {prices ? <>
            <Text style={local.siteLabel}>PRICE TRACKER</Text><Text style={local.pageTitle}>Notebook watchlist</Text><Text style={local.pageDescription}>Compare the two pages in this sample session.</Text>
            <View style={local.tableHeader}><Text style={local.column}>Item</Text><Text style={local.price}>Price</Text><Text style={local.stock}>Stock</Text></View>
            <View style={local.tableRow}><Text style={local.column}>Pocket notebook</Text><Text style={local.price}>$12.00</Text><Text style={local.stock}>{confirmed ? 'Confirmed' : 'Needs review'}</Text></View>
            <View style={local.tableRow}><Text style={local.column}>Desk notebook</Text><Text style={local.price}>$18.00</Text><Text style={local.stock}>In stock</Text></View>
            <Text style={local.pageHint}>Select Field Notes to check the item, then return here.</Text>
          </> : <>
            <View style={local.siteHeader}><Text style={local.siteLabel}>FIELD NOTES</Text><Text style={local.siteLink}>Notebooks</Text></View>
            <Text style={local.pageTitle}>Pocket notebook</Text><Text style={local.pageDescription}>48 pages · Plain paper · 90 × 140 mm</Text>
            <View style={local.product}>
              <View style={local.notebook}><View style={local.binding} /><Text style={local.notebookTitle}>FIELD{ '\n' }NOTES</Text><Text style={local.notebookFoot}>48 PAGES / PLAIN</Text></View>
              <View style={local.productText}><Text style={local.productName}>Pocket notebook</Text><Text style={local.productPrice}>$12.00</Text><Text style={local.pageDescription}>In stock · Ships in 2 days</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Confirm stock" accessibilityState={{ disabled: !controlling || confirmed }} disabled={!controlling || confirmed} onPress={() => setConfirmed(true)} style={[local.confirm, (!controlling || confirmed) && local.disabled]}><Text style={local.confirmText}>{confirmed ? 'Stock confirmed' : 'Confirm stock'}</Text></Pressable>
              </View>
            </View>
          </>}
        </ScrollView>
        {!compact && <><ScrollView horizontal style={local.tabs} contentContainerStyle={local.tabContent}>{demoHost.sessions[0].panes.map(pane => <Button key={pane.id} title={pane.title} primary={selection.pane === pane.id} onPress={() => setSelection({ ...firstPage, pane: pane.id })} />)}</ScrollView>
        <View style={local.footer}><Text style={styles.secondary}>{controlling ? 'Control' : 'Watch'} · Demo pages</Text><Button title="Use my browser" onPress={connect} /></View></>}
      </View> : split && <View style={[local.detail, local.empty]}><Text style={styles.secondary}>Select a sample page</Text></View>}
    </View>
  </SafeAreaView>
}

let local = StyleSheet.create({
  compactHeader: { minHeight: 48 }, compactToolbar: { paddingVertical: 4 }, compactAttention: { paddingVertical: 6, flexWrap: 'nowrap' }, compactAttentionHeading: { flexBasis: 0, flexShrink: 1 },
  header: { minHeight: 68, paddingHorizontal: 16, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, demoBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.grouped }, demoText: { color: colors.warning, fontSize: 12, fontWeight: '600' }, bell: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }, badge: { position: 'absolute', right: 0, top: 1, backgroundColor: colors.warning, minWidth: 16, borderRadius: 8, alignItems: 'center', padding: 2 }, badgeText: { fontSize: 10, fontWeight: '700', color: colors.bg },
  workspace: { flex: 1, minHeight: 0, flexDirection: 'row' }, sidebar: { width: 380, maxWidth: '45%', minHeight: 0, borderRightWidth: 1, borderRightColor: colors.border }, list: { flex: 1 }, detail: { flex: 1, minWidth: 0, minHeight: 0 }, empty: { alignItems: 'center', justifyContent: 'center' },
  guide: { gap: 12, padding: 8 }, guideTitle: { color: colors.text, fontSize: 18, fontWeight: '600' }, description: { color: colors.secondary, fontSize: 14, lineHeight: 21 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }, heading: { flex: 1, minWidth: 0, gap: 4 }, attention: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface }, attentionHeading: { flexDirection: 'row', flexGrow: 1, flexBasis: 260, alignItems: 'center', gap: 10 }, attentionTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  address: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 36, backgroundColor: colors.grouped }, page: { flex: 1, backgroundColor: '#f5f3ee' }, pageContent: { padding: 24, gap: 24, flexGrow: 1 },
  siteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottomColor: '#d6d3ca', borderBottomWidth: 1 }, siteLabel: { color: '#242724', fontSize: 13, fontWeight: '700', letterSpacing: 2 }, siteLink: { color: '#55594f', fontSize: 13 }, pageTitle: { color: '#242724', fontSize: 32, fontWeight: '600', letterSpacing: -1, lineHeight: 38 }, pageDescription: { color: '#65675e', fontSize: 14, lineHeight: 21 },
  product: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: 'center' }, notebook: { width: 140, height: 184, padding: 18, backgroundColor: '#b9a88b', borderRadius: 4, justifyContent: 'space-between', overflow: 'hidden' }, binding: { position: 'absolute', top: 0, bottom: 0, left: 8, width: 1, backgroundColor: '#80735e' }, notebookTitle: { fontSize: 27, lineHeight: 32, fontWeight: '700', color: '#383b32', marginTop: 12, letterSpacing: -0.8 }, notebookFoot: { fontSize: 8, color: '#383b32', letterSpacing: 1 }, productText: { gap: 12, flex: 1, minWidth: 150 }, productName: { color: '#242724', fontSize: 18, fontWeight: '600' }, productPrice: { color: '#242724', fontSize: 18 }, confirm: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: '#242724' }, confirmText: { color: '#ffffff', fontSize: 14, fontWeight: '600' }, disabled: { opacity: 0.45 },
  tableHeader: { flexDirection: 'row', gap: 12, borderBottomColor: '#c9c6bd', borderBottomWidth: 1, paddingVertical: 12 }, tableRow: { flexDirection: 'row', gap: 12, borderBottomColor: '#dedbd3', borderBottomWidth: 1, paddingVertical: 18 }, column: { flex: 1, color: '#242724', fontSize: 13 }, price: { width: 55, color: '#242724', fontSize: 13 }, stock: { width: 82, color: '#65675e', fontSize: 12 }, pageHint: { color: '#65675e', fontSize: 13, lineHeight: 20 },
  tabs: { flexGrow: 0, maxHeight: 64, backgroundColor: colors.surface }, tabContent: { padding: 10, gap: 8 }, footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
})
