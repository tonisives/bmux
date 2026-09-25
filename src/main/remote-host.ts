import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { remoteIdentity, createEnvelopeVerifier } from './remote-identity'
import type { createRuntime } from './runtime'
import type { RemoteEnvelope } from '../shared/remote'

type PublicKey = { kty: string; crv: string; x: string }
type Config = { url: string; token: string; identityFile: string; approvedClients: Record<string, PublicKey> }
type Stream = { close: () => void; answer: (sdp: RTCSessionDescriptionInit) => void; send: (data: string) => void }
export let startRemoteHost = (runtime: ReturnType<typeof createRuntime>, directory: string, configFile: string) => {
  let config = (): Config => {
    if (fs.statSync(configFile).mode & 0o077) throw new Error('Remote configuration must have mode 600')
    let value = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Config
    let url = new URL(value.url)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('Remote service requires HTTPS')
    if (!value.token || !value.identityFile || !value.approvedClients || typeof value.approvedClients !== 'object') throw new Error('Invalid remote configuration')
    return value
  }
  let initial = config(), identity = remoteIdentity(initial.identityFile)
  let hostFile = path.join(directory, 'remote-host-id')
  if (!fs.existsSync(hostFile)) fs.writeFileSync(hostFile, randomUUID(), { mode: 0o600, flag: 'wx' })
  let hostId = fs.readFileSync(hostFile, 'utf8').trim(), generation = randomUUID()
  let verify = createEnvelopeVerifier(hostId, generation, () => config().approvedClients)
  let socket: WebSocket | undefined, stopped = false, retry: ReturnType<typeof setTimeout> | undefined, backoff = 1000
  let opening = new Map<string, symbol>()
  let streams = new Map<string, { peer: Stream; pane: string }>(), iceServers: RTCIceServer[] = []
  let jobs = new Map<string, { at: number; result?: string }>()
  let day = new Date().toISOString().slice(0, 10)
  let sequence = 0, started = 0, succeeded = 0, failed = 0, browserMs = 0, lastUsage = Date.now()
  let send = (value: unknown) => { if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 262144) socket.send(JSON.stringify(value)) }
  let disconnect = (id: string) => { opening.delete(id); let stream = streams.get(id); streams.delete(id); stream?.peer.close(); runtime.remote.disconnect(id) }
  let signal = (to: string, payload: unknown) => send({ type: 'signal', to, envelope: identity.seal(to, generation, payload) })
  let state = (id: string) => { let stream = streams.get(id); stream?.peer.send(JSON.stringify({ type: 'state', ...runtime.remote.state(), pane: stream.pane })) }
  let open = async (id: string, pane?: string) => {
    if (!config().approvedClients[id]) throw new Error('Device is not approved')
    if (!streams.has(id) && !opening.has(id) && streams.size + opening.size >= 8) throw new Error('Viewer capacity reached')
    disconnect(id)
    let attempt = Symbol(); opening.set(id, attempt)
    let selected = pane ?? runtime.model.sessions[0]?.windows[0]?.panes[0]?.id
    if (!selected) { opening.delete(id); throw new Error('No pane available') }
    let peer: Stream | undefined
    try { peer = await runtime.remote.capture(selected, {
      iceServers,
      signal: sdp => { if (opening.get(id) === attempt || streams.get(id)?.peer === peer) signal(id, { type: 'offer', sdp }) },
      data: raw => {
        void (async () => {
          if (streams.get(id)?.peer !== peer) return
          if (!config().approvedClients[id]) { disconnect(id); return }
          let message = JSON.parse(raw)
          if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new Error('Invalid command')
          let result: unknown
          if (message.type === 'state') { state(id); return }
          if (message.type === 'switch' && typeof message.pane === 'string') { await open(id, message.pane); return }
          if (message.type === 'acquire') result = runtime.remote.acquire(String(message.session), id, message.takeover === true)
          else if (message.type === 'renew') result = runtime.remote.renew(String(message.session), id, Number(message.generation))
          else if (message.type === 'release') { runtime.remote.release(String(message.session), id); result = { released: true } }
          else if (message.type === 'command') result = await runtime.remote.command(id, Number(message.generation), message.command)
          else if (message.type === 'text') await runtime.remote.text(id, Number(message.generation), selected, message.text)
          else if (message.type === 'resize') result = await runtime.remote.resize(id, Number(message.generation), selected, message.width, message.height)
          else if (message.type === 'input') {
            let event = message.event
            if (!event || typeof event !== 'object') throw new Error('Invalid input')
            if (event.type?.startsWith('mouse')) {
              if (![event.x,event.y].every(value => Number.isFinite(value) && value >= 0 && value <= 8192)) throw new Error('Invalid pointer')
              if (event.type === 'mouseWheel' && ![event.deltaX,event.deltaY].every(value => Number.isFinite(value) && Math.abs(value) <= 8192)) throw new Error('Invalid scroll')
              if (event.button !== undefined && !['left','middle','right'].includes(event.button)) throw new Error('Invalid button')
            } else if (typeof event.keyCode !== 'string' || event.keyCode.length > 64) throw new Error('Invalid key')
            await runtime.remote.input(id, Number(message.generation), selected, Number(message.viewportGeneration), event)
          } else throw new Error('Remote command is not allowed')
          streams.get(id)?.peer.send(JSON.stringify({ type: 'result', request: message.request, result }))
          state(id)
        })().catch(error => streams.get(id)?.peer.send(JSON.stringify({ type: 'error', error: error instanceof Error && ['CONTROL_HELD','CONTROL_EXPIRED'].includes(error.message) ? error.message : 'Remote operation failed' })))
      },
      closed: () => { if (streams.get(id)?.peer === peer) { streams.delete(id); runtime.remote.disconnect(id) } },
    })
    } catch (error) { if (opening.get(id) === attempt) opening.delete(id); throw error }
    if (opening.get(id) !== attempt || !config().approvedClients[id] || stopped || socket?.readyState !== WebSocket.OPEN) { peer.close(); return }
    opening.delete(id)
    streams.set(id, { peer, pane: selected })
  }
  let connect = () => {
    if (stopped) return
    let current = config(), url = new URL('/connect', current.url)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('host', hostId); url.searchParams.set('generation', generation)
    socket = new WebSocket(url, { headers: { Authorization: `Bearer ${current.token}` }, maxPayload: 262144, handshakeTimeout: 10000 })
    socket.on('error', () => undefined)
    socket.on('message', raw => {
      void (async () => {
        let message = JSON.parse(raw.toString())
        if (message.type === 'ready') { iceServers = message.iceServers; backoff = 1000; return }
        if (message.type === 'revoked' || message.type === 'disconnected') { disconnect(message.id); return }
        if (message.type !== 'signal') return
        let envelope = message.envelope as RemoteEnvelope
        if (envelope.from !== message.from) throw new Error('Identity mismatch')
        let payload = verify(envelope)
        if (payload.type === 'open') await open(message.from)
        else if (payload.type === 'answer') streams.get(message.from)?.peer.answer(payload.sdp as RTCSessionDescriptionInit)
        else if (payload.type === 'close') disconnect(message.from)
      })().catch(() => undefined)
    })
    socket.on('close', () => {
      opening.clear()
      for (let id of streams.keys()) disconnect(id)
      if (!stopped) { retry = setTimeout(() => { try { connect() } catch { close() } }, backoff); backoff = Math.min(backoff * 2, 30000) }
    })
  }
  let usage = () => {
    let now = Date.now(), nextDay = new Date(now).toISOString().slice(0, 10)
    let active = [...jobs.values()].filter(job => !job.result).length
    if (nextDay !== day) {
      send({ type: 'usage', day, sequence: ++sequence, started, succeeded, failed, active, browserMs })
      day = nextDay; started = 0; succeeded = 0; failed = 0; browserMs = 0
    }
    if (active) browserMs += now - lastUsage
    lastUsage = now
    send({ type: 'usage', day, sequence: ++sequence, started, succeeded, failed, active, browserMs })
  }
  let timer = setInterval(() => {
    usage()
    try { for (let id of streams.keys()) { if (!config().approvedClients[id]) disconnect(id); else state(id) } } catch { for (let id of streams.keys()) disconnect(id) }
  }, 5000)
  let close = () => { opening.clear(); usage(); stopped = true; clearInterval(timer); clearTimeout(retry); for (let id of streams.keys()) disconnect(id); socket?.close() }
  connect()
  return {
    close,
    status: () => ({ hostId, generation, publicKey: identity.publicKey, fingerprint: identity.id, connected: socket?.readyState === WebSocket.OPEN }),
    job: (id: string, attempt: string, result?: 'succeeded' | 'failed') => {
      if (!id || id.length > 256 || !attempt || attempt.length > 256) throw new Error('Invalid job identity')
      usage()
      for (let [key, value] of jobs) if (value.result && value.at < Date.now() - 86400000) jobs.delete(key)
      let key = JSON.stringify([id, attempt]), job = jobs.get(key)
      if (!job && jobs.size >= 10000) throw new Error('Job reporting capacity reached')
      if (!job) { if (result) throw new Error('Job has not started'); jobs.set(key, { at: Date.now() }); started++ }
      else if (result && !job.result) { job.result = result; if (result === 'succeeded') succeeded++; else failed++ }
      usage()
      return { recorded: true }
    },
  }
}
