// Adapted from Clawtab's MIT-licensed shared theme. See THIRD_PARTY_NOTICES.md.
import { StyleSheet } from 'react-native'

export let colors = {
  bg: '#0a0a0a', surface: '#161616', grouped: '#202020', border: '#2a2a2a', borderLight: '#3a3a3a',
  text: '#e4e4e4', secondary: '#98989d', muted: '#666666',
  accent: '#7986cb', accentBg: 'rgba(121,134,203,0.12)',
  success: '#32d74b', warning: '#ff9f0a', danger: '#ff453a',
}
export let spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export let radius = { sm: 16, md: 24, lg: 28, pill: 999 }
export let styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { color: colors.text, fontSize: 15 },
  secondary: { color: colors.secondary, fontSize: 13 },
  title: { color: colors.text, fontSize: 24, fontWeight: '600' },
  label: { color: colors.secondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: 'continuous', padding: 20, gap: 12 },
  input: { color: colors.text, backgroundColor: colors.grouped, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 12, fontSize: 16 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
})
