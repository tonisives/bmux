import os from 'node:os'
import { WebSocket } from 'ws'
import type { Model } from '../shared/types'
import { lockedPaneInventory } from './locked-pane-inventory'

export let startAccountRelay = (model: () => Model, origin: string, token: string, host: string, generation: string) => {
  let stopped = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, backoff = 1000
  let report = () => {
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 262144) return
    try {
      let message = JSON.stringify({ type: 'inventory', name: os.hostname().slice(0, 120), panes: lockedPaneInventory(model()) })
      if (Buffer.byteLength(message) <= 262144) socket.send(message)
    } catch { socket.close() }
  }
  let connect = () => {
    if (stopped) return
    let url = new URL('/api/v1/relay', origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('host', host); url.searchParams.set('generation', generation)
    socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: 262144, handshakeTimeout: 10000 })
    socket.on('error', () => undefined)
    socket.on('message', raw => { try { if (JSON.parse(raw.toString()).type === 'ready') { backoff = 1000; report() } } catch { socket?.close() } })
    socket.on('close', () => { if (!stopped) { retry = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000) } })
  }
  let timer = setInterval(report, 15000)
  timer.unref()
  connect()
  return { close: () => { stopped = true; clearInterval(timer); clearTimeout(retry); socket?.close() } }
}
