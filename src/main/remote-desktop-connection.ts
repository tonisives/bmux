import { WebSocket } from 'ws'
import type { WebContents } from 'electron'
import { createRemoteIdentity } from './remote-identity'
import type { Host } from '../../remote/web/client'

export let createRemoteDesktopConnection = (origin: string, host: Host, connect: (key: JsonWebKey) => Promise<{ ticket: string; iceServers: RTCIceServer[] }>) => {
  let identity = createRemoteIdentity()
  let socket: WebSocket | undefined, pending: Promise<{ ticket: string; iceServers: RTCIceServer[] }> | undefined
  let receivers = new Map<WebContents, string>(), hosts: string | undefined, closed = false
  let broadcast = (event: { type: 'message'; data: string } | { type: 'close' }) => {
    for (let contents of receivers.keys()) if (!contents.isDestroyed()) contents.send('remote-client-socket', event)
  }
  let open = () => {
    if (closed) return Promise.reject(new Error('Remote view closed'))
    if (pending) return pending
    pending = connect(identity.publicKey).then(async result => {
      if (closed) throw new Error('Remote view closed')
      let url = new URL('/connect', origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', result.ticket)
      let current = new WebSocket(url, { origin: 'file://', maxPayload: 262144, handshakeTimeout: 10000 }); socket = current
      current.on('error', () => undefined)
      current.on('message', raw => {
        if (socket !== current || closed) return
        let data = raw.toString()
        try { if (JSON.parse(data).type === 'hosts') hosts = data } catch { return }
        broadcast({ type: 'message', data })
      })
      current.on('close', () => { if (socket === current) { pending = undefined; hosts = undefined; socket = undefined; broadcast({ type: 'close' }) } })
      await new Promise<void>((resolve, reject) => { current.once('open', resolve); current.once('error', () => reject(new Error('Remote connection unavailable'))); current.once('close', () => reject(new Error('Remote connection closed'))) })
      return { ...result, ticket: 'desktop' }
    }).catch(error => { pending = undefined; throw error })
    return pending
  }
  let seal = (contents: WebContents, payload: Record<string, unknown>) => {
    let view = receivers.get(contents)
    if (!view || closed) throw new Error('Remote view closed')
    return identity.seal(host.id, host.generation, { ...payload, view })
  }
  let stop = (contents: WebContents, detach = true) => {
    let view = receivers.get(contents)
    if (view && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'signal', to: host.id, envelope: identity.seal(host.id, host.generation, { type: 'close', view }) }))
    if (detach) receivers.delete(contents)
  }
  return {
    publicKey: identity.publicKey, open, seal,
    attach: (contents: WebContents, metadata: boolean) => { let view = metadata ? 'workspace' : `pane:${contents.id}`; receivers.set(contents, view); contents.once('destroyed', () => { stop(contents); if (metadata) { closed = true; socket?.close() } }); return view },
    initial: () => hosts ? [hosts] : [],
    send: (contents: WebContents, data: string) => {
      if (!receivers.has(contents) || socket?.readyState !== WebSocket.OPEN || data.length > 262144) throw new Error('Remote connection closed')
      let message = JSON.parse(data)
      if (message.type !== 'signal' || message.to !== host.id || message.envelope?.from !== identity.id || JSON.parse(message.envelope.payload).view !== receivers.get(contents)) throw new Error('Invalid remote signal')
      socket.send(data)
    },
    stop,
    release: (contents: WebContents) => stop(contents, false),
    close: () => { closed = true; for (let contents of receivers.keys()) stop(contents); socket?.close() },
  }
}
