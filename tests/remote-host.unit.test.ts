import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { remoteIdentity } from '../src/main/remote-identity'
import { startRemoteHost } from '../src/main/remote-host'
import { createRemotePreviewReceiver } from '../src/shared/remote-preview'

let sockets = vi.hoisted(() => [] as { emit: (event: string, data: string) => void; sent: { type: string; envelope?: { payload: string } }[] }[])
vi.mock('ws', async () => {
  let { EventEmitter } = await import('node:events')
  class Socket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    sent: { type: string; envelope?: { payload: string } }[] = []
    constructor() { super(); sockets.push(this) }
    send(data: string, done?: () => void) { this.sent.push(JSON.parse(data)); done?.() }
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

let setup = (request?: string, open = true) => {
  let peer = { answer: vi.fn(), candidate: vi.fn(), send: vi.fn(), close: vi.fn() }
  let resolveCapture!: (value: typeof peer) => void
  let pending = new Promise<typeof peer>(resolve => { resolveCapture = resolve })
  let offer = { type: 'offer' as const, sdp: 'fixture' }
  let signalOffer!: () => void
  let signalCandidate!: (value: RTCIceCandidateInit) => void
  let capture = vi.fn((_pane: string, options: { signal: (sdp: RTCSessionDescriptionInit) => void; candidate?: (value: RTCIceCandidateInit) => void }) => {
    signalOffer = () => options.signal(offer)
    signalCandidate = value => options.candidate?.(value)
    signalOffer()
    return pending
  })
  let runtime = { state: () => ({ automationAgents: { definitions: {} } }), model: { sessions: [{ id: 'session', name: 'main', windows: [{ lastVisitedAt: 123456, panes: [{ id: 'pane', title: 'fixture' }] }] }] }, remote: { capture, enablePreviews: vi.fn(), previews: vi.fn(async () => ({ pane: { image: 'data:image/jpeg;base64,Zmlyc3Q=', capturedAt: 123456 } })), disconnect: vi.fn(), closeSession: vi.fn(async (_session: string): Promise<{ closed?: string; cancelled?: string }> => ({ closed: 'session' })) } }
  host = startRemoteHost(runtime as unknown as Parameters<typeof startRemoteHost>[0], directory, path.join(directory, 'remote.json'))
  let viewer = remoteIdentity(path.join(directory, 'viewer.pem'))
  let socket = sockets[0]
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'control' }))
  let deliver = (payload: unknown) => socket.emit('message', JSON.stringify({ type: 'signal', from: viewer.id, envelope: viewer.seal(host!.status().hostId, host!.status().generation, payload) }))
  let offers = () => socket.sent.filter(message => message.type === 'signal').map(message => JSON.parse(message.envelope!.payload))
  if (open) deliver({ type: 'open', session: 'session', pane: 'pane', request })
  return { peer, resolveCapture, capture, deliver, offers, offer, signalOffer, signalCandidate, runtime, viewer, socket }
}

it('closes an advertised session for control access without opening a video stream', async () => {
  let { deliver, offers, runtime, socket } = setup()
  socket.emit('message', JSON.stringify({ type: 'ready', iceServers: [] }))
  expect(socket.sent.find(message => message.type === 'sessions')).toMatchObject({ sessions: [{ id: 'session', name: 'main', lastActivityAt: 123456, canClose: true }] })
  deliver({ type: 'close-session', session: 'session', request: 'close-one' })
  await vi.waitFor(() => expect(offers()).toContainEqual({ type: 'session-closed', request: 'close-one' }), { interval: 1 })
  expect(runtime.remote.closeSession).toHaveBeenCalledWith('session')
})

it('shares encrypted host screenshots with watch access without opening a stream or updating activity', async () => {
  let { deliver, offers, runtime, viewer, socket, capture } = setup(undefined, false)
  let receiver = await createRemotePreviewReceiver()
  runtime.model.sessions[0].windows[0].panes.push({ id: 'newPane', title: 'Created after listing' })
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'watch' }))
  runtime.remote.previews.mockResolvedValueOnce({ pane: { image: 'data:image/jpeg;base64,Zmlyc3Q=', capturedAt: 123456 }, newPane: { image: 'data:image/jpeg;base64,bmV3', capturedAt: 123457 } } as Awaited<ReturnType<typeof runtime.remote.previews>>)
  deliver({ type: 'session-previews', session: 'session', panes: ['pane'], request: 'preview', key: receiver.publicKey })
  await vi.waitFor(() => expect(offers()).toContainEqual({ type: 'session-previews-complete', request: 'preview' }), { interval: 1 })
  expect(await receiver.decrypt(offers()[0].preview)).toEqual({ image: 'data:image/jpeg;base64,Zmlyc3Q=', capturedAt: 123456 })
  expect(offers()).toHaveLength(2)
  expect(runtime.remote.enablePreviews).toHaveBeenCalledOnce()
  expect(runtime.remote.previews).toHaveBeenCalledWith('session')
  expect(capture).not.toHaveBeenCalled()
  expect(runtime.model.sessions[0].windows[0].lastVisitedAt).toBe(123456)
  socket.emit('message', JSON.stringify({ type: 'revoked', id: viewer.id }))
  deliver({ type: 'session-previews', session: 'session', panes: ['pane'], request: 'revoked', key: receiver.publicKey })
  expect(runtime.remote.previews).toHaveBeenCalledOnce()
})

it('drops captured previews when access is revoked while the host is capturing', async () => {
  let { deliver, offers, runtime, viewer, socket } = setup(undefined, false)
  let receiver = await createRemotePreviewReceiver(), resolve!: (value: Awaited<ReturnType<typeof runtime.remote.previews>>) => void
  runtime.remote.previews.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  deliver({ type: 'session-previews', session: 'session', panes: ['pane'], request: 'preview', key: receiver.publicKey })
  socket.emit('message', JSON.stringify({ type: 'revoked', id: viewer.id }))
  resolve({ pane: { image: 'data:image/jpeg;base64,Zmlyc3Q=', capturedAt: 123456 } })
  await vi.waitFor(() => expect(runtime.remote.previews).toHaveResolved(), { interval: 1 })
  expect(offers()).toEqual([])
})

it('rejects closing for watch access and reports a canceled host close', async () => {
  let { deliver, offers, runtime, viewer, socket } = setup()
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'watch' }))
  deliver({ type: 'close-session', session: 'session', request: 'watch-close' })
  expect(runtime.remote.closeSession).not.toHaveBeenCalled()
  expect(offers()).toContainEqual({ type: 'error', request: 'watch-close', error: 'Watch only access' })
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'control' }))
  runtime.remote.closeSession.mockResolvedValueOnce({ cancelled: 'session' })
  deliver({ type: 'close-session', session: 'session', request: 'canceled-close' })
  await vi.waitFor(() => expect(offers()).toContainEqual({ type: 'error', request: 'canceled-close', error: 'Session closing canceled' }), { interval: 1 })
})

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

it('buffers candidates until registration and routes only the current connection answer and candidates', async () => {
  let request = 'fixture watch', { peer, resolveCapture, deliver, offers, signalCandidate } = setup(request)
  let candidate = { candidate: 'fixture candidate', sdpMid: '0' }
  signalCandidate(candidate)
  expect(offers()).toEqual([])
  resolveCapture(peer)
  await vi.waitFor(() => expect(offers()).toHaveLength(2), { interval: 1 })
  let [offer, update] = offers()
  expect(offer).toMatchObject({ type: 'offer', request, trickle: true })
  expect(update).toEqual({ type: 'candidate', candidate, request, connection: offer.connection })
  let answer = { type: 'answer', sdp: 'fixture answer' }
  deliver({ type: 'answer', sdp: answer, request, connection: 'obsolete' })
  deliver({ type: 'candidate', candidate, request: 'obsolete', connection: offer.connection })
  expect(peer.answer).not.toHaveBeenCalled()
  expect(peer.candidate).not.toHaveBeenCalled()
  deliver({ type: 'answer', sdp: answer, request, connection: offer.connection })
  deliver({ type: 'candidate', candidate, request, connection: offer.connection })
  expect(peer.answer).toHaveBeenCalledWith(answer)
  expect(peer.candidate).toHaveBeenCalledWith(candidate)
})

it('advertises agent use newer than a window visit', () => {
  let { socket, runtime } = setup()
  Object.assign(runtime.model.sessions[0], { lastActivityAt: 234567 })
  socket.emit('message', JSON.stringify({ type: 'ready', iceServers: [] }))
  expect(socket.sent.find(message => message.type === 'sessions')).toMatchObject({ sessions: [{ lastActivityAt: 234567, canClose: true }] })
})

it('advertises typed pane descriptions and field labels without terminal origins or commands', () => {
  let { socket, runtime } = setup()
  Object.assign(runtime.model.sessions[0].windows[0].panes[0], { agentId: 'researcher', agentName: 'Research', agentPurpose: 'Checking source links', agentType: 'scraper', agentData: { task: 'Article discovery' }, agentOrigin: { type: 'tmux', paneId: '%1', panePid: '123' } })
  runtime.state = () => ({ automationAgents: { definitions: { scraper: { fields: { task: { label: 'Current task' } }, focusCommand: 'local-only' } } } })
  socket.emit('message', JSON.stringify({ type: 'ready', iceServers: [] }))
  let advertised = socket.sent.find(message => message.type === 'sessions') as unknown as { sessions: { private: boolean; panes: Record<string, unknown>[] }[] }
  expect(advertised.sessions[0].private).toBe(false)
  expect(advertised.sessions[0].panes[0]).toEqual({ id: 'pane', title: 'fixture', agentId: 'researcher', agentName: 'Research', agentPurpose: 'Checking source links', agentType: 'scraper', agentData: { task: 'Article discovery' }, agentFields: { task: 'Current task' } })
})
