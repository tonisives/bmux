import { createHash, randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { createEnvelopeVerifier } from './remote-identity'
import type { remoteIdentity } from './remote-identity'
import type { RemoteEnvelope } from '../shared/remote'
import type { Snapshot } from '../shared/types'
import { createRemotePreviewReceiver } from '../shared/remote-preview'
import type { EncryptedPreview } from '../shared/remote-preview'

type Host = { canClose?: boolean; id: string; generation: string; key: JsonWebKey }
type Identity = ReturnType<typeof remoteIdentity>
type Connect = (key: JsonWebKey) => Promise<{ ticket: string }>
let requestRemote = async (origin: string, host: Host, identity: Identity, connect: Connect, payload: Record<string, unknown>, receive: (payload: Record<string, unknown>) => Promise<boolean>, timeout: string) => {
  let request = randomUUID()
  let { ticket } = await connect(identity.publicKey)
  let url = new URL('/connect', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket)
  let verify = createEnvelopeVerifier(identity.id, host.generation, () => ({ [createHash('sha256').update(host.key.x!).digest('hex')]: host.key as { kty: string; crv: string; x: string } }))
  await new Promise<void>((resolve, reject) => {
    let socket = new WebSocket(url, { origin: 'null', maxPayload: 262144, handshakeTimeout: 10000 })
    let finished = false
    let finish = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); socket.close(); if (error) reject(error); else resolve() }
    let timer = setTimeout(() => finish(new Error(timeout)), 15000)
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'signal', to: host.id, envelope: identity.seal(host.id, host.generation, { ...payload, request }) }))
    })
    let incoming = Promise.resolve()
    socket.on('message', raw => {
      incoming = incoming.then(async () => {
        if (finished) return
        let message = JSON.parse(raw.toString())
        if (message.type === 'signal-error' && message.to === host.id) { finish(new Error(message.error)); return }
        if (message.type !== 'signal' || message.from !== host.id) return
        let payload = verify(message.envelope as RemoteEnvelope)
        if (payload.request !== request) return
        if (payload.type === 'error') finish(new Error(String(payload.error)))
        else if (await receive(payload)) finish()
      }).catch(() => finish(new Error('Invalid remote response')))
    })
    socket.on('error', () => finish(new Error('Remote connection unavailable')))
    socket.on('close', () => finish(new Error('Remote connection closed')))
  })
}
export let requestRemoteSessionClose = async (origin: string, host: Host, session: string, identity: Identity, connect: Connect) => {
  if (!host.canClose) throw new Error('Update this remote host to close sessions')
  await requestRemote(origin, host, identity, connect, { type: 'close-session', session }, async payload => payload.type === 'session-closed', 'Remote session close timed out')
}
export let requestRemoteSessionPreviews = async (origin: string, host: Host, session: string, panes: string[], identity: Identity, connect: Connect): Promise<Record<string, Snapshot>> => {
  let receiver = await createRemotePreviewReceiver(), snapshots: Record<string, Snapshot> = {}
  await requestRemote(origin, host, identity, connect, { type: 'session-previews', session, panes, key: receiver.publicKey }, async payload => {
    if (payload.type === 'session-previews-complete') return true
    if (payload.type !== 'session-preview' || typeof payload.pane !== 'string' || !panes.includes(payload.pane) || snapshots[payload.pane]) throw new Error('Invalid preview pane')
    snapshots[payload.pane] = await receiver.decrypt(payload.preview as EncryptedPreview)
    return false
  }, 'Remote previews timed out')
  return snapshots
}
