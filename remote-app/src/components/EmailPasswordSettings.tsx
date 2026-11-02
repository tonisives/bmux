import { useEffect, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useRemote } from '../RemoteContext'
import { colors, styles } from '../theme'
import { Button } from './Button'

export let EmailPasswordSettings = () => {
  let { api, account } = useRemote()
  let [enabled, setEnabled] = useState<boolean>()
  let [editing, setEditing] = useState(false)
  let [currentPassword, setCurrentPassword] = useState('')
  let [password, setPassword] = useState('')
  let [busy, setBusy] = useState(false)
  let [message, setMessage] = useState('')
  let [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void api<{ passwordEnabled: boolean }>('/api/auth/email/password').then(result => { if (active) setEnabled(result.passwordEnabled) }).catch(value => { if (active) setError(value.message) })
    return () => { active = false }
  }, [api])
  let save = async () => {
    if (busy || password.length < 12 || enabled && !currentPassword) return
    setBusy(true); setError(''); setMessage('')
    try {
      await api('/api/auth/email/password', { password, ...(enabled ? { currentPassword } : {}) })
      setEnabled(true); setEditing(false); setMessage('Password saved.')
    } catch (value) { setError((value as Error).message) }
    finally { setPassword(''); setCurrentPassword(''); setBusy(false) }
  }
  return <View style={styles.card}>
    <Text style={styles.label}>Email sign-in</Text>
    <Text style={styles.text}>{account?.email}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.secondary}>{message}</Text>}
    {!editing ? <Button title={enabled ? 'Change password' : 'Add password'} disabled={enabled === undefined} onPress={() => { setEditing(true); setMessage('') }} /> : <>
      {enabled && <TextInput accessibilityLabel="Current password" placeholder="Current password" placeholderTextColor={colors.muted} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" editable={!busy} style={styles.input} />}
      <TextInput accessibilityLabel="New password" placeholder="New password" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!busy} style={styles.input} onSubmitEditing={() => void save()} />
      <Text style={styles.secondary}>Use at least 12 characters.</Text>
      <Button title="Save password" busy={busy} disabled={password.length < 12 || !!enabled && !currentPassword} onPress={() => void save()} />
      <Button title="Cancel" disabled={busy} onPress={() => { setEditing(false); setPassword(''); setCurrentPassword(''); setError('') }} />
    </>}
  </View>
}
