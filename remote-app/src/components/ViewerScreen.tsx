import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useRemote } from '../RemoteContext'
import { colors, styles } from '../theme'
import { fitViewport } from '../viewport'
import { browserAddress } from '../address'
import { useCompactHeight } from '../useSplitView'
import type { Frame } from '../viewport'
import { BrowserSurface } from './BrowserSurface'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { NewPageSheet } from './NewPageSheet'
import { PageConnectionSheet } from './PageConnectionSheet'

export let ViewerScreen = () => {
  let remote = useRemote()
  let compact = useCompactHeight()
  let [inputMode, setInputMode] = useState<'address' | 'text'>()
  let [text, setText] = useState('')
  let [busy, setBusy] = useState(false)
  let [takeover, setTakeover] = useState(false)
  let [newPage, setNewPage] = useState(false)
  let [connection, setConnection] = useState(false)
  let frame = useRef<Frame>({ width: 390, height: 640 })
  let selection = remote.selection
  let host = remote.hosts.find(item => item.id === selection?.host)
  let session = remote.state?.sessions.find(item => item.id === selection?.session)
  let pane = session?.windows.flatMap(item => item.panes).find(item => item.id === remote.state?.pane)
  let lease = selection && remote.state?.controls[selection.session]
  let controlling = !!lease && lease.owner === remote.viewer?.id
  let occupied = !!lease && !controlling
  let viewport = remote.state && remote.state.viewports[remote.state.pane]
  let help = remote.state?.attention?.find(item => item.pane === remote.state?.pane)
  let attention = remote.target
  let verifying = attention?.status === 'verifying'
  let verified = attention?.status === 'resolved' && attention.attempt?.outcome === 'verified'
  let failed = attention?.status === 'pending' && !!attention.attempt?.outcome
  let clearInput = () => { setText(''); setInputMode(undefined) }
  useEffect(() => {
    clearInput(); setTakeover(false); setNewPage(false); setConnection(false)
  }, [selection?.host, selection?.generation, selection?.session, selection?.pane, controlling, lease?.generation])
  let action = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try { await run() } catch (error) { remote.setError((error as Error).message) } finally { setBusy(false) }
  }
  let acquire = (replace = false) => action(async () => {
    await remote.request({ type: 'acquire', session: selection?.session, ...(replace ? { takeover: true } : {}) })
    remote.viewer?.send({ type: 'state' })
    setTakeover(false)
  })
  let release = () => { remote.viewer?.send({ type: 'release', session: selection?.session }); remote.viewer?.send({ type: 'state' }) }
  let command = (method: string, args: Record<string, unknown> = {}) => {
    if (!controlling || !remote.state) return
    remote.viewer?.send({ type: 'command', generation: lease?.generation, command: { method, args: { tab: remote.state.pane, ...args } } })
  }
  let key = (keyCode: string) => {
    if (!controlling || !viewport) return
    for (let type of ['keyDown', 'keyUp']) remote.viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: viewport.generation, event: { type, keyCode } })
  }
  let submit = () => {
    if (!controlling) return
    if (inputMode === 'address') {
      try { command('navigate', { url: browserAddress(text) || 'about:blank' }) }
      catch (error) { remote.setError((error as Error).message); return }
    }
    else remote.viewer?.send({ type: 'text', generation: lease?.generation, text })
    clearInput()
  }
  return <View style={local.screen}>
    <View style={[local.header, compact && local.compactHeader]}>
      <Button title="Sessions" onPress={remote.close} />
      <View style={local.heading}><Text style={styles.text} numberOfLines={1}>{pane?.title || host?.sessions.find(item => item.id === selection?.session)?.name || 'Browser'}</Text><Text style={styles.secondary} numberOfLines={1}>{pane?.url || host?.service}</Text></View>
      {host?.permission === 'control' && <Button title={controlling ? 'Release' : occupied ? 'Take over' : 'Take control'} primary={!controlling} busy={busy} disabled={!remote.state} onPress={() => controlling ? release() : occupied ? setTakeover(true) : void acquire()} />}
    </View>
    {(!!help || verifying || verified) && <View style={[local.attention, compact && local.compactAttention]}>
      <Text style={[local.attentionText, compact && local.compactAttentionText, verified && { color: colors.success }]} numberOfLines={compact ? 1 : undefined}>{verifying ? 'Verifying' : verified ? 'Verified · Agent resumed' : failed ? 'Still needs help' : help?.reason === 'help' ? 'Agent needs your help' : 'Automation needs verification'}</Text>
      {!compact && !verified && <Text style={styles.secondary}>{verifying ? 'The agent is checking the result.' : failed ? 'Verification did not finish successfully. The task is paused.' : 'Resolve the issue, then resume.'}</Text>}
      {!!help && !verifying && !verified && <View style={styles.row}>
        {host?.capabilities?.verifiedAttention === 1 && attention?.status === 'pending' && <Button title={failed ? 'Retry resume' : 'Resume agent'} primary busy={busy} disabled={!controlling} onPress={() => void action(() => remote.resume(attention.id))} />}
        <Button title="Leave paused" onPress={remote.close} />
      </View>}
    </View>}
    <BrowserSurface stream={remote.stream} viewport={viewport} controlling={controlling} busy={remote.connecting} frameChanged={value => { frame.current = value }} input={(event, generation) => {
      if (controlling && viewport?.generation === generation) remote.viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: generation, event })
    }} />
    {!compact && session && session.windows.flatMap(item => item.panes).length > 1 && <ScrollView horizontal style={local.pages} contentContainerStyle={local.pageContent}>
      {session.windows.flatMap(item => item.panes).map(item => <Button key={item.id} title={item.title || 'Page'} primary={item.id === selection?.pane} onPress={() => selection && void remote.watch({ ...selection, pane: item.id }).catch(error => remote.setError(error.message))} />)}
    </ScrollView>}
    <View style={[local.footer, compact && local.compactFooter]}>
      {(!compact || !controlling) && <Text style={styles.secondary}>{controlling ? 'Control' : 'Watch'}{viewport ? ' · ' + viewport.width + ' × ' + viewport.height : ''}</Text>}
      {controlling ? <ScrollView horizontal contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        <Button title="Back" onPress={() => command('back')} />
        <Button title="Forward" onPress={() => command('forward')} />
        <Button title="Reload" onPress={() => command('reload')} />
        <Button title="Address" onPress={() => { setText(pane?.url ?? ''); setInputMode('address') }} />
        {host?.capabilities?.pageCreate === 1 && !!session?.revision && <Button title="New page" onPress={() => setNewPage(true)} />}
        {host?.capabilities?.proxy === 1 && !!session?.revision && !!pane?.profileId && <Button title="Connection" onPress={() => setConnection(true)} />}
        <Button title="Keyboard" onPress={() => { setText(''); setInputMode('text') }} />
        <Button title="Paste" onPress={() => void action(async () => { let text = await Clipboard.getStringAsync(); if (text) remote.viewer?.send({ type: 'text', generation: lease?.generation, text }) })} />
        <Button title="Enter" onPress={() => key('Enter')} />
        <Button title="Tab" onPress={() => key('Tab')} />
        <Button title="Backspace" onPress={() => key('Backspace')} />
        <Button title="Fit to phone" onPress={() => void action(async () => { await remote.request({ type: 'resize', generation: lease?.generation, ...fitViewport(frame.current) }); remote.viewer?.send({ type: 'state' }) })} />
      </ScrollView> : !compact && <Text style={styles.secondary}>Pinch to zoom · Drag to pan</Text>}
    </View>
    <Sheet title={inputMode === 'address' ? 'Open address' : 'Type into page'} visible={!!inputMode} close={clearInput}>
      <TextInput autoFocus value={text} onChangeText={setText} onSubmitEditing={submit} style={styles.input} autoCapitalize="none" autoCorrect={inputMode !== 'address'} keyboardType={inputMode === 'address' ? 'url' : 'default'} placeholder={inputMode === 'address' ? 'https://example.com' : 'Text to insert'} placeholderTextColor={colors.muted} accessibilityLabel={inputMode === 'address' ? 'Address' : 'Text'} />
      <Button title={inputMode === 'address' ? 'Go' : 'Type'} primary disabled={!text.trim() || !controlling} onPress={submit} />
    </Sheet>
    <Sheet title="Take control?" visible={takeover} close={() => setTakeover(false)}>
      <Text style={styles.text}>Another viewer is controlling this session.</Text>
      <Button title="Take over" primary busy={busy} onPress={() => void acquire(true)} />
    </Sheet>
    <NewPageSheet visible={newPage} close={() => setNewPage(false)} created={() => setNewPage(false)} />
    <PageConnectionSheet visible={connection} close={() => setConnection(false)} reopened={() => setConnection(false)} />
  </View>
}
let local = StyleSheet.create({
  compactHeader: { padding: 6, gap: 8 }, compactFooter: { padding: 6, gap: 4 }, compactAttention: { paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }, compactAttentionText: { flex: 1 },
  screen: { flex: 1, minHeight: 0 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomColor: colors.border, borderBottomWidth: 1 },
  heading: { flex: 1, gap: 4, minWidth: 0 }, footer: { padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: colors.border },
  pages: { flexGrow: 0, maxHeight: 58, backgroundColor: colors.surface }, pageContent: { padding: 8, gap: 8 },
  attention: { paddingVertical: 10, paddingHorizontal: 16, gap: 4, backgroundColor: 'rgba(255,159,10,0.1)' }, attentionText: { color: colors.warning, fontWeight: '600', fontSize: 14 },
})
