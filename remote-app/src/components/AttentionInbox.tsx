import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Attention, Host } from '../types'
import { attentionDetails, pendingAttention } from '../attention-presentation'
import { colors, radius, styles } from '../theme'
import { Button } from './Button'

export let AttentionSummary = ({ items, hosts, open, showAll }: { items: Attention[]; hosts: Host[]; open: (id: string) => void; showAll: () => void }) => {
  let pending = pendingAttention(items)
  let item = pending[0]
  if (!item) return null
  let details = attentionDetails(item, hosts)
  return <View style={local.summary}>
    <View style={local.summaryHeading} accessibilityLiveRegion="polite"><Ionicons name={item.status === 'verifying' ? 'hourglass-outline' : 'hand-left-outline'} size={19} color={colors.warning} /><Text style={local.summaryTitle}>{pending.length === 1 ? item.status === 'verifying' ? 'Checking the result' : details.title : pending.length + ' requests need attention'}</Text></View>
    <Text style={styles.secondary} numberOfLines={2}>{[details.context, details.page].filter(Boolean).join(' · ')}</Text>
    <View style={styles.row}><Button title="Open page" onPress={() => open(item.id)} />{pending.length > 1 && <Button title="View all" onPress={showAll} />}</View>
  </View>
}

export let AttentionInbox = ({ items, hosts, open, dismiss, loadMore, loading = false, busy = false }: {
  items: Attention[]; hosts: Host[]; open: (id: string) => void; dismiss?: (id: string) => void
  loadMore?: () => void; loading?: boolean; busy?: boolean
}) => {
  let [history, setHistory] = useState(false)
  let pending = pendingAttention(items)
  let visible = history ? items : pending
  return <ScrollView contentContainerStyle={local.content}>
    <View style={local.sectionHeading}><View style={local.heading}><Text style={styles.title}>Attention</Text><Text style={styles.secondary}>{pending.length ? pending.length + (pending.length === 1 ? ' open request' : ' open requests') : 'You’re all caught up'}</Text></View><Button title={history ? 'Pending' : 'History'} onPress={() => setHistory(!history)} /></View>
    {visible.map(item => {
      let details = attentionDetails(item, hosts)
      let success = item.status === 'resolved'
      return <View key={item.id} style={local.item}>
        <Pressable accessibilityRole="button" accessibilityLabel={'Open request: ' + details.title + ', ' + details.context + (details.page ? ', ' + details.page : '')} accessibilityState={{ disabled: !details.active }} disabled={!details.active} onPress={() => open(item.id)} style={({ pressed }) => [local.open, pressed && local.pressed]}>
          <View style={local.requestHeading}><View style={local.icon}><Ionicons name={success ? 'checkmark-circle-outline' : item.status === 'verifying' ? 'hourglass-outline' : 'hand-left-outline'} size={21} color={success ? colors.success : details.active ? colors.warning : colors.secondary} /></View><Text style={local.requestTitle}>{details.title}</Text><View style={local.status}><Text style={[local.statusText, success && local.success]}>{details.status}</Text></View></View>
          {!!details.page && <Text style={local.page} numberOfLines={2}>{details.page}</Text>}
          <Text style={styles.secondary} numberOfLines={2}>{details.context}{!item.online && ' · Offline'}</Text>
          {item.status === 'pending' && !!item.attempt?.outcome && <Text style={styles.secondary}>The check needs another attempt.</Text>}
          <View style={local.requestFooter}><Text style={local.date}>{new Date(item.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>{details.active && <View style={styles.row}><Text style={local.openText}>Open page</Text><Ionicons name="arrow-forward" size={16} color={colors.text} /></View>}</View>
        </Pressable>
        {!item.dismissedAt && !!dismiss && <Pressable accessibilityRole="button" accessibilityLabel={'Dismiss request: ' + details.title} disabled={busy} onPress={() => dismiss(item.id)} style={local.dismiss}><Ionicons name="close" size={19} color={colors.secondary} /></Pressable>}
      </View>
    })}
    {!!loadMore && <Button title="Load more" busy={loading} onPress={loadMore} />}
    {visible.length === 0 && <View style={local.empty}><View style={local.emptyIcon}><Ionicons name="checkmark" size={28} color={colors.secondary} /></View><Text style={local.emptyTitle}>{history ? 'No requests yet' : 'Nothing needs your attention'}</Text><Text style={local.emptyText}>Agent help requests and browser checks appear here.</Text></View>}
  </ScrollView>
}

let local = StyleSheet.create({
  content: { padding: 20, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center' }, sectionHeading: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }, heading: { flex: 1, gap: 6 },
  item: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: 'continuous', position: 'relative', overflow: 'hidden' }, open: { padding: 18, gap: 12 }, pressed: { backgroundColor: colors.grouped }, requestHeading: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingRight: 30 }, icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.grouped }, requestTitle: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  status: { backgroundColor: colors.grouped, paddingVertical: 5, paddingHorizontal: 9, borderRadius: radius.pill }, statusText: { color: colors.secondary, fontSize: 11, fontWeight: '600' }, success: { color: colors.success }, page: { color: colors.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.2 }, requestFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 2 }, date: { color: colors.muted, fontSize: 12, flex: 1 }, openText: { color: colors.text, fontSize: 13, fontWeight: '500' }, dismiss: { position: 'absolute', right: 0, top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  summary: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 18, gap: 12 }, summaryHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, summaryTitle: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  empty: { paddingHorizontal: 24, paddingVertical: 48, gap: 16, alignItems: 'center' }, emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '500', textAlign: 'center' }, emptyText: { color: colors.secondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
})
