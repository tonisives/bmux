import { Text, View } from 'react-native'
import { useRemote } from '../RemoteContext'
import { colors, styles } from '../theme'
import { Button } from './Button'

export let IncludedBrowserCard = () => {
  let remote = useRemote(), included = remote.includedBrowser, browser = included.browser
  if (!browser) return null
  let pending = browser.state === 'starting' || browser.state === 'waking'
  let status = browser.state === 'sleeping' ? 'Sleeping' : browser.state === 'starting' ? 'Starting…' : browser.state === 'waking' ? 'Waking…' : browser.state === 'running' ? 'Ready' : browser.state === 'suspended' || browser.state === 'error' ? 'Unavailable' : 'One browser, included with relay'
  return <View style={styles.card}>
    <Text style={styles.label}>Included browser</Text>
    <Text style={styles.text}>{status}</Text>
    {browser.entitled ? <Button title={browser.state === 'sleeping' ? 'Wake browser' : browser.state === 'error' ? 'Retry browser' : 'Open browser'} primary busy={included.opening || pending} disabled={!remote.viewer || browser.state === 'suspended'} onPress={() => void included.open()} /> : <Text style={styles.secondary}>Available with a relay subscription on bmux.cc.</Text>}
    {!!included.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{included.error}</Text>}
  </View>
}
