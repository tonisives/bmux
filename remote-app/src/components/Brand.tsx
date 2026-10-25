import { Image, Platform, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

let icon = Platform.OS === 'web'
  ? { uri: 'https://cdn.digthree.tonis.dev/bmux/website-ca1a3c8712d7/icon-512.png' }
  : require('../../../design/app-icon.png')

export let Brand = () => <View style={local.brand}>
  <Image source={icon} style={local.icon} resizeMode="contain" accessible={false} />
  <Text style={local.wordmark} numberOfLines={1}>bmux</Text>
</View>

let local = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 },
  icon: { width: 28, height: 28, flexShrink: 0 },
  wordmark: { color: colors.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.4, flexShrink: 1 },
})
