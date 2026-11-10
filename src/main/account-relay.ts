import os from 'node:os'
import { WebSocket } from 'ws'
import type { createRuntime } from './runtime'
import { lockedPaneInventory } from './locked-pane-inventory'
import { createAccountRelayControl } from './account-relay-control'
import type { AccountConfiguration, AccountSettingsOperation } from './account-relay-control'

export let startAccountRelay = (runtime: Pick<ReturnType<typeof createRuntime>, 'model' | 'accounts'>, origin: string, token: string, host: string, generation: string, directory?: string, configure?: (platform: string, profileId: string, operation?: AccountSettingsOperation) => Promise<AccountConfiguration>) => {
  let stopped = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, backoff = 1000
  let control = directory && configure ? createAccountRelayControl(directory, () => lockedPaneInventory(runtime.model), configure) : undefined
  let reporting = false
  let report = async () => {
    if (reporting || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 262144) return
    reporting = true
    let current = socket
    try {
      let browsing = control ? await control.inventory() : undefined
      if (stopped || current !== socket || current.readyState !== WebSocket.OPEN) return
      let message = JSON.stringify({ ...(browsing ? { browsing } : {}), type: 'inventory', control: 1, name: os.hostname().slice(0, 120), panes: lockedPaneInventory(runtime.model) })
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
    let connection = socket, queue = Promise.resolve()
    connection.on('message', raw => {
      queue = queue.then(async () => {
        if (stopped || socket !== connection || connection.readyState !== WebSocket.OPEN) return
        let message = JSON.parse(raw.toString())
        if (message.type === 'ready') { backoff = 1000; await report(); return }
        if (message.type === 'recorded' && control && Array.isArray(message.commands)) {
          for (let command of message.commands.slice(0, 4)) {
            let result = await control.apply(command)
            if (!stopped && socket === connection && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'settings-result', ...result }))
          }
          return
        }
        if (message.type !== 'seal') return
        if (!/^[a-f0-9-]{36}$/.test(message.request) || !/^[a-f0-9-]{36}$/.test(message.account) || !Number.isFinite(message.expires) || message.expires <= Date.now() || message.expires > Date.now() + 60000) throw new Error('Invalid account request')
        let valid = () => !stopped && socket === connection && connection.readyState === WebSocket.OPEN && message.expires > Date.now()
        let result: unknown, error: string | undefined
        try { result = await runtime.accounts.seal(message.account, message.identity, valid) }
        catch (value) { let code = (value as Error).message; error = /^[A-Z_]{1,80}$/.test(code) ? code : 'ACCOUNT_SEAL_FAILED' }
        if (valid()) { connection.send(JSON.stringify({ type: 'result', request: message.request, ...(error ? { error } : { result }) })); report() }
      }).catch(() => connection.close())
    })
    socket.on('close', () => { if (!stopped) { retry = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000) } })
  }
  let timer = setInterval(report, 15000)
  timer.unref()
  connect()
  return { close: () => { stopped = true; clearInterval(timer); clearTimeout(retry); socket?.close() } }
}
