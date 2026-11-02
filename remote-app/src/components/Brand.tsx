import { Image, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'
import { Asset } from 'expo-asset'

export let brandIcon = require('../../../design/app-icon.png')
let icon = Asset.fromModule(brandIcon)

export let Brand = () => <View style={local.brand}>
  <Image source={{ uri: icon.localUri ?? icon.uri }} style={local.icon} resizeMode="contain" accessible={false} />
  <Text style={local.wordmark} numberOfLines={1}>bmux</Text>
</View>

let local = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 },
  icon: { width: 28, height: 28, flexShrink: 0 },
  wordmark: { color: colors.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.4, flexShrink: 1 },
})
