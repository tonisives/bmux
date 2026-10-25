import { ActivityIndicator, Pressable, Text, StyleSheet } from 'react-native'
import { colors, radius } from '../theme'

export let Button = ({ title, onPress, primary = false, disabled = false, busy = false }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean; busy?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [local.button, primary && local.primary, pressed && local.pressed, (disabled || busy) && local.disabled]}>
    {busy ? <ActivityIndicator color={primary ? colors.bg : colors.text} size="small" /> : <Text style={[local.text, primary && local.primaryText]}>{title}</Text>}
  </Pressable>
)
let local = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  primary: { backgroundColor: colors.text, borderColor: colors.text }, pressed: { opacity: 0.75 }, disabled: { opacity: 0.45 },
  text: { fontSize: 14, fontWeight: '500', color: colors.text }, primaryText: { color: '#0a0a0a', fontWeight: '600' },
})
