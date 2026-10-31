import { Modal, ScrollView, StyleSheet, Text, View, KeyboardAvoidingView, Platform } from 'react-native'
import type { ReactNode } from 'react'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Button } from './Button'
import { colors, radius, styles } from '../theme'

export let Sheet = ({ title, visible, close, children }: { title: string; visible: boolean; close: () => void; children: ReactNode }) => {
  if (Platform.OS === 'web' && !visible) return null
  return (
  <Modal visible={visible} transparent={Platform.OS !== 'ios'} presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'} animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={close}>
    <SafeAreaProvider><SafeAreaView style={[local.safeArea, Platform.OS === 'ios' && local.nativeSurface]} edges={['top', 'bottom', 'left', 'right']}><KeyboardAvoidingView style={local.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[local.sheet, Platform.OS === 'ios' && local.nativeSheet]}>
        <View style={[styles.row, local.header]}><Text style={local.title}>{title}</Text><Button title="Close" onPress={close} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={local.content}>{children}</ScrollView>
      </View>
    </KeyboardAvoidingView></SafeAreaView></SafeAreaProvider>
  </Modal>
  )
}
let local = StyleSheet.create({
  nativeSurface: { backgroundColor: colors.surface }, nativeSheet: { flex: 1, maxHeight: '100%', maxWidth: '100%' },
  safeArea: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { maxHeight: '85%', width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, paddingBottom: 24 },
  header: { justifyContent: 'space-between', padding: 16, borderBottomColor: colors.border, borderBottomWidth: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' }, content: { padding: 16, gap: 16 },
})
