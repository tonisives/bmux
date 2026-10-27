import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { createRemoteIdentity } from './remote-identity'
import type { Host } from '../../remote/web/client'

export let createRemoteDesktopConnection = (origin: string, host: Host, connect: (key: JsonWebKey) => Promise<{ ticket: string; iceServers: RTCIceServer[] }>, identity = createRemoteIdentity()) => {
  let workspaceView = `workspace:${randomUUID()}`
  let socket: WebSocket | undefined, pending: Promise<void> | undefined
  let receivers = new Map<WebContents, string>(), hosts: string | undefined, closed = false
  let configuration: { iceServers: RTCIceServer[]; ready?: string } | undefined
  let clear = () => { pending = undefined; hosts = undefined; configuration = undefined }
  let broadcast = (event: { type: 'message'; data: string } | { type: 'close' }) => {
    for (let contents of receivers.keys()) if (!contents.isDestroyed()) contents.send('remote-client-socket', event)
  }
  let open = async () => {
    if (closed) throw new Error('Remote view closed')
    pending ??= connect(identity.publicKey).then(async result => {
      if (closed) throw new Error('Remote view closed')
      configuration = { iceServers: result.iceServers }
      let url = new URL('/connect', origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', result.ticket)
      let current = new WebSocket(url, { origin: 'file://', maxPayload: 262144, handshakeTimeout: 10000 }); socket = current
      current.on('error', () => undefined)
      current.on('message', raw => {
        if (socket !== current || closed) return
        let data = raw.toString()
        try {
          let message = JSON.parse(data)
          if (message.type === 'hosts') hosts = data
          else if (message.type === 'ready') configuration = { iceServers: message.iceServers, ready: data }
        } catch { return }
        broadcast({ type: 'message', data })
      })
      current.on('close', () => { if (socket === current) { clear(); socket = undefined; broadcast({ type: 'close' }) } })
      await new Promise<void>((resolve, reject) => { current.once('open', resolve); current.once('error', () => reject(new Error('Remote connection unavailable'))); current.once('close', () => reject(new Error('Remote connection closed'))) })
    }).catch(error => { clear(); throw error })
    await pending
    if (closed) throw new Error('Remote view closed')
    if (!configuration || socket?.readyState !== WebSocket.OPEN) throw new Error('Remote connection closed')
    return { ticket: 'desktop', iceServers: configuration.iceServers }
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
  let close = () => { closed = true; clear(); for (let contents of receivers.keys()) stop(contents); socket?.close() }
  return {
    publicKey: identity.publicKey, open, seal,
    attach: (contents: WebContents, metadata: boolean) => { let view = metadata ? workspaceView : `pane:${contents.id}`; receivers.set(contents, view); contents.once('destroyed', () => { stop(contents); if (metadata) { closed = true; clear(); socket?.close() } }); return view },
    initial: () => [...(configuration?.ready ? [configuration.ready] : []), ...(hosts ? [hosts] : [])],
    send: (contents: WebContents, data: string) => {
      if (!receivers.has(contents) || socket?.readyState !== WebSocket.OPEN || data.length > 262144) throw new Error('Remote connection closed')
      let message = JSON.parse(data)
      if (message.type !== 'signal' || message.to !== host.id || message.envelope?.from !== identity.id || JSON.parse(message.envelope.payload).view !== receivers.get(contents)) throw new Error('Invalid remote signal')
      socket.send(data)
    },
    stop,
    release: (contents: WebContents) => stop(contents, false),
    close,
  }
}
