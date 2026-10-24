import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppState, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import { createApi } from './api'
import { openViewer } from './viewer'
import { clearSession } from './storage'
import { accessToken, signIn, signOut } from './auth'
import { observeNotifications, registerPush, removePush } from './notifications'
import { attentionIdFromUrl } from './links'
import { attentionSelection } from './types'
import type { Attention, AttentionTarget, Host, LiveView, RelayAccount, RelayBilling, Selection, State, Viewer } from './types'

let pendingKey = 'bmux.remote.pending-attention'
let useRemoteState = () => {
  let [account, setAccount] = useState<RelayAccount>()
  let [loading, setLoading] = useState(true)
  let [hosts, setHosts] = useState<Host[]>([])
  let [viewer, setViewer] = useState<Viewer>()
  let [state, setState] = useState<State>()
  let [stream, setStream] = useState<MediaStream>()
  let [selection, setSelection] = useState<Selection>()
  let [attention, setAttention] = useState<Attention[]>([])
  let [pendingAttention, setPendingAttention] = useState<string>()
  let [target, setTarget] = useState<AttentionTarget>()
  let [billing, setBilling] = useState<RelayBilling>()
  let [views, setViews] = useState<LiveView[]>([])
  let [error, setError] = useState('')
  let [connecting, setConnecting] = useState(false)
  let [epoch, setEpoch] = useState(0)
  let [api] = useState(() => createApi(accessToken))
  let activeViewer = useRef<Viewer | undefined>(undefined)
  let activeState = useRef<State | undefined>(undefined)
  let activeSelection = useRef<Selection | undefined>(undefined)
  let hostList = useRef<Host[]>([])
  let owner = useRef<string | undefined>(undefined)
  let lastWatch = useRef<{ viewer: Viewer; key: string } | undefined>(undefined)
  let operation = useRef(0)
  let pending = useRef(new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>())
  activeState.current = state
  activeSelection.current = selection
  hostList.current = hosts
  owner.current = account?.owner

  let refresh = useCallback(async () => {
    let current = owner.current
    if (!current) return []
    let results = await Promise.allSettled([
      api<{ attention: Attention[] }>('/api/attention').then(value => { if (owner.current === current) setAttention(value.attention) }),
      api<RelayBilling>('/api/billing/status').then(value => { if (owner.current === current) setBilling(value) }),
      api<LiveView[]>('/api/streams').then(value => { if (owner.current === current) setViews(value) }),
    ])
    return results
  }, [api])
  let rememberAttention = useCallback((id: string) => {
    setPendingAttention(id)
    void AsyncStorage.setItem(pendingKey, id)
  }, [])
  let stop = useCallback(() => {
    operation.current++
    let selected = activeSelection.current, current = activeState.current, viewer = activeViewer.current
    if (selected && current?.controls[selected.session]?.owner === viewer?.id) viewer?.send({ type: 'release', session: selected.session })
    viewer?.stop()
    activeState.current = undefined
    setState(undefined); setStream(undefined); setConnecting(false)
    for (let request of pending.current.values()) { clearTimeout(request.timer); request.reject(new Error('View closed.')) }
    pending.current.clear()
  }, [])
  let close = useCallback(() => {
    stop()
    activeSelection.current = undefined
    setSelection(undefined); setTarget(undefined)
  }, [stop])
  let watch = useCallback(async (selected: Selection) => {
    let viewer = activeViewer.current
    let host = hostList.current.find(host => host.id === selected.host && host.generation === selected.generation)
    if (!viewer || !host || !host.sessions.find(item => item.id === selected.session)?.panes.some(item => item.id === selected.pane)) throw new Error('The requested page is unavailable.')
    stop()
    let attempt = ++operation.current
    lastWatch.current = { viewer, key: JSON.stringify(selected) }
    activeSelection.current = selected
    setSelection(selected); setConnecting(true); setError('')
    try { await viewer.watch(host, selected.session, selected.pane) }
    finally { if (operation.current === attempt) setConnecting(false) }
  }, [stop])
  let request = useCallback((message: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    let id = Crypto.randomUUID()
    let timer = setTimeout(() => { pending.current.delete(id); reject(new Error('The host did not confirm the action.')) }, 15000)
    pending.current.set(id, { resolve, reject, timer })
    if (!activeViewer.current?.send({ ...message, request: id })) { clearTimeout(timer); pending.current.delete(id); reject(new Error('The browser is disconnected.')) }
  }), [])
  let loadAccount = useCallback(async () => {
    setLoading(true)
    try { setAccount(await api<RelayAccount>('/api/me')) }
    catch { setAccount(undefined) }
    finally { setLoading(false) }
  }, [api])
  let login = useCallback(async () => { setError(''); await signIn(); await loadAccount() }, [loadAccount])
  let logout = useCallback(async () => {
    close()
    await removePush(api).catch(() => {})
    try { await signOut() }
    finally {
      owner.current = undefined
      await clearSession()
      await AsyncStorage.removeItem(pendingKey)
      setAccount(undefined); setHosts([]); setAttention([]); setBilling(undefined); setViews([]); setPendingAttention(undefined)
    }
  }, [api, close])

  useEffect(() => { void loadAccount() }, [loadAccount])
  useEffect(() => {
    void AsyncStorage.getItem(pendingKey).then(value => { if (value) setPendingAttention(value) })
    void Linking.getInitialURL().then(value => { let id = value && attentionIdFromUrl(value); if (id) rememberAttention(id) })
    let listener = Linking.addEventListener('url', value => { let id = attentionIdFromUrl(value.url); if (id) rememberAttention(id) })
    return () => listener.remove()
  }, [rememberAttention])
  useEffect(() => {
    if (!account) return
    let active = true, opened: Viewer | undefined
    setConnecting(true)
    void openViewer(account.owner, api, {
      hosts: value => { if (active) setHosts(value) },
      stream: value => { if (active) setStream(value) },
      state: value => {
        if (!active) return
        let selected = activeSelection.current
        if (selected && value.pane !== selected.pane) { stop(); setError('The requested page is no longer available.'); return }
        setState(value)
      },
      error: value => { if (active) setError(value) },
      disconnected: () => { if (active) { stop(); setError('Browser disconnected.') } },
      message: message => {
        let id = typeof message.request === 'string' ? message.request : ''
        let item = pending.current.get(id)
        if (!item || (message.type !== 'result' && message.type !== 'error')) return
        clearTimeout(item.timer); pending.current.delete(id)
        if (message.type === 'result') item.resolve(message.result)
        else if (message.type === 'error') item.reject(new Error(String(message.error)))
      },
    }).then(value => {
      opened = value
      if (!active) { value.close(); return }
      activeViewer.current = value; setViewer(value); setConnecting(false)
    }).catch(value => { if (active) { setError(String(value.message)); setConnecting(false) } })
    return () => { active = false; stop(); opened?.close(); if (activeViewer.current === opened) activeViewer.current = undefined; setViewer(undefined) }
  }, [account?.owner, api, epoch, stop])
  useEffect(() => {
    if (!account) return
    void refresh()
    let timer = setInterval(() => { if (AppState.currentState !== 'background') void refresh() }, 15000)
    let unsubscribe = observeNotifications(rememberAttention, () => { void refresh() }, api)
    void registerPush(api).catch(() => {})
    return () => { clearInterval(timer); unsubscribe() }
  }, [account?.owner, api, refresh, rememberAttention])
  useEffect(() => {
    let listener = AppState.addEventListener('change', value => {
      if (value === 'background') stop()
      else if (value === 'active') { if (account) { void refresh(); setEpoch(value => value + 1) } }
    })
    return () => listener.remove()
  }, [account, refresh, stop])
  useEffect(() => {
    if (!account || !viewer || !pendingAttention) return
    let active = true
    close()
    void Promise.all([api<AttentionTarget>('/api/attention/' + encodeURIComponent(pendingAttention)), api<Host[]>('/api/hosts')]).then(async ([value, freshHosts]) => {
      let selected = attentionSelection(value, freshHosts)
      if (!active) return
      hostList.current = freshHosts
      setHosts(freshHosts)
      setTarget(value)
      await watch(selected)
      if (!active) return
      await AsyncStorage.removeItem(pendingKey)
      setPendingAttention(undefined)
    }).catch(value => { if (active) { setError(value.message); setPendingAttention(undefined) } })
    return () => { active = false }
  }, [account?.owner, viewer, pendingAttention, api, watch, close])
  useEffect(() => {
    if (!selection || !viewer || state || connecting || pendingAttention) return
    if (lastWatch.current?.viewer === viewer && lastWatch.current.key === JSON.stringify(selection)) return
    let host = hosts.find(item => item.id === selection.host && item.generation === selection.generation)
    if (host) void watch(selection).catch(value => setError(value.message))
  }, [viewer, hosts, selection, state, connecting, pendingAttention, watch])
  useEffect(() => {
    if (!state || !selection || state.controls[selection.session]?.owner !== viewer?.id) return
    let generation = state.controls[selection.session].generation
    let timer = setInterval(() => viewer?.send({ type: 'renew', session: selection.session, generation }), 10000)
    return () => clearInterval(timer)
  }, [state?.controls, selection, viewer])
  return {
    account, loading, hosts, viewer, state, stream, selection, connecting, attention, target, billing, views, error,
    api, refresh, login, logout, watch, close, request, setError, rememberAttention,
    retry: () => setEpoch(value => value + 1),
    enableNotifications: () => registerPush(api, true),
    disconnectView: async (connection: string) => { await api('/api/streams/disconnect', { connection }); await refresh() },
  }
}

type RemoteState = ReturnType<typeof useRemoteState>
let RemoteContext = createContext<RemoteState | undefined>(undefined)
export let RemoteProvider = ({ children }: { children: ReactNode }) => {
  let value = useRemoteState()
  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>
}
export let useRemote = () => {
  let value = useContext(RemoteContext)
  if (!value) throw new Error('RemoteProvider missing')
  return value
}
