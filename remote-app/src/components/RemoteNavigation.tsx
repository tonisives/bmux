import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { colors } from '../theme'
import { Brand } from './Brand'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'

export type RemoteTab = 'sessions' | 'settings' | 'search'

export let RemoteHeader = ({ notifications, onNotifications, demo = false, onHome }: {
  notifications: number; onNotifications: () => void; demo?: boolean; onHome?: () => void
}) => <View style={local.header}>
  <View style={local.identity}>
    {onHome ? <Pressable accessibilityRole="button" accessibilityLabel="Sessions" onPress={onHome}><Brand /></Pressable> : <Brand />}
    {demo && <Text style={local.demo}>Demo</Text>}
  </View>
  <Pressable accessibilityRole="button" accessibilityLabel={'Attention, ' + notifications + ' pending'} onPress={onNotifications} style={local.notification}>
    <Ionicons name="notifications-outline" size={22} color={colors.text} />
    {notifications > 0 && <Text style={local.badge}>{notifications}</Text>}
  </Pressable>
</View>

let tabs: { id: RemoteTab; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'sessions', title: 'Sessions', icon: 'browsers-outline' },
  { id: 'settings', title: 'Settings', icon: 'settings-outline' },
  { id: 'search', title: 'Search', icon: 'search-outline' },
]

export let RemoteTabs = ({ active, select }: { active: RemoteTab; select: (tab: RemoteTab) => void }) => {
  let glass = Platform.OS === 'ios' && isLiquidGlassAvailable()
  let content = <View accessibilityRole="tablist" style={[local.tabs, !glass && local.fallback]}>
    {tabs.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.title} accessibilityState={{ selected: active === tab.id }} aria-selected={active === tab.id} onPress={() => select(tab.id)} style={({ pressed }) => [local.tab, active === tab.id && local.selected, pressed && local.pressed]}>
      <Ionicons name={tab.icon} size={22} color={active === tab.id ? colors.text : colors.secondary} />
      <Text style={[local.label, active === tab.id && local.selectedLabel]}>{tab.title}</Text>
    </Pressable>)}
  </View>
  return <View style={local.tabContainer}>{glass
    ? <GlassView glassEffectStyle="regular" isInteractive colorScheme="dark" style={local.glass}>{content}</GlassView>
    : content}</View>
}

let local = StyleSheet.create({
  header: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }, demo: { color: colors.secondary, fontSize: 12 },
  notification: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', right: 0, top: 2, minWidth: 16, padding: 2, borderRadius: 8, backgroundColor: colors.warning, color: colors.bg, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  tabContainer: { marginHorizontal: 12, marginVertical: 8 }, glass: { borderRadius: 32, overflow: 'hidden' },
  tabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 32 }, fallback: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 28 }, selected: { backgroundColor: 'rgba(121,134,203,0.38)' }, pressed: { opacity: 0.76, transform: [{ scale: 0.96 }] }, label: { color: colors.secondary, fontSize: 12 }, selectedLabel: { color: colors.text },
})
