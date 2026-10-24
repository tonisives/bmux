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
import { attentionMatches, createResumeRequests, mergeAttention, resumeAcknowledgement } from './attention'
import { operationMessage } from './operation-error'
import { useStreamQuality } from './useStreamQuality'
import { useIncludedBrowser } from './useIncludedBrowser'
import type { Attention, AttentionTarget, Host, LiveView, RelayAccount, RelayBilling, Selection, State, Viewer } from './types'
import type { RemoteManagementParams, RemoteManagementResults, RemoteProfile, RemoteTarget } from '../../src/shared/remote-management'
import type { RemoteAttentionPage } from '../../src/shared/remote-attention'

let pendingKey = 'bmux.remote.pending-attention'
let useRemoteState = () => {
  let [account, setAccount] = useState<RelayAccount>()
  let [loading, setLoading] = useState(true)
  let [hosts, setHosts] = useState<Host[]>([])
  let [hostsLoaded, setHostsLoaded] = useState(false)
  let [viewer, setViewer] = useState<Viewer>()
  let [state, setState] = useState<State>()
  let [stream, setStream] = useState<MediaStream>()
  let [selection, setSelection] = useState<Selection>()
  let [attention, setAttention] = useState<Attention[]>([])
  let [attentionCursor, setAttentionCursor] = useState<string | null>(null)
  let [loadingAttention, setLoadingAttention] = useState(false)
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
  let management = useRef<{ viewer: Viewer; key: string; ready: Promise<void> } | undefined>(undefined)
  let operation = useRef(0)
  let attentionPaging = useRef(false)
  let pending = useRef(new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>())
  let [resumeRequest] = useState(() => createResumeRequests(AsyncStorage.getItem, AsyncStorage.setItem, Crypto.randomUUID))
  activeState.current = state
  activeSelection.current = selection
  hostList.current = hosts
  owner.current = account?.owner

  let refresh = useCallback(async () => {
    let current = owner.current
    if (!current) return []
    let results = await Promise.allSettled([
      api<RemoteAttentionPage>('/api/attention?v=2&limit=50').then(value => { if (owner.current === current) { setAttention(items => mergeAttention(items, value.items)); if (!attentionPaging.current) setAttentionCursor(value.nextCursor) } }),
      api<RelayBilling>('/api/billing/status').then(value => { if (owner.current === current) setBilling(value) }),
      api<LiveView[]>('/api/streams').then(value => { if (owner.current === current) setViews(value) }),
    ])
    return results
  }, [api])
  let loadMoreAttention = useCallback(async () => {
    if (!attentionCursor || loadingAttention) return
    let current = owner.current
    attentionPaging.current = true
    setLoadingAttention(true)
    try {
      let value = await api<RemoteAttentionPage>('/api/attention?v=2&limit=50&cursor=' + encodeURIComponent(attentionCursor))
      if (owner.current === current) { setAttention(items => mergeAttention(items, value.items)); setAttentionCursor(value.nextCursor) }
    } finally { setLoadingAttention(false) }
  }, [api, attentionCursor, loadingAttention])
  let updateAttention = useCallback((value: Attention) => {
    setAttention(items => mergeAttention(items, [value]))
    setTarget(current => current?.id === value.id && current.revision <= value.revision ? value : current)
  }, [])
  let markAttention = useCallback(async (id: string, metadata: { read?: boolean; dismissed?: boolean }) => {
    let current = owner.current
    await api('/api/attention/' + encodeURIComponent(id) + '/inbox', metadata)
    let value = await api<AttentionTarget>('/api/attention/' + encodeURIComponent(id))
    if (owner.current === current) updateAttention(value)
  }, [api, updateAttention])
  let rememberAttention = useCallback((id: string) => {
    setPendingAttention(id)
    void AsyncStorage.setItem(pendingKey, id)
  }, [])
  let stop = useCallback(() => {
    operation.current++
    management.current = undefined
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
  let watch = useCallback(async (selected: Selection, confirmedTarget = false) => {
    if (AppState.currentState === 'background') throw new Error('Open the app to watch this page.')
    let viewer = activeViewer.current
    let host = hostList.current.find(host => host.id === selected.host && host.generation === selected.generation)
    if (!viewer || !host || (!confirmedTarget && !host.sessions.find(item => item.id === selected.session)?.panes.some(item => item.id === selected.pane))) throw new Error('The requested page is unavailable.')
    stop()
    let attempt = ++operation.current
    lastWatch.current = { viewer, key: JSON.stringify(selected) }
    activeSelection.current = selected
    setSelection(selected); setTarget(undefined); setConnecting(true); setError('')
    try { await viewer.watch(host, selected.session, selected.pane) }
    finally { if (operation.current === attempt) setConnecting(false) }
  }, [stop])
  let openTarget = useCallback(async (host: Pick<Host, 'id' | 'generation'>, target: Pick<RemoteTarget, 'session' | 'pane'>) => {
    let current = owner.current, attempt = operation.current
    let fresh = await api<Host[]>('/api/hosts')
    if (!current || owner.current !== current || attempt !== operation.current) throw new Error('The selected browser changed.')
    if (!fresh.some(item => item.id === host.id && item.generation === host.generation)) throw new Error('The requested browser is offline.')
    hostList.current = fresh; setHosts(fresh)
    await watch({ host: host.id, generation: host.generation, session: target.session, pane: target.pane }, true)
  }, [api, watch])
  let includedBrowser = useIncludedBrowser(account?.owner, api, openTarget)
  let request = useCallback((message: Record<string, unknown>, requestId = Crypto.randomUUID(), timeout = 15000) => new Promise<unknown>((resolve, reject) => {
    let id = requestId
    if (pending.current.has(id)) { reject(new Error('This action is already in progress.')); return }
    let timer = setTimeout(() => { pending.current.delete(id); reject(new Error('The host did not confirm the action.')) }, timeout)
    pending.current.set(id, { resolve, reject, timer })
    if (!activeViewer.current?.send({ ...message, request: id })) { clearTimeout(timer); pending.current.delete(id); reject(new Error('The browser is disconnected.')) }
  }), [])
  let rpc = useCallback(<K extends keyof RemoteManagementParams>(method: K, params: RemoteManagementParams[K], requestId?: string) => request({ type: 'rpc', method, params }, requestId, method === 'profiles.proxy.test' ? 30000 : 15000) as Promise<RemoteManagementResults[K]>, [request])
  let resume = useCallback(async (id: string) => {
    let currentOwner = owner.current, attempt = operation.current, viewer = activeViewer.current
    if (!currentOwner || !viewer) throw new Error('Sign in to continue.')
    let value = await api<AttentionTarget>('/api/attention/' + encodeURIComponent(id))
    if (owner.current !== currentOwner || operation.current !== attempt) throw new Error('The selected page changed.')
    updateAttention(value)
    let selected = attentionSelection(value, hostList.current)
    let checkControl = () => {
      let current = activeState.current, active = activeSelection.current
      let lease = current?.controls[selected.session]
      if (owner.current !== currentOwner || operation.current !== attempt || viewer !== activeViewer.current || !active || !attentionMatches(value, active)) throw new Error('The selected page changed.')
      if (!hostList.current.some(host => host.id === value.host && host.generation === value.generation && host.capabilities?.verifiedAttention === 1)) throw new Error('Update this host to use verified Resume.')
      if (!lease || lease.owner !== viewer.id) throw new Error('Take control before resuming.')
      if (!current?.attention?.some(item => item.pane === selected.pane && item.session === selected.session && item.episode === value.episode)) throw new Error('The help request changed. Refresh before resuming.')
      return lease
    }
    let lease = checkControl()
    if (value.status !== 'pending') throw new Error(value.status === 'verifying' ? 'The agent is already verifying this request.' : 'This request is no longer active.')
    let requestId = await resumeRequest(currentOwner, value)
    if (checkControl().generation !== lease.generation) throw new Error('Control changed. Take control again before resuming.')
    let acknowledgement
    try { acknowledgement = resumeAcknowledgement(await request({ type: 'resume', generation: lease.generation, episode: value.episode, revision: value.revision }, requestId), value) }
    catch (error) {
      let confirmed = await api<AttentionTarget>('/api/attention/' + encodeURIComponent(id)).catch(() => undefined)
      if (!confirmed || !attentionMatches(confirmed, selected) || confirmed.episode !== value.episode || confirmed.status !== 'verifying' || confirmed.attempt?.request !== requestId) throw error
      acknowledgement = resumeAcknowledgement({ resumed: true, status: 'verifying', episode: confirmed.episode, revision: confirmed.revision, attemptId: confirmed.attempt.id, acknowledgedAt: confirmed.attempt.acknowledgedAt }, value)
    }
    if (owner.current !== currentOwner || operation.current !== attempt || activeViewer.current !== viewer) return
    let updated: Attention = { ...value, revision: acknowledgement.revision, status: 'verifying', attempt: { id: acknowledgement.attemptId, request: requestId, acknowledgedAt: acknowledgement.acknowledgedAt } }
    updateAttention(updated); setTarget(updated)
    viewer.send({ type: 'release', session: selected.session }); viewer.send({ type: 'state' })
    void refresh()
  }, [api, request, resumeRequest, refresh, updateAttention])
  let manage = useCallback(async (host: Host) => {
    let viewer = activeViewer.current
    if (!viewer || host.capabilities?.management !== 1) throw new Error('Update this browser host to manage its profiles and sessions.')
    let key = host.id + ':' + host.generation
    if (management.current?.viewer === viewer && management.current.key === key) return management.current.ready
    close()
    let ready = viewer.manage(host)
    let current = { viewer, key, ready }
    management.current = current
    try { await ready } catch (error) { if (management.current === current) management.current = undefined; throw error }
  }, [close])
  let profiles = useCallback(async (host: Host): Promise<RemoteProfile[]> => {
    await manage(host)
    return (await rpc('profiles.list', {})).profiles
  }, [manage, rpc])
  let qualityHost = hosts.find(host => host.id === selection?.host && host.generation === selection.generation)
  let streamQuality = useStreamQuality(account?.owner, state && selection && qualityHost?.capabilities?.streamQuality === 1 ? JSON.stringify(selection) : undefined, request, setError)
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
      attentionPaging.current = false
      await clearSession()
      await AsyncStorage.removeItem(pendingKey)
      setAccount(undefined); setHosts([]); setAttention([]); setAttentionCursor(null); setBilling(undefined); setViews([]); setPendingAttention(undefined)
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
    hostList.current = []
    setHosts([]); setHostsLoaded(false)
    setConnecting(true)
    void openViewer(account.owner, api, {
      hosts: value => { if (active) { setHosts(value); setHostsLoaded(true) } },
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
        else if (message.type === 'error') item.reject(Object.assign(new Error(operationMessage(message.code, message.error)), { code: message.code, retryable: message.retryable }))
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
      await watch(selected)
      if (!active) return
      setTarget(value); updateAttention(value)
      void markAttention(value.id, { read: true }).catch(() => {})
      await AsyncStorage.removeItem(pendingKey)
      setPendingAttention(undefined)
    }).catch(value => { if (active) { setError(value.message); setPendingAttention(undefined) } })
    return () => { active = false }
  }, [account?.owner, viewer, pendingAttention, api, watch, close, updateAttention, markAttention])
  let help = state?.attention?.find(item => item.pane === selection?.pane && item.session === selection?.session)
  let listedTarget = selection && attention.find(item => attentionMatches(item, selection) && (!help || item.episode === help.episode))
  let activeTarget = target && selection && attentionMatches(target, selection) && (!listedTarget || target.revision > listedTarget.revision) ? target : listedTarget
  useEffect(() => {
    if (!account || !activeTarget || !['pending', 'verifying'].includes(activeTarget.status)) return
    let active = true, current = account.owner
    let update = () => { void api<AttentionTarget>('/api/attention/' + encodeURIComponent(activeTarget.id)).then(value => { if (active && owner.current === current) updateAttention(value) }).catch(() => {}) }
    update()
    let timer = setInterval(update, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [account?.owner, activeTarget?.id, activeTarget?.status, api, updateAttention])
  useEffect(() => {
    if (!selection || !viewer || state || connecting || pendingAttention || !hostsLoaded) return
    if (lastWatch.current?.viewer === viewer && lastWatch.current.key === JSON.stringify(selection)) return
    let host = hosts.find(item => item.id === selection.host && item.generation === selection.generation)
    if (host) void watch(selection).catch(value => setError(value.message))
    else { close(); setError('The requested browser is no longer available.') }
  }, [viewer, hosts, hostsLoaded, selection, state, connecting, pendingAttention, watch, close])
  useEffect(() => {
    if (!state || !selection || state.controls[selection.session]?.owner !== viewer?.id) return
    let generation = state.controls[selection.session].generation
    let timer = setInterval(() => viewer?.send({ type: 'renew', session: selection.session, generation }), 10000)
    return () => clearInterval(timer)
  }, [state?.controls, selection, viewer])
  return {
    account, loading, hosts, viewer, state, stream, selection, connecting, attention, target: activeTarget, billing, views, error, streamQuality, includedBrowser,
    api, refresh, login, logout, watch, openTarget, close, request, rpc, manage, profiles, setError, rememberAttention, resume, markAttention, loadMoreAttention, attentionCursor, loadingAttention,
    retry: () => { setError(''); setEpoch(value => value + 1) },
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
