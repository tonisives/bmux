import os from 'node:os'
import { WebSocket } from 'ws'
import type { Model } from '../shared/types'
import { lockedPaneInventory } from './locked-pane-inventory'
import { createAccountRelayControl } from './account-relay-control'
import type { AccountConfiguration, AccountSettingsOperation } from './account-relay-control'

export let startAccountRelay = (model: () => Model, origin: string, token: string, host: string, generation: string, directory?: string, configure?: (platform: string, profileId: string, operation?: AccountSettingsOperation) => Promise<AccountConfiguration>) => {
  let stopped = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, backoff = 1000
  let control = directory && configure ? createAccountRelayControl(directory, () => lockedPaneInventory(model()), configure) : undefined
  let reporting = false
  let report = async () => {
    if (reporting || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 262144) return
    reporting = true
    let current = socket
    try {
      let browsing = control ? await control.inventory() : undefined
      if (current !== socket || current.readyState !== WebSocket.OPEN) return
      let message = JSON.stringify({ ...(browsing ? { browsing } : {}), type: 'inventory', name: os.hostname().slice(0, 120), panes: lockedPaneInventory(model()) })
      if (Buffer.byteLength(message) <= 262144) socket.send(message)
    } catch { current.close() } finally { reporting = false }
  }
  let connect = () => {
    if (stopped) return
    let url = new URL('/api/v1/relay', origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('host', host); url.searchParams.set('generation', generation)
    socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: 262144, handshakeTimeout: 10000 })
    socket.on('error', () => undefined)
    socket.on('message', raw => { void (async () => {
      try {
        let message = JSON.parse(raw.toString()), current = socket
        if (message.type === 'ready') { backoff = 1000; await report() }
        if (message.type === 'recorded' && control && Array.isArray(message.commands)) for (let command of message.commands.slice(0, 4)) {
          let result = await control.apply(command)
          if (current === socket && current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'settings-result', ...result }))
        }
      } catch { socket?.close() }
    })() })
    socket.on('close', () => { if (!stopped) { retry = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000) } })
  }
  let timer = setInterval(report, 15000)
  timer.unref()
  connect()
  return { close: () => { stopped = true; clearInterval(timer); clearTimeout(retry); socket?.close() } }
}
