import { envelopeText, validEnvelope } from '../../src/shared/remote'
import type { RemoteEnvelope } from '../../src/shared/remote'
export type Host = { id: string; service: string; generation: string; key: JsonWebKey }
export type Session = { id: string; name: string; windows: { panes: { id: string; title: string; url: string }[] }[] }
export type State = { viewports: Record<string, { width: number; height: number; generation: number }>; pane: string; sessions: Session[]; controls: Record<string, { owner: string; generation: number }> }
let bytes = (text: string) => new TextEncoder().encode(text)
let base64 = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data)))
let decode = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0))
export let fingerprint = async (key: JsonWebKey) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(key.x!)))].map(value => value.toString(16).padStart(2, '0')).join('')
export let api = async (endpoint: string, value?: unknown) => {
  let response = await fetch(endpoint, { credentials: 'same-origin', ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) })
  if (!response.ok) throw new Error('Sign in or reconnect to continue')
  return response.json()
}
export let createViewer = async (events: { hosts: (hosts: Host[]) => void; stream: (stream: MediaStream) => void; state: (state: State) => void; error: (text: string) => void; disconnected: () => void }) => {
  let stored = localStorage.getItem('bmux-device-key')
  let key: JsonWebKey
  if (stored) key = JSON.parse(stored)
  else { let pair = await crypto.subtle.generateKey('Ed25519', true, ['sign','verify']) as CryptoKeyPair; key = await crypto.subtle.exportKey('jwk', pair.privateKey); localStorage.setItem('bmux-device-key', JSON.stringify(key)) }
  let privateKey = await crypto.subtle.importKey('jwk', key, 'Ed25519', false, ['sign'])
  let publicKey = { kty: key.kty, crv: key.crv, x: key.x }
  let id = await fingerprint(publicKey)
  let { ticket, iceServers } = await api('/api/connect', { publicKey })
  let url = new URL('/connect', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket)
  let socket = new WebSocket(url), host: Host | undefined, peer: RTCPeerConnection | undefined, channel: RTCDataChannel | undefined
  let seen = new Set<string>(), closed = false
  let signal = async (payload: unknown) => {
    if (!host || socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected')
    let envelope = { version: 1 as const, from: id, to: host.id, generation: host.generation, nonce: crypto.randomUUID(), expires: Date.now() + 60000, payload: JSON.stringify(payload) }
    let signature = base64(await crypto.subtle.sign('Ed25519', privateKey, bytes(envelopeText(envelope))))
    socket.send(JSON.stringify({ type: 'signal', to: host.id, envelope: { ...envelope, signature } }))
  }
  let send = (message: unknown) => { if (channel?.readyState === 'open' && channel.bufferedAmount < 65536) channel.send(JSON.stringify(message)) }
  socket.onmessage = event => {
    void (async () => {
      let message = JSON.parse(event.data)
      if (message.type === 'hosts') { events.hosts(message.hosts); return }
      if (message.type === 'disconnected' && message.id === host?.id) { peer?.close(); events.disconnected(); return }
      if (message.type !== 'signal' || !host || message.from !== host.id) return
      let envelope = message.envelope as RemoteEnvelope
      if (!validEnvelope(envelope, id, host.generation) || seen.has(envelope.nonce) || envelope.from !== await fingerprint(host.key)) throw new Error('Invalid host signature')
      let publicKey = await crypto.subtle.importKey('jwk', host.key, 'Ed25519', false, ['verify'])
      if (!await crypto.subtle.verify('Ed25519', publicKey, decode(envelope.signature), bytes(envelopeText(envelope)))) throw new Error('Invalid host signature')
      seen.add(envelope.nonce)
      let payload = JSON.parse(envelope.payload)
      if (payload.type !== 'offer') return
      peer?.close()
      peer = new RTCPeerConnection({ iceServers })
      peer.ontrack = event => events.stream(event.streams[0])
      peer.onconnectionstatechange = () => { if (['failed','closed','disconnected'].includes(peer?.connectionState ?? '')) events.disconnected() }
      peer.ondatachannel = event => {
        channel = event.channel
        channel.onopen = () => send({ type: 'state' })
        channel.onmessage = event => {
          let message = JSON.parse(event.data)
          if (message.type === 'state') events.state(message)
          else if (message.type === 'error') events.error(message.error)
        }
      }
      await peer.setRemoteDescription(payload.sdp)
      await peer.setLocalDescription(await peer.createAnswer())
      if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => { let timer = setTimeout(() => reject(new Error('Connection timed out')), 15000); peer!.onicegatheringstatechange = () => { if (peer?.iceGatheringState === 'complete') { clearTimeout(timer); resolve() } } })
      await signal({ type: 'answer', sdp: peer.localDescription!.toJSON() })
    })().catch(error => events.error(error instanceof Error ? error.message : 'Connection failed'))
  }
  socket.onclose = () => { peer?.close(); if (!closed) events.disconnected() }
  socket.onerror = () => events.error('Connection unavailable')
  let ready = new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); setTimeout(() => { if (socket.readyState !== WebSocket.OPEN) reject(new Error('Connection timed out')) }, 15000) })
  await ready
  return {
    id, publicKey, send,
    watch: async (selected: Host, trustedFingerprint: string) => {
      if (trustedFingerprint !== await fingerprint(selected.key)) throw new Error('Host fingerprint does not match')
      if (host) await signal({ type: 'close' })
      host = selected; seen.clear(); await signal({ type: 'open' })
    },
    close: () => { closed = true; peer?.close(); socket.close() },
  }
}
