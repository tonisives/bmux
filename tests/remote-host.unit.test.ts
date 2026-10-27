import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { remoteIdentity } from '../src/main/remote-identity'
import { startRemoteHost } from '../src/main/remote-host'
import { createRemotePreviewReceiver } from '../src/shared/remote-preview'

type AttentionTarget = ReturnType<Parameters<typeof startRemoteHost>[0]['remote']['attentionHistory']>[number]

let sockets = vi.hoisted(() => [] as { emit: (event: string, data: string) => void; sent: { type: string; envelope?: { payload: string }; request?: string; connection?: string }[] }[])
vi.mock('ws', async () => {
  let { EventEmitter } = await import('node:events')
  class Socket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    sent: { type: string; envelope?: { payload: string }; request?: string; connection?: string }[] = []
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

let setup = (request?: string, open = true, streamPermits = false) => {
  let peer = { answer: vi.fn(), candidate: vi.fn(), send: vi.fn(), close: vi.fn(), quality:vi.fn(async value => value) }
  let resolveCapture!: (value: typeof peer) => void
  let pending = new Promise<typeof peer>(resolve => { resolveCapture = resolve })
  let offer = { type: 'offer' as const, sdp: 'fixture' }
  let signalOffer!: () => void
  let signalCandidate!: (value: RTCIceCandidateInit) => void
  let capture = vi.fn((_pane: string, options: { signal: (sdp: RTCSessionDescriptionInit) => void; candidate?: (value: RTCIceCandidateInit) => void; data: (raw: string) => void; closed: () => void }) => {
    signalOffer = () => options.signal(offer)
    signalCandidate = value => options.candidate?.(value)
    signalOffer()
    return pending
  })
  let runtime = { state: () => ({ automationAgents: { definitions: {} } }), model: { sessions: [{ id: 'session', name: 'main', windows: [{ lastVisitedAt: 123456, panes: [{ id: 'pane', title: 'fixture' }] }] }] }, remote: { capabilities: { management: 1, streamQuality: 1 }, sessionRevision: () => 'fixture-revision', rpc: vi.fn(async (_owner: string, _request: unknown) => ({ profiles: [] })), attentions: vi.fn((): AttentionTarget[] => []), attentionHistory: vi.fn((): AttentionTarget[] => []), capture, manage: vi.fn(async (_options: unknown) => peer), workspace: vi.fn(() => ({ selection: { paneId: 'pane' }, session: { id: 'session', windows: [] }, profiles: [] })), state: vi.fn(() => ({ sessions: [], controls: {}, viewports: {} })), acquire: vi.fn(), renew: vi.fn(), release: vi.fn(), enablePreviews: vi.fn(), previews: vi.fn(async () => ({ pane: { image: 'data:image/jpeg;base64,Zmlyc3Q=', capturedAt: 123456 } })), disconnect: vi.fn(), closeSession: vi.fn(async (_session: string): Promise<{ closed?: string; cancelled?: string }> => ({ closed: 'session' })), closePage: vi.fn(async (_session: string, _pane: string): Promise<{ closed?: string; cancelled?: string }> => ({ closed: 'pane' })) } }
  host = startRemoteHost(runtime as unknown as Parameters<typeof startRemoteHost>[0], directory, path.join(directory, 'remote.json'))
  let viewer = remoteIdentity(path.join(directory, 'viewer.pem'))
  let socket = sockets[0]
  if (streamPermits) socket.emit('message',JSON.stringify({type:'ready',iceServers:[],streamPermits:true}))
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'control', owner: true }))
  let deliver = (payload: unknown) => socket.emit('message', JSON.stringify({ type: 'signal', from: viewer.id, envelope: viewer.seal(host!.status().hostId, host!.status().generation, payload) }))
  let offers = () => socket.sent.filter(message => message.type === 'signal').map(message => JSON.parse(message.envelope!.payload))
  if (open) deliver({ type: 'open', session: 'session', pane: 'pane', request })
  return { peer, resolveCapture, capture, deliver, offers, offer, signalOffer, signalCandidate, runtime, viewer, socket }
}

it('renews TURN credentials on a running host without interrupting its live stream', async () => {
  let { socket, deliver, capture, resolveCapture, peer, offers, runtime } = setup(undefined, false)
  let initial = [{ urls: 'turn:fixture.test', username: 'initial-host', credential: 'initial-credential' }]
  socket.emit('message', JSON.stringify({ type: 'ready', iceServers: initial }))
  deliver({ type: 'open', session: 'session', pane: 'pane' })
  await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce(), { interval: 1 })
  expect(capture).toHaveBeenCalledWith('pane', expect.objectContaining({ iceServers: initial }))
  resolveCapture(peer)
  await vi.waitFor(() => expect(offers()).toHaveLength(1), { interval: 1 })
  let renewed = [{ urls: 'turn:fixture.test', username: 'renewed-host', credential: 'renewed-credential' }]
  socket.emit('message', JSON.stringify({ type: 'ready', iceServers: renewed }))
  expect(peer.close).not.toHaveBeenCalled()
  deliver({ type: 'manage', session: 'session', view: 'workspace' })
  await vi.waitFor(() => expect(runtime.remote.manage).toHaveBeenCalledOnce(), { interval: 1 })
  expect(runtime.remote.manage).toHaveBeenCalledWith(expect.objectContaining({ iceServers: renewed }))
  expect(peer.close).not.toHaveBeenCalled()
})

it('requires a central permit before capture and closes the stream when its permit is revoked', async () => {
  let { socket, capture, resolveCapture, peer, offers } = setup('managed',true,true)
  expect(capture).not.toHaveBeenCalled()
  let acquire = socket.sent.find(message => message.type === 'stream-acquire')!
  socket.emit('message',JSON.stringify({type:'stream-permit',request:acquire.request,expires:Date.now()+20000}))
  await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce(),{interval:1})
  resolveCapture(peer)
  await vi.waitFor(() => expect(socket.sent.some(message => message.type === 'stream-renew')).toBe(true),{interval:1})
  let renew = socket.sent.find(message => message.type === 'stream-renew')!
  expect(offers()).toEqual([])
  socket.emit('message',JSON.stringify({type:'stream-permit',request:renew.request,expires:Date.now()+20000}))
  await vi.waitFor(() => expect(offers()).toHaveLength(1),{interval:1})
  socket.emit('message',JSON.stringify({type:'stream-revoked',connection:acquire.connection}))
  expect(peer.close).toHaveBeenCalledOnce()
  expect(socket.sent.some(message => message.type === 'stream-release' && message.connection === acquire.connection)).toBe(true)
})

it('reports an occupied account without starting video capture', async () => {
  let { socket, capture, offers } = setup('managed',true,true)
  let acquire = socket.sent.find(message => message.type === 'stream-acquire')!
  socket.emit('message',JSON.stringify({type:'stream-permit',request:acquire.request,error:'Both live views are in use. Disconnect a view in Account settings.'}))
  await vi.waitFor(() => expect(offers()).toContainEqual({type:'error',request:'managed',error:'Both live views are in use. Disconnect a view in Account settings.'}),{interval:1})
  expect(capture).not.toHaveBeenCalled()
})

it('closes an advertised session for control access without opening a video stream', async () => {
  let { deliver, offers, runtime, socket } = setup()
  socket.emit('message', JSON.stringify({ type: 'ready', iceServers: [] }))
  expect(socket.sent.find(message => message.type === 'sessions')).toMatchObject({ machine: { name: os.hostname(), platform: process.platform, arch: process.arch }, sessions: [{ id: 'session', name: 'main', lastActivityAt: 123456, canClose: true, canClosePages: true }] })
  deliver({ type: 'close-session', session: 'session', request: 'close-one' })
  await vi.waitFor(() => expect(offers()).toContainEqual({ type: 'session-closed', request: 'close-one' }), { interval: 1 })
  expect(runtime.remote.closeSession).toHaveBeenCalledWith('session')
})

it('closes an individual page without a video stream and rejects watch-only or canceled closes', async () => {
  let { deliver, offers, runtime, viewer, socket, capture } = setup(undefined, false)
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'watch' }))
  deliver({ type: 'close-page', session: 'session', pane: 'pane', request: 'watch' })
  expect(runtime.remote.closePage).not.toHaveBeenCalled()
  expect(offers()).toContainEqual({ type: 'error', request: 'watch', error: 'Watch only access' })
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'control' }))
  runtime.remote.closePage.mockResolvedValueOnce({ cancelled: 'pane' })
  deliver({ type: 'close-page', session: 'session', pane: 'pane', request: 'cancel' })
  await vi.waitFor(() => expect(offers()).toContainEqual({ type: 'error', request: 'cancel', error: 'Page closing canceled' }), { interval: 1 })
  deliver({ type: 'close-page', session: 'session', pane: 'pane', request: 'close' })
  await vi.waitFor(() => expect(offers()).toContainEqual({ type: 'page-closed', request: 'close' }), { interval: 1 })
  expect(runtime.remote.closePage).toHaveBeenLastCalledWith('session', 'pane')
  expect(runtime.remote.closeSession).not.toHaveBeenCalled()
  expect(capture).not.toHaveBeenCalled()
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

it('opens desktop metadata without a media permit and routes independent panes under one viewer lease', async () => {
  let { deliver, offers, runtime, capture, resolveCapture, peer, socket } = setup(undefined, false, true)
  let metadata = { ...peer, close: vi.fn(), send: vi.fn() }
  runtime.remote.manage.mockResolvedValueOnce(metadata)
  deliver({ type: 'manage', session: 'session', view: 'workspace', request: 'metadata' })
  await vi.waitFor(() => expect(runtime.remote.manage).toHaveBeenCalledOnce(), { interval: 1 })
  expect(socket.sent.some(message => message.type === 'stream-acquire')).toBe(false)
  deliver({ type: 'open', session: 'session', pane: 'pane', view: 'pane:2', request: 'media' })
  let acquire = socket.sent.find(message => message.type === 'stream-acquire')!
  socket.emit('message', JSON.stringify({ type: 'stream-permit', request: acquire.request, expires: Date.now() + 20000 }))
  await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce(), { interval: 1 })
  resolveCapture(peer)
  await vi.waitFor(() => expect(socket.sent.some(message => message.type === 'stream-renew')).toBe(true), { interval: 1 })
  let renew = socket.sent.find(message => message.type === 'stream-renew')!
  socket.emit('message', JSON.stringify({ type: 'stream-permit', request: renew.request, expires: Date.now() + 20000 }))
  await vi.waitFor(() => expect(offers()).toContainEqual(expect.objectContaining({ type: 'offer', view: 'pane:2' })), { interval: 1 })
  runtime.remote.disconnect.mockClear()
  deliver({ type: 'close', view: 'pane:2' })
  expect(peer.close).toHaveBeenCalledOnce()
  expect(runtime.remote.disconnect).not.toHaveBeenCalled()
  expect(metadata.close).not.toHaveBeenCalled()
  deliver({ type: 'close', view: 'workspace' })
  expect(metadata.close).toHaveBeenCalledOnce()
  expect(runtime.remote.disconnect).toHaveBeenCalledOnce()
})

it('manages an empty host without acquiring video capacity', async () => {
  let { deliver, runtime, peer, socket, capture, viewer } = setup(undefined, false, true)
  runtime.model.sessions.length = 0
  deliver({ type: 'manage', request: randomUUID() })
  await vi.waitFor(() => expect(runtime.remote.manage).toHaveResolved(), { interval: 1 })
  let data = (runtime.remote.manage.mock.calls[0][0] as { data: (raw: string) => void }).data
  let operation = { type: 'rpc', request: randomUUID(), method: 'profiles.list', params: {} }
  data(JSON.stringify(operation))
  await vi.waitFor(() => expect(runtime.remote.rpc).toHaveBeenCalledWith(viewer.id, operation), { interval: 1 })
  expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'result', request: operation.request, result: { profiles: [] } }))
  expect(capture).not.toHaveBeenCalled()
  expect(socket.sent.some(message => message.type === 'stream-acquire')).toBe(false)
})

it('requires host ownership for management even when a shared viewer can control pages', async () => {
  let { deliver, runtime, peer, socket, viewer, offers } = setup(undefined, false)
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'control', owner: false }))
  let request = randomUUID()
  deliver({ type: 'manage', request })
  expect(offers()).toContainEqual({ type: 'error', request, error: 'OWNER_REQUIRED' })
  expect(runtime.remote.manage).not.toHaveBeenCalled()
  deliver({ type: 'manage', session: 'session', view: 'workspace', request: 'desktop' })
  await vi.waitFor(() => expect(runtime.remote.manage).toHaveResolved(), { interval: 1 })
  let data = (runtime.remote.manage.mock.calls[0][0] as { data: (raw: string) => void }).data
  data(JSON.stringify({ type: 'rpc', request, method: 'profiles.list', params: {} }))
  await vi.waitFor(() => expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'error', request, code: 'OWNER_REQUIRED', error: 'OWNER_REQUIRED', retryable: false })), { interval: 1 })
  expect(runtime.remote.rpc).not.toHaveBeenCalled()
})

it('allows watch viewers to cap their video quality and correlates operation failures', async () => {
  let { capture, resolveCapture, peer, offers, socket, viewer } = setup('media')
  resolveCapture(peer)
  await vi.waitFor(() => expect(offers()).toHaveLength(1), { interval: 1 })
  socket.emit('message', JSON.stringify({ type: 'authorized', id: viewer.id, key: viewer.publicKey, permission: 'watch', owner: false }))
  let data = capture.mock.calls[0][1].data, request = randomUUID()
  data(JSON.stringify({ type: 'quality', request, mode: 'auto', network: 'cellular', maxBitrate: 99999999 }))
  await vi.waitFor(() => expect(peer.quality).toHaveBeenCalledWith(expect.objectContaining({ effective: 'data-saver', maxFps: 5, maxBitrate: 400000 })), { interval: 1 })
  data(JSON.stringify({ type: 'acquire', request, session: 'session' }))
  await vi.waitFor(() => expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ type: 'error', request, code: 'WATCH_ONLY', error: 'Watch only access', retryable: false })), { interval: 1 })
})

it('replays terminal attention history after a restart and after relay reconnect', () => {
  let { socket, runtime } = setup(undefined, false)
  let target: AttentionTarget = { pane: 'pane', session: 'session', episode: 'completed', reason: 'help', createdAt: 1, resolvedAt: 2, revision: 3, status: 'resolved', attempt: { id: randomUUID(), request: randomUUID(), acknowledgedAt: 1, completedAt: 2, revision: 2, outcome: 'verified' } }
  runtime.remote.attentionHistory.mockReturnValue([target])
  let ready = () => socket.emit('message', JSON.stringify({ type: 'ready', iceServers: [] }))
  ready()
  expect(socket.sent.filter(message => message.type === 'attention')).toEqual([{ type: 'attention', ...target }])
  socket.emit('message', JSON.stringify({ type: 'attention-recorded', episode: target.episode, revision: target.revision }))
  ready()
  expect(socket.sent.filter(message => message.type === 'attention')).toHaveLength(2)
})
