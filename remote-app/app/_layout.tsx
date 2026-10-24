import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RemoteProvider } from '../src/RemoteContext'
import { colors } from '../src/theme'

export let Layout = () => <SafeAreaProvider><RemoteProvider><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'none' }} /></RemoteProvider></SafeAreaProvider>
export { Layout as default }
