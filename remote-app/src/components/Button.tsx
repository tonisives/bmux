import { ActivityIndicator, Pressable, Text, StyleSheet } from 'react-native'
import { colors, radius } from '../theme'

export let Button = ({ title, onPress, primary = false, disabled = false, busy = false }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean; busy?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy} onPress={onPress} style={[local.button, primary && local.primary, (disabled || busy) && local.disabled]}>
    {busy ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={[local.text, primary && local.primaryText]}>{title}</Text>}
  </Pressable>
)
let local = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.grouped },
  primary: { backgroundColor: colors.accent }, disabled: { opacity: 0.45 },
  text: { fontSize: 14, fontWeight: '500', color: colors.text }, primaryText: { color: '#0a0a0a', fontWeight: '600' },
})
