import { envelopeText, validEnvelope } from '../../src/shared/remote'
import type { RemoteEnvelope, RemoteWorkspaceSnapshot } from '../../src/shared/remote'
import { observeViewerFocus, receiveViewerMessage } from './viewer-updates'
import { prepareIceAnswer } from '../../src/shared/remote-ice'
import type { RemoteHost } from '../../src/shared/remote-sessions'
export type Host = RemoteHost & { generation: string; key: JsonWebKey }
export type Session = { id: string; name: string; windows: { panes: { id: string; title: string; url: string; lastActivityAt?: number }[] }[] }
export type State = { workspace?: RemoteWorkspaceSnapshot; viewports: Record<string, { width: number; height: number; generation: number }>; pane: string; sessions: Session[]; controls: Record<string, { owner: string; generation: number }>; attention?: { pane: string; session: string; episode: string; reason: string }[] }
export type ViewerIdentity = {
  publicKey: JsonWebKey
  fingerprint: (key: JsonWebKey) => Promise<string>
  sign: (text: string) => Promise<string>
  verify: (key: JsonWebKey, signature: string, text: string) => Promise<boolean>
}
export type ViewerEvents = { hosts: (hosts: Host[]) => void; stream: (stream: MediaStream) => void; state: (state: State) => void; error: (text: string) => void; disconnected: () => void; message?: (message: Record<string, unknown>) => void }
export type ViewerOptions = {
  view?: string
  seal?: (host: Host, payload: Record<string, unknown>) => Promise<RemoteEnvelope>
  origin?: string
  connect?: (publicKey: JsonWebKey) => Promise<{ ticket: string; iceServers: RTCIceServer[] }>
  identity?: ViewerIdentity
  peer?: (configuration: RTCConfiguration) => RTCPeerConnection
  socket?: (url: URL) => WebSocket
  uuid?: () => string
  observe?: (refresh: () => void) => () => void
}
let bytes = (text: string) => new TextEncoder().encode(text)
let base64 = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data)))
let decode = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0))
export let fingerprint = async (key: JsonWebKey) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(key.x!)))].map(value => value.toString(16).padStart(2, '0')).join('')
export let api = async (endpoint: string, value?: unknown) => {
  let response = await fetch(endpoint, { credentials: 'same-origin', ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) })
  if (!response.ok) {
    let result = await response.json().catch(() => ({}))
    throw new Error(response.status === 401 ? 'Sign in to continue' : result.error ?? 'Request failed')
  }
  return response.json()
}
export let createBrowserIdentity = async (): Promise<ViewerIdentity> => {
  let stored = localStorage.getItem('bmux-device-key')
  let key: JsonWebKey
  if (stored) key = JSON.parse(stored)
  else { let pair = await crypto.subtle.generateKey('Ed25519', true, ['sign','verify']) as CryptoKeyPair; key = await crypto.subtle.exportKey('jwk', pair.privateKey); localStorage.setItem('bmux-device-key', JSON.stringify(key)) }
  let privateKey = await crypto.subtle.importKey('jwk', key, 'Ed25519', false, ['sign'])
  let publicKey = { kty: key.kty, crv: key.crv, x: key.x }
  return {
    publicKey, fingerprint,
    sign: async text => base64(await crypto.subtle.sign('Ed25519', privateKey, bytes(text))),
    verify: async (key, signature, text) => {
      let imported = await crypto.subtle.importKey('jwk', key, 'Ed25519', false, ['verify'])
      return crypto.subtle.verify('Ed25519', imported, decode(signature), bytes(text))
    },
  }
}
export let createViewer = async (events: ViewerEvents, options: ViewerOptions = {}) => {
  let identity = options.identity ?? await createBrowserIdentity()
  let publicKey = identity.publicKey
  let id = await identity.fingerprint(publicKey)
  let uuid = options.uuid ?? (() => crypto.randomUUID())
  let { ticket, iceServers } = options.connect ? await options.connect(publicKey) : await api('/api/connect', { publicKey })
  let url = new URL('/connect', options.origin ?? location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket)
  let socket = options.socket ? options.socket(url) : new WebSocket(url), host: Host | undefined, peer: RTCPeerConnection | undefined, channel: RTCDataChannel | undefined
  let seen = new Set<string>(), closed = false
  let request: string | undefined, connection: string | undefined
  let mode: 'open' | 'manage' | undefined
  let operation = 0
  let candidates = new Map<string, RTCIceCandidateInit[]>()
  let opening: ((error?: Error) => void) | undefined
  let pending: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
  let finish = (error?: Error) => { if (!pending) return; let current = pending; pending = undefined; clearTimeout(current.timer); if (error) current.reject(error); else current.resolve() }
  let connectionLoss: ReturnType<typeof setTimeout> | undefined, disconnected = false
  let connectionLost = (error: Error) => {
    clearTimeout(connectionLoss); connectionLoss = undefined
    if (closed || disconnected) return
    disconnected = true; finish(error); events.disconnected()
  }
  let outgoing = Promise.resolve()
  let signal = (payload: unknown) => {
    if (!host || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Disconnected'))
    let selected = host
    let envelope = { version: 1 as const, from: id, to: selected.id, generation: selected.generation, nonce: uuid(), expires: Date.now() + 60000, payload: JSON.stringify({ ...(payload as object), ...(options.view ? { view: options.view } : {}) }) }
    let sending = outgoing.then(async () => {
      let sealed = options.seal ? await options.seal!(selected, JSON.parse(envelope.payload)) : { ...envelope, signature: await identity.sign(envelopeText(envelope)) }
      if (socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected')
      socket.send(JSON.stringify({ type: 'signal', to: selected.id, envelope: sealed }))
    })
    outgoing = sending.catch(() => {})
    return sending
  }
  let send = (message: unknown) => {
    if (channel?.readyState !== 'open' || channel.bufferedAmount >= 65536) return false
    channel.send(JSON.stringify(message))
    return true
  }
  let refresh = () => send({ type: 'state' }), stopRefresh = () => {}
  let incoming = Promise.resolve()
  socket.onmessage = event => {
    let currentRequest = request
    incoming = incoming.then(async () => {
      let message = JSON.parse(event.data)
      if (message.type === 'hosts') { events.hosts(message.hosts); return }
      if (message.type === 'disconnected' && message.id === host?.id) { peer?.close(); connectionLost(new Error('Host disconnected')); return }
      if (message.type === 'signal-error' && message.to === host?.id) { finish(new Error(message.error)); return }
      if (message.type !== 'signal' || !host || message.from !== host.id) return
      let envelope = message.envelope as RemoteEnvelope
      if (!validEnvelope(envelope, id, host.generation) || seen.has(envelope.nonce) || envelope.from !== await identity.fingerprint(host.key)) throw new Error('Invalid host signature')
      if (!await identity.verify(host.key, envelope.signature, envelopeText(envelope))) throw new Error('Invalid host signature')
      if (currentRequest !== request) return
      seen.add(envelope.nonce)
      let payload = JSON.parse(envelope.payload)
      if (payload.view !== options.view) return
      if (payload.request && payload.request !== request) return
      if (payload.type === 'error') { finish(new Error(payload.error)); return }
      if (payload.type === 'candidate' && typeof payload.connection === 'string') {
        if (payload.connection === connection && peer?.remoteDescription) await peer.addIceCandidate(payload.candidate)
        else {
          let pending = candidates.get(payload.connection) ?? []
          if (pending.length < 64 && candidates.size < 8) { pending.push(payload.candidate); candidates.set(payload.connection, pending) }
        }
        return
      }
      if (payload.type !== 'offer') return
      peer?.close()
      clearTimeout(connectionLoss); connectionLoss = undefined
      let current = options.peer ? options.peer({ iceServers }) : new RTCPeerConnection({ iceServers })
      peer = current; connection = payload.connection
      current.ontrack = event => { if (peer === current) events.stream(event.streams[0]) }
      current.onconnectionstatechange = () => {
        if (peer !== current || closed) return
        if (current.connectionState === 'failed') connectionLost(new Error('Video connection failed'))
        else if (current.connectionState === 'disconnected') connectionLoss ??= setTimeout(() => { if (peer === current) connectionLost(new Error('Video connection lost')) }, 5000)
        else { clearTimeout(connectionLoss); connectionLoss = undefined }
      }
      current.ondatachannel = event => {
        if (peer !== current) return
        channel = event.channel
        let opened = () => { if (peer === current) { if (mode === 'manage') finish(); if (mode === 'open' || options.view) send({ type: 'state' }) } }
        channel.onopen = opened
        if (channel.readyState === 'open') opened()
        channel.onmessage = event => {
          if (peer !== current) return
          let message = JSON.parse(event.data)
          receiveViewerMessage(message, { ...events, ready: finish, refresh })
          events.message?.(message)
        }
      }
      await current.setRemoteDescription(payload.sdp)
      if (peer !== current) return
      let pendingCandidates = candidates.get(payload.connection) ?? []
      candidates.clear()
      for (let candidate of pendingCandidates) await current.addIceCandidate(candidate)
      let answer = await prepareIceAnswer(current, payload.trickle ? candidate => {
        if (peer === current) void signal({ type: 'candidate', candidate, request: currentRequest, connection: payload.connection }).catch(() => undefined)
      } : undefined)
      if (peer === current) await signal({ type: 'answer', sdp: answer, request: currentRequest, connection: payload.connection })
    }).catch(error => { if (currentRequest !== request) return; let failure = error instanceof Error ? error : new Error('Connection failed'); finish(failure); events.error(failure.message) })
  }
  socket.onclose = () => { opening?.(new Error('Connection closed')); stopRefresh(); peer?.close(); connectionLost(new Error('Connection closed')) }
  socket.onerror = () => { opening?.(new Error('Connection unavailable')); finish(new Error('Connection unavailable')); events.error('Connection unavailable') }
  let ready = new Promise<void>((resolve, reject) => {
    let timer = setTimeout(() => { opening?.(new Error('Connection timed out')); socket.close() }, 15000)
    opening = error => { clearTimeout(timer); opening = undefined; if (error) reject(error); else resolve() }
    socket.onopen = () => opening?.()
  })
  await ready
  stopRefresh = options.observe ? options.observe(refresh) : observeViewerFocus(refresh, window, document)
  let open = async (selected: Host, payload: { type: 'manage'; session?: string } | { type: 'open'; session: string; pane: string }) => {
    let attempt = ++operation
    if (host) await signal({ type: 'close' })
    if (attempt !== operation || closed) throw new Error('Connection replaced')
    finish(new Error('Connection replaced'))
    clearTimeout(connectionLoss); connectionLoss = undefined; disconnected = false
    peer?.close(); peer = undefined; channel = undefined
    host = selected; mode = payload.type; seen.clear(); request = uuid(); connection = undefined; candidates.clear()
    let ready = new Promise<void>((resolve, reject) => { pending = { resolve, reject, timer: setTimeout(() => finish(new Error('Connection timed out. Check that the host is online.')), 20000) } })
    void ready.catch(() => {})
    try { await signal({ ...payload, request }) } catch (error) { if (attempt === operation) finish(error instanceof Error ? error : new Error('Unable to connect')) }
    await ready
  }
  return {
    id, publicKey, send,
    watch: (selected: Host, session: string, pane: string) => open(selected, { type: 'open', session, pane }),
    manage: (selected: Host, session?: string) => open(selected, { type: 'manage', ...(session ? { session } : {}) }),
    stop: () => { operation++; clearTimeout(connectionLoss); connectionLoss = undefined; if (host) void signal({ type: 'close' }).catch(() => undefined); finish(new Error('View stopped')); peer?.close(); peer = undefined; channel = undefined; host = undefined; mode = undefined; request = undefined; connection = undefined; candidates.clear() },
    close: () => { operation++; clearTimeout(connectionLoss); stopRefresh(); if (host) void signal({ type: 'close' }).catch(() => undefined); closed = true; finish(new Error('Connection closed')); peer?.close(); socket.close() },
  }
}
