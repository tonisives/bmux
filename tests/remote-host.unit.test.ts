import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { remoteIdentity } from '../src/main/remote-identity'
import { startRemoteHost } from '../src/main/remote-host'

let sockets = vi.hoisted(() => [] as { emit: (event: string, data: string) => void; sent: { type: string; envelope?: { payload: string } }[] }[])
vi.mock('ws', async () => {
  let { EventEmitter } = await import('node:events')
  class Socket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    sent: { type: string; envelope?: { payload: string } }[] = []
    constructor() { super(); sockets.push(this) }
    send(data: string) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3 }
  }
  return { WebSocket: Socket }
})

let directory: string
let host: ReturnType<typeof startRemoteHost> | undefined
beforeEach(async () => {
  sockets.length = 0
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-host-unit-'))
  await fs.writeFile(path.join(directory, 'remote.json'), JSON.stringify({ url: 'http://127.0.0.1:18889', token: 'fixture' }), { mode: 0o600 })
})
afterEach(async () => { host?.close(); host = undefined; await fs.rm(directory, { recursive: true, force: true }) })

let setup = () => {
  let peer = { answer: vi.fn(), send: vi.fn(), close: vi.fn() }
  let resolveCapture!: (value: typeof peer) => void
  let pending = new Promise<typeof peer>(resolve => { resolveCapture = resolve })
  let offer = { type: 'offer' as const, sdp: 'fixture' }
  let signalOffer!: () => void
  let capture = vi.fn((_pane: string, options: { signal: (sdp: RTCSessionDescriptionInit) => void }) => {
    signalOffer = () => options.signal(offer)
    signalOffer()
    return pending
  })
  let runtime = { model: { sessions: [{ id: 'session', name: 'main', windows: [{ panes: [{ id: 'pane', title: 'fixture' }] }] }] }, remote: { capture, disconnect: vi.fn() } }
  host = startRemoteHost(runtime as unknown as Parameters<typeof startRemoteHost>[0], directory, path.join(directory, 'remote.json'))
  let viewer = remoteIdentity(path.join(directory, 'viewer.pem'))
  let socket = sockets[0]
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'control' }))
  let deliver = (payload: unknown) => socket.emit('message', JSON.stringify({ type: 'signal', from: viewer.id, envelope: viewer.seal(host!.status().hostId, host!.status().generation, payload) }))
  let offers = () => socket.sent.filter(message => message.type === 'signal').map(message => JSON.parse(message.envelope!.payload))
  deliver({ type: 'open', session: 'session', pane: 'pane' })
  return { peer, resolveCapture, capture, deliver, offers, offer, signalOffer }
}

it('registers an opening stream before publishing its offer so a fast answer reaches it', async () => {
  let { peer, resolveCapture, capture, deliver, offers, offer } = setup()
  expect(capture).toHaveBeenCalledOnce()
  expect(offers()).toEqual([])
  resolveCapture(peer)
  await vi.waitFor(() => expect(offers()).toEqual([{ type: 'offer', sdp: offer }]), { interval: 1 })
  let answer = { type: 'answer', sdp: 'fixture answer' }
  deliver({ type: 'answer', sdp: answer })
  expect(peer.answer).toHaveBeenCalledWith(answer)
})

it('does not publish an opening stream offer after the viewer disconnects', async () => {
  let { peer, resolveCapture, deliver, offers, signalOffer } = setup()
  deliver({ type: 'close' })
  signalOffer()
  resolveCapture(peer)
  await vi.waitFor(() => expect(peer.close).toHaveBeenCalledOnce(), { interval: 1 })
  expect(offers()).toEqual([])
})
