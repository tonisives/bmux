import { Modal, ScrollView, StyleSheet, Text, View, KeyboardAvoidingView, Platform } from 'react-native'
import type { ReactNode } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from './Button'
import { colors, radius, styles } from '../theme'

export let Sheet = ({ title, visible, close, children }: { title: string; visible: boolean; close: () => void; children: ReactNode }) => {
  let insets = useSafeAreaInsets()
  if (Platform.OS === 'web' && !visible) return null
  return (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView style={local.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[local.sheet, { paddingBottom: Math.max(24, insets.bottom) }]}>
        <View style={[styles.row, local.header]}><Text style={local.title}>{title}</Text><Button title="Close" onPress={close} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={local.content}>{children}</ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>
  )
}
let local = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { maxHeight: '85%', width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, paddingBottom: 24 },
  header: { justifyContent: 'space-between', padding: 16, borderBottomColor: colors.border, borderBottomWidth: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' }, content: { padding: 16, gap: 16 },
})
