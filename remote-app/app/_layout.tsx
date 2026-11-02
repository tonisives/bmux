import { useAssets } from 'expo-asset'
import { useFonts } from 'expo-font'
import Ionicons from '@expo/vector-icons/Ionicons'
import { brandIcon } from '../src/components/Brand'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RemoteProvider } from '../src/RemoteContext'
import { colors } from '../src/theme'

export let Layout = () => {
  let [assets, assetError] = useAssets([brandIcon])
  let [fonts, fontError] = useFonts(Ionicons.font)
  if ((!assets && !assetError) || (!fonts && !fontError)) return null
  return <SafeAreaProvider><RemoteProvider><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'none' }} /></RemoteProvider></SafeAreaProvider>
}
export { Layout as default }
