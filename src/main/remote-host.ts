import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { remoteIdentity, createEnvelopeVerifier } from './remote-identity'
import type { createRuntime } from './runtime'
import type { RemoteEnvelope } from '../shared/remote'
import { sessionActivityTime } from '../shared/pane-activity'
import { agentInfo } from '../shared/agent-info'
import { encryptRemotePreview } from '../shared/remote-preview'
import { remoteStreamQuality, type RemoteStreamQuality, type RemoteRPCRequest } from '../shared/remote-management'

type PublicKey = { kty: string; crv: string; x: string }
type Config = { url: string; token: string; identityFile?: string }
type Stream = { close: () => void; answer: (sdp: RTCSessionDescriptionInit) => void; candidate: (value: RTCIceCandidateInit) => void; send: (data: string) => void; quality: (quality: RemoteStreamQuality) => Promise<RemoteStreamQuality> }
export let startRemoteHost = (runtime: ReturnType<typeof createRuntime>, directory: string, configFile: string) => {
  let config = (): Config => {
    if (fs.statSync(configFile).mode & 0o077) throw new Error('Remote configuration must have mode 600')
    let value = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Config
    let url = new URL(value.url)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('Remote service requires HTTPS')
    if (!value.token) throw new Error('Invalid remote configuration')
    return value
  }
  let initial = config(), identity = remoteIdentity(initial.identityFile ?? path.join(directory, 'remote-identity.pem'))
  runtime.remote.enablePreviews()
  let hostFile = path.join(directory, 'remote-host-id')
  if (!fs.existsSync(hostFile)) fs.writeFileSync(hostFile, randomUUID(), { mode: 0o600, flag: 'wx' })
  let hostId = fs.readFileSync(hostFile, 'utf8').trim(), generation = randomUUID()
  let authorized = new Map<string, { key: PublicKey; permission: 'watch' | 'control' }>()
  let allowed = (id: string) => authorized.get(id)?.permission
  let verify = createEnvelopeVerifier(hostId, generation, () => Object.fromEntries([...authorized].map(([id, value]) => [id, value.key])))
  let socket: WebSocket | undefined, stopped = false, retry: ReturnType<typeof setTimeout> | undefined, backoff = 1000
  let opening = new Map<string, symbol>()
  let previewing = new Set<string>()
  let streams = new Map<string, { peer: Stream; pane?: string; request?: string; connection: string; expires?: number; expiry?: ReturnType<typeof setTimeout>; renewing?: boolean }>(), iceServers: RTCIceServer[] = []
  let streamPermits = false
  let attention = new Map<string, { target: ReturnType<typeof runtime.remote.attentionHistory>[number]; acknowledged: boolean }>()
  let reportAttention = () => {
    let active = runtime.remote.attentions()
    for (let target of active) if (!attention.has(target.episode)) attention.set(target.episode,{ target, acknowledged:false })
    for (let target of runtime.remote.attentionHistory()) {
      let item = attention.get(target.episode)
      if (item && item.target.revision !== target.revision) { item.target = target; item.acknowledged = false }
    }
    for (let item of attention.values()) {
      if (!item.acknowledged) send({ type:'attention', ...item.target })
    }
  }
  let permits = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let jobs = new Map<string, { at: number; result?: string }>()
  let day = new Date().toISOString().slice(0, 10)
  let sequence = 0, started = 0, succeeded = 0, failed = 0, browserMs = 0, lastUsage = Date.now()
  let send = (value: unknown) => { if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 262144) socket.send(JSON.stringify(value)) }
  let permit = (id: string, connection: string, pane: string, renew = false) => {
    if (!streamPermits) return Promise.resolve()
    let request = randomUUID()
    return new Promise<void>((resolve, reject) => {
      let timer = setTimeout(() => { permits.delete(request); reject(new Error('Stream permit unavailable')) }, 5000)
      permits.set(request, { resolve, reject, timer })
      send({ type: renew ? 'stream-renew' : 'stream-acquire', request, viewer: id, connection, pane })
    })
  }
  let releasePermit = (connection: string) => { if (streamPermits) send({ type: 'stream-release', connection }) }
  let lastSessions = ''
  let advertise = () => {
    let definitions = runtime.state().automationAgents?.definitions ?? {}
    let sessions = runtime.model.sessions.filter(session => !session.ephemeral).map(session => ({
      id: session.id, name: session.name, revision: runtime.remote.sessionRevision(session.id), defaultProfileId:session.defaultProfileId, private: session.private === true, canClose: process.env.BMUX_INTERACTIVE_ONLY !== 'true', canPreview: true, lastActivityAt: sessionActivityTime(session),
      panes: session.windows.flatMap(window => window.panes.map(pane => {
        let { agentOrigin: _origin, ...actor } = pane.lastUsedBy === 'human' ? {} : agentInfo(pane)
        let fields = actor.agentType ? definitions[actor.agentType]?.fields : undefined
        return { id: pane.id, title: pane.title, ...actor, ...(fields ? { agentFields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.label])) } : {}) }
      })),
    }))
    let serialized = JSON.stringify(sessions)
    if (serialized !== lastSessions) { send({ type: 'sessions', sessions, capabilities:runtime.remote.capabilities }); lastSessions = serialized }
  }
  let disconnect = (id: string, release = true) => { opening.delete(id); let stream = streams.get(id); streams.delete(id); if (stream) { clearTimeout(stream.expiry); if (stream.pane) releasePermit(stream.connection); stream.peer.close() } if (release) runtime.remote.disconnect(id) }
  let extendPermit = (id: string) => { let stream = streams.get(id); if (!stream?.pane || !streamPermits) return; clearTimeout(stream.expiry); stream.expires = Date.now() + 18000; stream.expiry = setTimeout(() => disconnect(id), 18000) }
  let signal = (to: string, payload: unknown) => send({ type: 'signal', to, envelope: identity.seal(to, generation, payload) })
  let state = (id: string) => { let stream = streams.get(id); stream?.peer.send(JSON.stringify({ type: 'state', ...runtime.remote.state(), pane: stream.pane })) }
  let open = async (id: string, pane?: string, request?: string, switching = false, managing = false, quality?: RemoteStreamQuality) => {
    if (!allowed(id)) throw new Error('Access revoked')
    if (!streams.has(id) && !opening.has(id) && streams.size + opening.size >= 8) throw new Error('Viewer capacity reached')
    let previousPane = streams.get(id)?.pane
    let sameSession = switching && runtime.model.sessions.some(session => { let panes = session.windows.flatMap(window => window.panes); return panes.some(item => item.id === previousPane) && panes.some(item => item.id === pane) })
    disconnect(id, !sameSession)
    let attempt = Symbol(); opening.set(id, attempt)
    let selected = managing ? undefined : pane ?? runtime.model.sessions[0]?.windows[0]?.panes[0]?.id
    if (!managing && !selected) { opening.delete(id); throw new Error('No pane available') }
    let peer: Stream | undefined
    let connection = randomUUID()
    let offer: RTCSessionDescriptionInit | undefined
    let candidates: RTCIceCandidateInit[] = []
    let publishOffer = (sdp: RTCSessionDescriptionInit) => signal(id, { type: 'offer', sdp, ...(request ? { request, connection, trickle: true } : {}) })
    let incoming = Promise.resolve()
    try {
      if (streamPermits && selected) await permit(id, connection, selected)
      if (opening.get(id) !== attempt || !allowed(id) || stopped) { releasePermit(connection); return }
      peer = await runtime.remote.capture(selected, {
      iceServers,
      quality,
      signal: sdp => {
        // Capture can produce an offer before its promise returns the stream.
        // Publish only after answer routing can find that stream.
        if (opening.get(id) === attempt) offer = sdp
        else if (peer && streams.get(id)?.peer === peer) publishOffer(sdp)
      },
      ...(request ? { candidate: (candidate: RTCIceCandidateInit) => {
        if (opening.get(id) === attempt) candidates.push(candidate)
        else if (peer && streams.get(id)?.peer === peer) signal(id, { type: 'candidate', candidate, request, connection })
      } } : {}),
      data: raw => {
        let correlation: string | undefined
        incoming = incoming.then(async () => {
          if (streams.get(id)?.peer !== peer) return
          if (!allowed(id)) { disconnect(id); return }
          let message = JSON.parse(raw)
          if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new Error('Invalid command')
          correlation = typeof message.request === 'string' && message.request.length <= 64 ? message.request : undefined
          let result: unknown
          if (message.type === 'state') { state(id); return }
          if (message.type === 'switch' && typeof message.pane === 'string') { await open(id, message.pane, request, true); return }
          if (message.type === 'quality') {
            if (!selected || !['auto','data-saver','quality'].includes(message.mode) || !['cellular','wifi','unknown'].includes(message.network)) throw new Error('INVALID_REQUEST')
            result = await peer!.quality(remoteStreamQuality(message.mode,message.network))
            streams.get(id)?.peer.send(JSON.stringify({type:'result',request:correlation,result})); return
          }
          if (allowed(id) !== 'control') throw new Error('Watch only access')
          if (message.type === 'rpc') { result = await runtime.remote.rpc(id,message as RemoteRPCRequest); advertise() }
          else if (message.type === 'acquire') result = runtime.remote.acquire(String(message.session), id, message.takeover === true)
          else if (message.type === 'renew') result = runtime.remote.renew(String(message.session), id, Number(message.generation))
          else if (message.type === 'release') { runtime.remote.release(String(message.session), id); result = { released: true } }
          else if (message.type === 'resume') { if (!selected) throw new Error('LIVE_VIEW_REQUIRED'); result = await runtime.remote.resume(id,Number(message.generation),selected,typeof message.episode === 'string' ? message.episode : undefined,correlation,Number(message.revision)); reportAttention() }
          else if (message.type === 'command') result = await runtime.remote.command(id, Number(message.generation), message.command)
          else if (message.type === 'text') { if (!selected) throw new Error('LIVE_VIEW_REQUIRED'); await runtime.remote.text(id, Number(message.generation), selected, message.text) }
          else if (message.type === 'resize') { if (!selected) throw new Error('LIVE_VIEW_REQUIRED'); result = await runtime.remote.resize(id, Number(message.generation), selected, message.width, message.height) }
          else if (message.type === 'input') {
            if (!selected) throw new Error('LIVE_VIEW_REQUIRED')
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
        }).catch(error => {
          if (streams.get(id)?.peer !== peer) return
          let message = error instanceof Error ? error.message : ''
          let code = /^[A-Z][A-Z0-9_]{1,63}$/.test(message) ? message : message === 'Watch only access' ? 'WATCH_ONLY' : 'REMOTE_OPERATION_FAILED'
          peer?.send(JSON.stringify({ type:'error', request:correlation, code, error:code === 'REMOTE_OPERATION_FAILED' ? 'Remote operation failed' : message, retryable:['STALE_REVISION','ATTENTION_CHANGED','QUALITY_UNAVAILABLE'].includes(code) }))
        })
      },
      closed: () => { if (streams.get(id)?.peer === peer) disconnect(id) },
    })
    } catch (error) { releasePermit(connection); if (opening.get(id) === attempt) opening.delete(id); throw error }
    try { if (streamPermits && selected) await permit(id,connection,selected,true) } catch (error) { peer.close(); releasePermit(connection); if (opening.get(id) === attempt) opening.delete(id); throw error }
    if (opening.get(id) !== attempt || !allowed(id) || stopped || socket?.readyState !== WebSocket.OPEN) { releasePermit(connection); peer.close(); return }
    opening.delete(id)
    streams.set(id, { peer, pane: selected, request, connection })
    extendPermit(id)
    if (offer) publishOffer(offer)
    for (let candidate of candidates) signal(id, { type: 'candidate', candidate, request, connection })
  }
  let connect = () => {
    if (stopped) return
    let current = config(), url = new URL('/connect', current.url)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('host', hostId); url.searchParams.set('generation', generation)
    url.searchParams.set('protocol', '2')
    if (process.env.BMUX_HOST_INSTANCE) url.searchParams.set('instance',process.env.BMUX_HOST_INSTANCE)
    url.searchParams.set('key', Buffer.from(JSON.stringify(identity.publicKey)).toString('base64url'))
    socket = new WebSocket(url, { headers: { Authorization: `Bearer ${current.token}` }, maxPayload: 262144, handshakeTimeout: 10000 })
    socket.on('error', () => undefined)
    socket.on('message', raw => {
      void (async () => {
        let message = JSON.parse(raw.toString())
        if (message.type === 'ready') { iceServers = message.iceServers; streamPermits = message.streamPermits === true; backoff = 1000; lastSessions = ''; advertise(); for (let item of attention.values()) item.acknowledged = false; reportAttention(); return }
        if (message.type === 'attention-recorded') { let item = attention.get(message.episode); if (item && item.target.revision === message.revision) item.acknowledged = true; return }
        if (message.type === 'stream-permit') { let pending = permits.get(message.request); if (pending) { clearTimeout(pending.timer); permits.delete(message.request); if (message.error) pending.reject(Object.assign(new Error(String(message.error)),{code:message.code})); else pending.resolve() } return }
        if (message.type === 'stream-revoked') { for (let [id, stream] of streams) if (stream.connection === message.connection) disconnect(id); return }
        if (message.type === 'authorized') {
          if (message.permission !== 'watch' && message.permission !== 'control') return
          if (authorized.get(message.id)?.permission === 'control' && message.permission === 'watch') runtime.remote.disconnect(message.id)
          authorized.set(message.id, { key: message.key, permission: message.permission }); return
        }
        if (message.type === 'revoked' || message.type === 'disconnected') { authorized.delete(message.id); disconnect(message.id); return }
        if (message.type !== 'signal') return
        let envelope = message.envelope as RemoteEnvelope
        if (envelope.from !== message.from) throw new Error('Identity mismatch')
        let payload = verify(envelope)
        if (payload.type === 'session-previews') {
          try {
            if (!allowed(message.from)) throw new Error('Access revoked')
            if (typeof payload.session !== 'string' || typeof payload.request !== 'string' || payload.request.length > 64) throw new Error('Invalid preview request')
            if (!Array.isArray(payload.panes) || payload.panes.length > 100 || !payload.panes.every(pane => typeof pane === 'string' && pane.length <= 128)) throw new Error('Invalid preview panes')
            let requested = new Set(payload.panes)
            if (previewing.has(message.from) || previewing.size >= 4) throw new Error('Preview capacity reached')
            let key = payload.key as JsonWebKey
            if (key?.kty !== 'OKP' || key.crv !== 'X25519' || typeof key.x !== 'string' || key.x.length > 64) throw new Error('Invalid preview key')
            previewing.add(message.from)
            try {
              let current = socket, previews = await runtime.remote.previews(payload.session)
              for (let [pane, snapshot] of Object.entries(previews)) {
                if (!requested.has(pane)) continue
                let preview = await encryptRemotePreview(key, snapshot)
                if (socket !== current || current?.readyState !== WebSocket.OPEN || !allowed(message.from) || !runtime.model.sessions.some(session => session.id === payload.session && session.windows.some(window => window.panes.some(item => item.id === pane)))) return
                // Await each write so larger sessions stay within relay backpressure limits.
                await new Promise<void>((resolve, reject) => current.send(JSON.stringify({ type: 'signal', to: message.from, envelope: identity.seal(message.from, generation, { type: 'session-preview', request: payload.request, pane, preview }) }), error => error ? reject(error) : resolve()))
              }
              if (socket === current && allowed(message.from)) signal(message.from, { type: 'session-previews-complete', request: payload.request })
            } finally { previewing.delete(message.from) }
          } catch (error) { signal(message.from, { type: 'error', request: payload.request, error: error instanceof Error ? error.message : 'Unable to load previews' }) }
        }
        else if (payload.type === 'close-session') {
          try {
            if (allowed(message.from) !== 'control') throw new Error('Watch only access')
            if (typeof payload.session !== 'string') throw new Error('Invalid session')
            let result = await runtime.remote.closeSession(payload.session)
            if (result.cancelled) throw new Error('Session closing canceled')
            signal(message.from, { type: 'session-closed', request: payload.request })
            advertise()
          } catch (error) { signal(message.from, { type: 'error', request: payload.request, error: error instanceof Error ? error.message : 'Unable to close session' }) }
        }
        else if (payload.type === 'manage') {
          try { if (typeof payload.request !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.request)) throw new Error('INVALID_REQUEST'); await open(message.from,undefined,payload.request,false,true) }
          catch { signal(message.from,{type:'error',request:payload.request,code:'MANAGEMENT_UNAVAILABLE',error:'Management connection unavailable'}) }
        }
        else if (payload.type === 'open') { try {
          let session = runtime.model.sessions.find(session => session.id === payload.session)
          let pane = session?.windows.flatMap(window => window.panes).find(pane => pane.id === payload.pane)
          if (!pane) throw new Error('Session is no longer available')
          await open(message.from, pane.id, typeof payload.request === 'string' && payload.request.length <= 64 ? payload.request : undefined)
        } catch (error) { signal(message.from, { type: 'error', request:payload.request, ...(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? {code:error.code} : {}), error: error instanceof Error ? error.message : 'Unable to watch' }) } }
        else if (payload.type === 'answer' || payload.type === 'candidate') {
          let stream = streams.get(message.from)
          if (!stream || stream.request && (payload.request !== stream.request || payload.connection !== stream.connection)) return
          if (payload.type === 'answer') stream.peer.answer(payload.sdp as RTCSessionDescriptionInit)
          else if (stream.request) stream.peer.candidate(payload.candidate as RTCIceCandidateInit)
        }
        else if (payload.type === 'close') disconnect(message.from)
      })().catch(() => undefined)
    })
    socket.on('close', () => {
      for (let pending of permits.values()) { clearTimeout(pending.timer); pending.reject(new Error('Relay disconnected')) } permits.clear()
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
    advertise()
    reportAttention()
    try { for (let [id, stream] of streams) {
      if (!allowed(id)) { disconnect(id); continue }
      state(id)
      if (streamPermits && stream.pane && !stream.renewing) {
        stream.renewing = true
        void permit(id,stream.connection,stream.pane,true).then(() => { if (streams.get(id) === stream) extendPermit(id) }).catch(() => { if (streams.get(id) === stream) disconnect(id) }).finally(() => { stream.renewing = false })
      }
    } } catch { for (let id of streams.keys()) disconnect(id) }
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
