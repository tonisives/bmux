import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Clipboard from 'expo-clipboard'
import { useRemote } from '../RemoteContext'
import { colors, styles } from '../theme'
import { fitViewport } from '../viewport'
import { browserAddress } from '../address'
import { canManageHost } from '../host-access'
import type { Frame } from '../viewport'
import { BrowserSurface } from './BrowserSurface'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { NewPageSheet } from './NewPageSheet'
import { PageConnectionSheet } from './PageConnectionSheet'

export let ViewerScreen = () => {
  let remote = useRemote()
  let [details, setDetails] = useState(false)
  let [inputMode, setInputMode] = useState<'address' | 'text'>()
  let [text, setText] = useState('')
  let [busy, setBusy] = useState(false)
  let [takeover, setTakeover] = useState(false)
  let [newPage, setNewPage] = useState(false)
  let [connection, setConnection] = useState(false)
  let frame = useRef<Frame>({ width: 390, height: 640 })
  let selection = remote.selection
  let host = remote.hosts.find(item => item.id === selection?.host)
  let publishedSession = host?.sessions.find(item => item.id === selection?.session)
  let publishedPane = publishedSession?.panes.find(item => item.id === selection?.pane)
  let session = remote.state?.sessions.find(item => item.id === selection?.session)
  let pane = session?.windows.flatMap(item => item.panes).find(item => item.id === remote.state?.pane)
  let title = pane?.title || publishedPane?.title || publishedSession?.name || 'Browser'
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
  useEffect(() => { setDetails(false) }, [selection?.host, selection?.generation, selection?.session, selection?.pane])
  let action = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try { await run() } catch (error) { remote.setError((error as Error).message) } finally { setBusy(false) }
  }
  let acquire = (replace = false) => action(async () => {
    await remote.request({ type: 'acquire', session: selection?.session, ...(replace ? { takeover: true } : {}) })
    remote.viewer?.send({ type: 'state' })
    setTakeover(false); setDetails(false)
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
  let openInput = (mode: 'address' | 'text') => { setDetails(false); setText(mode === 'address' ? pane?.url ?? '' : ''); setInputMode(mode) }
  return <View style={local.screen}>
    <View style={local.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Sessions" onPress={remote.close} style={local.back}><Ionicons name="chevron-back" size={23} color={colors.text} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Page details" accessibilityHint={title} onPress={() => setDetails(true)} style={local.heading}>
        <Text style={local.title} numberOfLines={1}>{title}</Text>
        {(!!help || verifying || verified) && <Ionicons name={verified ? 'checkmark-circle-outline' : verifying ? 'hourglass-outline' : 'hand-left-outline'} size={16} color={verified ? colors.success : colors.warning} />}
        <Ionicons name="chevron-down" size={15} color={colors.secondary} />
      </Pressable>
    </View>
    <BrowserSurface stream={remote.stream} viewport={viewport} controlling={controlling} busy={remote.connecting} frameChanged={value => { frame.current = value }} input={(event, generation) => {
      if (controlling && viewport?.generation === generation) remote.viewer?.send({ type: 'input', generation: lease?.generation, viewportGeneration: generation, event })
    }} />
    <Sheet title="Page details" visible={details} close={() => setDetails(false)}>
      <Text style={styles.title}>{title}</Text>
      {!!pane?.url && <Text selectable style={styles.secondary}>{pane.url}</Text>}
      <Text style={styles.secondary}>{[host?.service, publishedSession?.name].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.text}>{controlling ? 'Control' : 'Watch'}</Text>
      {!!viewport && <Text style={styles.secondary}>{viewport.width} × {viewport.height}</Text>}
      {!!publishedPane?.lastActivityAt && <Text style={styles.secondary}>Last used {new Date(publishedPane.lastActivityAt).toLocaleString()}</Text>}
      {!!publishedPane?.agentPurpose && <Text style={styles.text}>{publishedPane.agentPurpose}</Text>}
      {host?.permission === 'control' && <Button title={controlling ? 'Release control' : occupied ? 'Take over' : 'Take control'} primary={!controlling} busy={busy} disabled={!remote.state} onPress={() => {
        if (controlling) release()
        else if (occupied) { setDetails(false); setTakeover(true) }
        else void acquire()
      }} />}
      {(!!help || verifying || verified) && <View style={local.attention}>
        <Text style={[local.attentionText, verified && { color: colors.success }]}>{verifying ? 'Checking the result' : verified ? 'Verified · Agent resumed' : failed ? 'Still needs help' : help?.reason === 'help' ? 'Agent needs your help' : 'Browser needs attention'}</Text>
        {!verified && <Text style={styles.secondary}>{verifying ? 'The agent is checking the result.' : failed ? 'The check needs another attempt. The task is paused.' : controlling ? 'Finish helping, then resume the agent.' : 'Take control to complete the browser check or help the agent.'}</Text>}
        {!!help && !verifying && !verified && <View style={styles.row}>
          {host?.capabilities?.verifiedAttention === 1 && attention?.status === 'pending' && <Button title={failed ? 'Retry resume' : 'Resume agent'} primary busy={busy} disabled={!controlling} onPress={() => void action(() => remote.resume(attention.id))} />}
          <Button title="Leave paused" onPress={remote.close} />
        </View>}
      </View>}
      {controlling && <View style={[styles.row, local.controls]}>
        <Button title="Back" onPress={() => command('back')} />
        <Button title="Forward" onPress={() => command('forward')} />
        <Button title="Reload" onPress={() => command('reload')} />
        <Button title="Address" onPress={() => openInput('address')} />
        {canManageHost(host) && host.capabilities?.pageCreate === 1 && !!session?.revision && <Button title="New page" onPress={() => { setDetails(false); setNewPage(true) }} />}
        {canManageHost(host) && host.capabilities?.proxy === 1 && !!session?.revision && !!pane?.profileId && <Button title="Connection" onPress={() => { setDetails(false); setConnection(true) }} />}
        <Button title="Keyboard" onPress={() => openInput('text')} />
        <Button title="Paste" onPress={() => void action(async () => { let text = await Clipboard.getStringAsync(); if (text) remote.viewer?.send({ type: 'text', generation: lease?.generation, text }) })} />
        <Button title="Enter" onPress={() => key('Enter')} />
        <Button title="Tab" onPress={() => key('Tab')} />
        <Button title="Backspace" onPress={() => key('Backspace')} />
        <Button title="Fit viewport" onPress={() => void action(async () => { await remote.request({ type: 'resize', generation: lease?.generation, ...fitViewport(frame.current) }); remote.viewer?.send({ type: 'state' }); setDetails(false) })} />
      </View>}
      {(session?.windows.flatMap(item => item.panes) ?? publishedSession?.panes ?? []).length > 1 && <View style={local.pages}>
        <Text style={styles.label}>Pages</Text>
        {(session?.windows.flatMap(item => item.panes) ?? publishedSession?.panes ?? []).map(item => <Button key={item.id} title={item.title || 'Page'} primary={item.id === selection?.pane} onPress={() => selection && void action(() => remote.watch({ ...selection, pane: item.id }))} />)}
      </View>}
    </Sheet>
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
  screen: { flex: 1, minHeight: 0 }, header: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 8, borderBottomColor: colors.border, borderBottomWidth: 1 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, minHeight: 44, paddingHorizontal: 8 }, title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '500' },
  pages: { gap: 8 }, controls: { flexWrap: 'wrap' },
  attention: { gap: 8 }, attentionText: { color: colors.warning, fontWeight: '600', fontSize: 14 },
})
