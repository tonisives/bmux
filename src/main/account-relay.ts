import os from 'node:os'
import { WebSocket } from 'ws'
import type { createRuntime } from './runtime'
import { lockedPaneInventory } from './locked-pane-inventory'
import { createAccountRelayControl } from './account-relay-control'
import type { AccountConfiguration, AccountSettingsOperation } from './account-relay-control'

export let startAccountRelay = (runtime: Pick<ReturnType<typeof createRuntime>, 'model' | 'accounts'>, origin: string, token: string, host: string, generation: string, directory?: string, configure?: (platform: string, profileId: string, operation?: AccountSettingsOperation) => Promise<AccountConfiguration>) => {
  runtime.accounts.proxies.configure({ origin, token, host, generation })
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
      let executions = await runtime.accounts.jobs.receipts()
      let message = JSON.stringify({ ...(browsing ? { browsing } : {}), executions, actions: runtime.accounts.actions(), type: 'inventory', control: 3, transferKey: runtime.accounts.mobility.publicKey(), name: os.hostname().slice(0, 120), panes: lockedPaneInventory(runtime.model).map(pane => ({ ...pane, controlled: runtime.accounts.controlled(pane.key) })) })
      if (Buffer.byteLength(message) <= 262144) socket.send(message)
    } catch { current.close() } finally { reporting = false }
  }
  let connect = () => {
    if (stopped) return
    let url = new URL('/api/v1/relay', origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('host', host); url.searchParams.set('generation', generation)
    socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: 8_000_000, handshakeTimeout: 10000 })
    socket.on('error', () => undefined)
    let connection = socket, queue = Promise.resolve()
    connection.on('message', raw => {
      queue = queue.then(async () => {
        if (stopped || socket !== connection || connection.readyState !== WebSocket.OPEN) return
        let message = JSON.parse(raw.toString())
        if (message.type === 'ready') { backoff = 1000; await report(); return }
        if (message.type === 'recorded') {
          for (let id of (Array.isArray(message.cancelJobs) ? message.cancelJobs.slice(0, 100) : [])) await runtime.accounts.jobs.cancel(String(id))
          for (let command of (control && Array.isArray(message.commands) ? message.commands.slice(0, 4) : [])) {
            let result = await control!.apply(command)
            if (!stopped && socket === connection && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'settings-result', ...result }))
          }
          return
        }
        if (message.type === 'mobility') {
          let valid = () => !stopped && socket === connection && connection.readyState === WebSocket.OPEN && message.expires > Date.now()
          let result: Record<string, unknown>
          try { result = await runtime.accounts.mobility.apply(message, valid) }
          catch (value) { let code = (value as Error).message; result = { error: /^[A-Z_]{1,80}$/.test(code) ? code : 'ACCOUNT_TRANSFER_FAILED', unstarted: !Object.values(runtime.model.accountRetired ?? {}).includes(message.id) && !Object.values(runtime.model.accountStaged ?? {}).includes(message.id) } }
          if (!stopped && socket === connection && connection.readyState === WebSocket.OPEN) { connection.send(JSON.stringify({ type: 'mobility-result', id: message.id, ...result })); await report() }
          return
        }
        if (message.type === 'run') {
          if (!Number.isFinite(message.expires) || message.expires <= Date.now() || message.expires > Date.now() + 60000) throw new Error('Invalid job delivery')
          let valid = () => !stopped && socket === connection && connection.readyState === WebSocket.OPEN
          let result
          try { result = await runtime.accounts.jobs.accept(message.job, valid) }
          catch (value) { let code = (value as Error).message; result = { id: message.job?.id, status: code === 'CONTROL_HELD' ? 'busy' : 'failed', error: /^[A-Z_]{1,80}$/.test(code) ? code : 'ACCOUNT_JOB_FAILED' } }
          if (valid()) connection.send(JSON.stringify({ type: 'job-result', ...result }))
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
  return { close: () => { stopped = true; runtime.accounts.proxies.disconnect(); clearInterval(timer); clearTimeout(retry); socket?.close() } }
}
