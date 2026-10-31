import { useEffect, useRef, useState, type ComponentProps, type ComponentRef, type KeyboardEvent, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Attention, Host, Selection } from '../types'
import type { RemotePane, RemoteSession, RemoteWindow } from '../../../src/shared/remote-sessions'
import { activityLabel } from '../../../src/shared/pane-activity'
import { remoteMachineColor, remoteMachineName, remoteMachinePalette, remoteWindowName } from '../../../src/shared/remote-tree'
import { paneAttention } from '../attention-presentation'
import { canManageHost } from '../host-access'
import { colors, styles } from '../theme'
import { Sheet } from './Sheet'

let webKeys = (run: (event: KeyboardEvent<HTMLElement>) => void) => Platform.OS === 'web' ? { onKeyDown: run as unknown as ComponentProps<typeof View>['onKeyDown'] } : {}
let treeKeys = (event: KeyboardEvent<HTMLElement>) => {
  if (event.metaKey || event.ctrlKey || event.altKey || !['j', 'k', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.target as HTMLElement).closest('input')) return
  let rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-testid="remote-tree-row"]')], index = rows.indexOf(event.target as HTMLElement)
  if (index < 0) return
  event.preventDefault()
  let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (['j', 'ArrowDown'].includes(event.key) ? 1 : -1)))
  rows[next]?.focus(); rows[next]?.scrollIntoView({ block: 'nearest' })
}
let useDisclosure = (query: string) => {
  let [expanded, setExpanded] = useState(true), ref = useRef<ComponentRef<typeof View>>(null)
  let focus = () => { if (Platform.OS === 'web') (ref.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>('[data-testid="remote-tree-row"]')?.focus() }
  let toggle = () => { setExpanded(!expanded); focus() }
  useEffect(() => { if (query) setExpanded(true) }, [query])
  let keys = webKeys(event => {
    if (event.metaKey || event.ctrlKey || event.altKey || !['h', 'l', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation(); setExpanded(event.key === 'ArrowRight' ? !expanded : event.key === 'l')
    focus()
  })
  return { expanded, toggle, keys, ref }
}
let Disclosure = ({ name, expanded, toggle, compact }: { name: string; expanded: boolean; toggle: () => void; compact?: boolean }) => <Pressable accessibilityRole="button" accessibilityLabel={(expanded ? 'Collapse ' : 'Expand ') + name} accessibilityState={{ expanded }} aria-expanded={expanded} onPress={toggle} style={[local.toggle, compact && local.windowToggle]}><Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.secondary} /></Pressable>
let Branch = ({ last, children }: { last: boolean; children: ReactNode }) => <View style={local.branch}><View style={[local.branchVertical, last ? { height: 22 } : { bottom: 0 }]} /><View style={local.branchHorizontal} />{children}</View>
let Activity = ({ when, now }: { when?: number; now: number }) => when ? <Text style={local.activity} accessibilityLabel={'Last used ' + new Date(when).toLocaleString()}>{activityLabel(when, now)}</Text> : null
let Row = ({ name, open, selected, activity, icon = true, hint, children }: { name: string; open: () => void; selected: boolean; activity?: ReactNode; icon?: boolean; hint?: string; children?: ReactNode }) => {
  let [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false)
  return <Pressable testID="remote-tree-row" accessibilityRole="button" accessibilityLabel={'Open ' + name} accessibilityState={{ selected }} aria-selected={selected} accessibilityHint={hint} onPress={open} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[local.row, (focused || hovered) && local.highlighted, selected && local.selected]}>
    {icon && <Ionicons name="globe-outline" size={15} color={colors.secondary} />}<Text style={local.name} numberOfLines={1}>{name}</Text>{children}{activity}
  </Pressable>
}
let PageRow = ({ pane, host, session, selection, select, attention, now, name, when }: { pane: RemotePane; host: Host; session: RemoteSession; selection?: Selection; select: (selection: Selection) => void; attention: Attention[]; now: number; name?: string; when?: number }) => {
  let request = paneAttention(attention, { host: host.id, generation: host.generation, session: session.id, pane: pane.id })
  return <Row name={name || pane.title || 'Blank page'} open={() => select({ host: host.id, generation: host.generation, session: session.id, pane: pane.id })} selected={selection?.host === host.id && selection.session === session.id && selection.pane === pane.id} activity={<Activity when={when ?? pane.lastActivityAt} now={now} />} hint={request ? request.status === 'verifying' ? 'The agent is checking the result' : 'Needs your help' : pane.agentPurpose}>
    {!!request && <Ionicons name={request.status === 'verifying' ? 'hourglass-outline' : 'hand-left-outline'} size={15} color={colors.warning} accessibilityLabel={request.status === 'verifying' ? 'Checking' : 'Needs help'} />}
  </Row>
}
type SessionProps = { host: Host; session: RemoteSession; selection?: Selection; select: (selection: Selection) => void; attention: Attention[]; now: number; query: string }
let WindowRow = ({ window, ...props }: SessionProps & { window: RemoteWindow }) => {
  let disclosure = useDisclosure(props.query), { host, session, selection, select, now } = props
  let selected = selection?.host === host.id && selection.session === session.id && window.panes.some(pane => pane.id === selection.pane)
  let pane = window.panes.find(pane => selected && pane.id === selection?.pane) ?? window.panes[0]
  if (!pane) return null
  let name = remoteWindowName(window, selected ? pane.id : undefined)
  let open = () => select({ host: host.id, generation: host.generation, session: session.id, pane: pane.id })
  if (window.panes.length === 1) return <PageRow {...props} pane={pane} name={name} when={window.lastActivityAt} />
  return <View ref={disclosure.ref} {...disclosure.keys}>
    <View style={local.heading}><Disclosure compact name={'pages in ' + name} {...disclosure} /><Row name={name} open={open} selected={selected} activity={<Activity when={window.lastActivityAt} now={now} />} /></View>
    {disclosure.expanded && <View style={local.children} accessibilityLabel={'Pages in ' + name}>{window.panes.map((pane, index) => <Branch key={pane.id} last={index === window.panes.length - 1}><PageRow {...props} pane={pane} /></Branch>)}</View>}
  </View>
}
let Session = (props: SessionProps) => {
  let { host, session, selection, select, attention, now, query } = props, disclosure = useDisclosure(query)
  let selected = selection?.host === host.id && selection.session === session.id
  let pane = session.panes.find(pane => selected && pane.id === selection?.pane) ?? session.panes[0]
  let needsHelp = session.panes.some(pane => paneAttention(attention, { host: host.id, generation: host.generation, session: session.id, pane: pane.id })?.status === 'pending')
  let windows = session.windows?.length ? session.windows : undefined
  return <View ref={disclosure.ref} {...disclosure.keys}>
    <View style={local.heading}><Disclosure name={'windows in ' + session.name} {...disclosure} /><Row name={session.name} icon={false} open={() => { if (pane) select({ host: host.id, generation: host.generation, session: session.id, pane: pane.id }) }} selected={selected} activity={<Activity when={session.lastActivityAt} now={now} />}>{needsHelp && <Ionicons name="hand-left-outline" size={14} color={colors.warning} />}</Row></View>
    {disclosure.expanded && <View style={local.children} accessibilityLabel={'Windows in ' + session.name}>
      {windows ? windows.map((window, index) => <Branch key={window.id} last={index === windows.length - 1}><WindowRow {...props} window={window} /></Branch>) : session.panes.map((pane, index) => <Branch key={pane.id} last={index === session.panes.length - 1}><PageRow {...props} pane={pane} /></Branch>)}
    </View>}
  </View>
}
let Machine = ({ host, hosts, query, color, details, create, ...props }: Omit<SessionProps, 'host' | 'session'> & { host: Host; hosts: Host[]; color: string; details: () => void; create?: (host: Host) => void }) => {
  let disclosure = useDisclosure(query), name = remoteMachineName(host, hosts)
  let matches = (value: string) => value.toLowerCase().includes(query.toLowerCase())
  let all = matches(name + ' ' + host.service)
  let sessions = host.sessions.filter(session => all || matches(session.name + ' ' + (session.windows?.map(window => window.name).join(' ') ?? '') + ' ' + session.panes.map(pane => pane.title + ' ' + (pane.agentPurpose ?? '')).join(' ')))
  if (query && !sessions.length && !all) return null
  return <View ref={disclosure.ref} {...disclosure.keys} style={local.machine}>
    <View style={local.heading}><Disclosure name={'machine ' + name} {...disclosure} /><Pressable testID="remote-tree-row" accessibilityRole="button" accessibilityLabel={'Machine ' + name} onPress={details} style={local.machineHeading}><Ionicons name={host.machine?.platform === 'linux' ? 'server-outline' : 'desktop-outline'} size={17} color={color} /><Text style={local.machineName} numberOfLines={1}>{name}</Text><Text style={local.activity}>{host.sessions.length}</Text></Pressable></View>
    {disclosure.expanded && <View style={local.machineSessions} accessibilityLabel={'Sessions on ' + name}>
      {sessions.map(session => <Session key={session.id} {...props} host={host} session={session} query={query} />)}
      {sessions.length === 0 && <Text style={local.noSessions}>No sessions.</Text>}
      {!!create && canManageHost(host) && host.capabilities?.sessionCreate === 1 && <Pressable accessibilityRole="button" accessibilityLabel="New session" accessibilityHint={'Create on ' + name} onPress={() => create(host)} style={local.newSession}><Ionicons name="add" size={16} color={colors.secondary} /><Text style={styles.secondary}>New session</Text></Pressable>}
    </View>}
  </View>
}

export let SessionList = ({ hosts, attention = [], selection, select, create, header, footer, empty, searchVisible = true, focusSearch = 0 }: {
  hosts: Host[]; selection?: Selection; select: (selection: Selection) => void; create?: (host: Host) => void; attention?: Attention[]; header?: ReactNode; footer?: ReactNode; empty?: ReactNode; searchVisible?: boolean; focusSearch?: number
}) => {
  let [search, setSearch] = useState(''), [machineId, setMachineId] = useState<string>(), [now, setNow] = useState(Date.now)
  let searchInput = useRef<ComponentRef<typeof TextInput>>(null)
  let [machineColors, setMachineColors] = useState<Record<string, string>>({})
  let machine = hosts.find(host => host.id === machineId), color = (host: Host) => machineColors[host.id] ?? remoteMachineColor(host.id, hosts)
  useEffect(() => { let timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  useEffect(() => { if (!searchVisible) setSearch('') }, [searchVisible])
  useEffect(() => { if (focusSearch && searchVisible) searchInput.current?.focus() }, [focusSearch, searchVisible])
  useEffect(() => {
    let active = true
    void AsyncStorage.getItem('remote-machine-colors').then(value => { if (active && value) { let saved = JSON.parse(value); setMachineColors(Object.fromEntries(Object.entries(saved).filter(([, color]) => remoteMachinePalette.includes(String(color)))) as Record<string, string>) } }).catch(() => undefined)
    return () => { active = false }
  }, [])
  let saveColor = (value: string) => { if (!machine) return; let next = { ...machineColors, [machine.id]: value }; setMachineColors(next); void AsyncStorage.setItem('remote-machine-colors', JSON.stringify(next)).catch(() => undefined) }
  return <View style={local.screen} {...webKeys(treeKeys)}>
    {searchVisible && <View style={local.toolbar}><Ionicons name="search" size={17} color={colors.secondary} /><TextInput ref={searchInput} style={local.searchInput} placeholder="Search sessions" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} accessibilityLabel="Search sessions" /></View>}
    <ScrollView style={local.scroll} contentContainerStyle={local.list} keyboardShouldPersistTaps="handled">
      {header}
      {hosts.map(host => <Machine key={host.id} host={host} hosts={hosts} query={searchVisible ? search : ''} color={color(host)} details={() => setMachineId(host.id)} create={create} selection={selection} select={select} attention={attention} now={now} />)}
      {hosts.length === 0 && empty}
      {footer}
    </ScrollView>
    <Sheet title={machine ? remoteMachineName(machine, hosts) : 'Machine'} visible={!!machine} close={() => setMachineId(undefined)}>
      {machine && <>
        <Text style={styles.secondary}>Service</Text><Text style={styles.text}>{machine.service}</Text>
        {machine.machine && <><Text style={styles.secondary}>System</Text><Text style={styles.text}>{({ darwin: 'macOS', linux: 'Linux', win32: 'Windows' } as Record<string, string>)[machine.machine.platform] ?? machine.machine.platform} · {machine.machine.arch}</Text>{!!machine.machine.version && <Text style={styles.text}>bmux {machine.machine.version}{machine.machine.revision && ' · ' + machine.machine.revision}</Text>}</>}
        <Text style={styles.secondary}>{machine.sessions.length} sessions · {machine.sessions.flatMap(session => session.panes).length} pages · {machine.permission === 'control' ? 'Watch and control' : 'Watch only'}</Text>
        <View style={local.palette}>{remoteMachinePalette.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={'Machine color ' + value} accessibilityState={{ checked: color(machine) === value }} aria-checked={color(machine) === value} onPress={() => saveColor(value)} style={[local.swatch, color(machine) === value && local.swatchSelected]}><Ionicons name={machine.machine?.platform === 'linux' ? 'server-outline' : 'desktop-outline'} size={21} color={value} /></Pressable>)}</View>
        <Text style={local.machineId}>{machine.id}</Text>
      </>}
    </Sheet>
  </View>
}

let local = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 }, scroll: { flex: 1 }, toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 12 }, searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, minHeight: 44 },
  list: { padding: 12, gap: 16, paddingBottom: 24 }, machine: { gap: 2 }, heading: { flexDirection: 'row', alignItems: 'center', minWidth: 0 }, toggle: { width: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, machineHeading: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44, paddingRight: 8 }, machineName: { flex: 1, minWidth: 0, color: colors.secondary, fontSize: 14, fontWeight: '500' }, machineSessions: { paddingLeft: 8, gap: 2 },
  row: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', backgroundColor: colors.surface }, highlighted: { backgroundColor: colors.grouped }, selected: { backgroundColor: colors.grouped, borderColor: colors.borderLight }, name: { flex: 1, minWidth: 0, fontSize: 14, color: colors.text }, activity: { color: colors.secondary, fontSize: 11 }, children: { paddingLeft: 8 }, windowToggle: { position: 'absolute', left: -16, top: 0, width: 16, zIndex: 1, backgroundColor: colors.bg },
  branch: { position: 'relative', paddingLeft: 23, paddingTop: 2 }, branchVertical: { position: 'absolute', left: 7, top: 0, borderLeftWidth: 1, borderLeftColor: '#505050' }, branchHorizontal: { position: 'absolute', left: 7, top: 22, width: 16, borderTopWidth: 1, borderTopColor: '#505050' }, noSessions: { paddingLeft: 24, color: colors.secondary, fontSize: 13 }, newSession: { flexDirection: 'row', gap: 7, minHeight: 44, alignItems: 'center', paddingLeft: 32 },
  palette: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' }, swatch: { minWidth: 40, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, swatchSelected: { backgroundColor: colors.grouped, borderColor: colors.borderLight }, machineId: { color: colors.muted, fontSize: 12 },
})
