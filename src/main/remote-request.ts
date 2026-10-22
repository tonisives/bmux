import { createHash, randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { createEnvelopeVerifier } from './remote-identity'
import type { remoteIdentity } from './remote-identity'
import type { RemoteEnvelope } from '../shared/remote'

type Host = { canClose?: boolean; id: string; generation: string; key: JsonWebKey }
export let requestRemoteSessionClose = async (origin: string, host: Host, session: string, identity: ReturnType<typeof remoteIdentity>, connect: (key: JsonWebKey) => Promise<{ ticket: string }>) => {
  if (!host.canClose) throw new Error('Update this remote host to close sessions')
  let request = randomUUID()
  let { ticket } = await connect(identity.publicKey)
  let url = new URL('/connect', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket)
  let verify = createEnvelopeVerifier(identity.id, host.generation, () => ({ [createHash('sha256').update(host.key.x!).digest('hex')]: host.key as { kty: string; crv: string; x: string } }))
  await new Promise<void>((resolve, reject) => {
    let socket = new WebSocket(url, { origin: 'null', maxPayload: 262144, handshakeTimeout: 10000 })
    let finished = false
    let finish = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); socket.close(); if (error) reject(error); else resolve() }
    let timer = setTimeout(() => finish(new Error('Remote session close timed out')), 15000)
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'signal', to: host.id, envelope: identity.seal(host.id, host.generation, { type: 'close-session', session, request }) }))
    })
    socket.on('message', raw => {
      try {
        let message = JSON.parse(raw.toString())
        if (message.type === 'signal-error' && message.to === host.id) { finish(new Error(message.error)); return }
        if (message.type !== 'signal' || message.from !== host.id) return
        let payload = verify(message.envelope as RemoteEnvelope)
        if (payload.request !== request) return
        if (payload.type === 'session-closed') finish()
        else if (payload.type === 'error') finish(new Error(String(payload.error)))
      } catch { finish(new Error('Invalid remote response')) }
    })
    socket.on('error', () => finish(new Error('Remote connection unavailable')))
    socket.on('close', () => finish(new Error('Remote connection closed')))
  })
}
