import { ActivityIndicator, Pressable, Text, StyleSheet } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { colors, radius } from '../theme'

export let Button = ({ title, onPress, primary = false, disabled = false, busy = false, icon }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean; busy?: boolean; icon?: keyof typeof Ionicons.glyphMap }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [local.button, primary && local.primary, pressed && local.pressed, (disabled || busy) && local.disabled]}>
    {busy ? <ActivityIndicator color={primary ? colors.bg : colors.text} size="small" /> : <>{icon && <Ionicons name={icon} size={20} color={primary ? colors.bg : colors.text} />}<Text style={[local.text, primary && local.primaryText]}>{title}</Text></>}
  </Pressable>
)
let local = StyleSheet.create({
  button: { flexDirection: 'row', gap: 12, minHeight: 48, paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  primary: { backgroundColor: colors.text, borderColor: colors.text }, pressed: { opacity: 0.75 }, disabled: { opacity: 0.45 },
  text: { fontSize: 14, fontWeight: '500', color: colors.text }, primaryText: { color: '#0a0a0a', fontWeight: '600' },
})
