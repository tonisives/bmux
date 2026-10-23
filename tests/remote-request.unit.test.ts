import { afterEach, beforeEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { WebSocketServer } from 'ws'
import { createEnvelopeVerifier, remoteIdentity } from '../src/main/remote-identity'
import { requestRemoteSessionClose, requestRemoteSessionPreviews } from '../src/main/remote-request'
import { encryptRemotePreview } from '../src/shared/remote-preview'

let directory: string, server: WebSocketServer
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-request-'))
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => server.once('listening', resolve))
})
afterEach(async () => {
  for (let client of server.clients) client.terminate()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
})

let close = (reply: 'session-closed' | 'error' | 'forged') => {
  let host = remoteIdentity(path.join(directory, 'host.pem'))
  let key: JsonWebKey
  server.on('connection', socket => socket.on('message', raw => {
    let message = JSON.parse(raw.toString())
    let verify = createEnvelopeVerifier('host', 'generation', () => ({ [message.envelope.from]: key as { kty: string; crv: string; x: string } }))
    let payload = verify(message.envelope)
    expect(payload).toMatchObject({ type: 'close-session', session: 'session' })
    let response = host.seal(message.envelope.from, 'generation', { type: reply === 'error' ? 'error' : 'session-closed', request: payload.request, error: 'Watch only access' })
    if (reply === 'forged') response.signature = 'invalid'
    socket.send(JSON.stringify({ type: 'signal', from: 'host', envelope: response }))
  }))
  return requestRemoteSessionClose(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { id: 'host', generation: 'generation', key: host.publicKey, canClose: true }, 'session', remoteIdentity(path.join(directory, 'viewer.pem')), async publicKey => { key = publicKey; return { ticket: 'fixture' } })
}
it('sends a signed close request and waits for the authenticated host acknowledgement', async () => { await expect(close('session-closed')).resolves.toBeUndefined() })
it('returns a host rejection to the caller', async () => { await expect(close('error')).rejects.toThrow('Watch only access') })
it('rejects a forged close acknowledgement', async () => { await expect(close('forged')).rejects.toThrow('Invalid remote response') })

it('rejects an older host before creating a connection instead of timing out', async () => {
  let identity = remoteIdentity(path.join(directory, 'viewer.pem'))
  let connected = false
  await expect(requestRemoteSessionClose('http://127.0.0.1:18889', { id: 'host', generation: 'generation', key: identity.publicKey }, 'session', identity, async () => { connected = true; return { ticket: 'unused' } })).rejects.toThrow('Update this remote host to close sessions')
  expect(connected).toBe(false)
})

it('fetches separately encrypted pane previews over signed requests', async () => {
  let host = remoteIdentity(path.join(directory, 'host.pem')), viewer = remoteIdentity(path.join(directory, 'viewer.pem'))
  let snapshots = { one: { image: 'data:image/jpeg;base64,b25l', capturedAt: 123456 }, two: { image: 'data:image/jpeg;base64,dHdv', capturedAt: 123457 } }
  server.on('connection', socket => socket.on('message', raw => {
    void (async () => {
      let message = JSON.parse(raw.toString()), payload = createEnvelopeVerifier('host', 'generation', () => ({ [viewer.id]: viewer.publicKey as { kty: string; crv: string; x: string } }))(message.envelope)
      expect(payload).toMatchObject({ type: 'session-previews', session: 'session' })
      for (let [pane, snapshot] of Object.entries(snapshots)) {
        let preview = await encryptRemotePreview(payload.key as JsonWebKey, snapshot)
        socket.send(JSON.stringify({ type: 'signal', from: 'host', envelope: host.seal(viewer.id, 'generation', { type: 'session-preview', request: payload.request, pane, preview }) }))
      }
      socket.send(JSON.stringify({ type: 'signal', from: 'host', envelope: host.seal(viewer.id, 'generation', { type: 'session-previews-complete', request: payload.request }) }))
    })()
  }))
  await expect(requestRemoteSessionPreviews(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { id: 'host', generation: 'generation', key: host.publicKey }, 'session', ['one', 'two'], viewer, async () => ({ ticket: 'fixture' }))).resolves.toEqual(snapshots)
})
