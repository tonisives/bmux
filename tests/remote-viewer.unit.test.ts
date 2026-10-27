import { afterEach, expect, it, vi } from 'vitest'
import { createViewer } from '../remote/web/client'
import type { Host, ViewerEvents, ViewerIdentity } from '../remote/web/client'

let fixture = async (view?: string) => {
  let socket = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onopen: undefined as (() => void) | undefined, onmessage: undefined as ((event: { data: string }) => void) | undefined }
  let channel = { readyState: 'open', bufferedAmount: 0, send: vi.fn(), onopen: undefined as (() => void) | undefined, onmessage: undefined as ((event: { data: string }) => void) | undefined }
  let peer = { close: vi.fn(), connectionState: 'connected', onconnectionstatechange: undefined as (() => void) | undefined, remoteDescription: undefined as unknown, localDescription: { toJSON: () => ({ type: 'answer', sdp: 'answer' }) }, iceGatheringState: 'complete', ondatachannel: undefined as ((event: { channel: unknown }) => void) | undefined, setRemoteDescription: vi.fn(async (value: unknown) => { peer.remoteDescription = value }), setLocalDescription: vi.fn(async () => {}), createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'answer' })), addIceCandidate: vi.fn() }
  let events: ViewerEvents = { hosts: vi.fn(), state: vi.fn(), stream: vi.fn(), error: vi.fn(), disconnected: vi.fn(), message: vi.fn() }
  let identity: ViewerIdentity = { publicKey: { x: 'viewer' }, fingerprint: async key => key.x!, sign: vi.fn(async () => 'signature'), verify: vi.fn(async () => true) }
  let observe = vi.fn(() => vi.fn())
  let createPeer = vi.fn((_configuration: RTCConfiguration) => peer as unknown as RTCPeerConnection)
  let promise = createViewer(events, { view, origin: 'https://fixture.test', identity, connect: async () => ({ ticket: 'one-use-ticket', iceServers: [] }), socket: () => socket as unknown as WebSocket, peer: createPeer, uuid: () => 'fixture-request-12345', observe })
  await vi.waitFor(() => expect(socket.onopen).toBeTypeOf('function'))
  socket.onopen!()
  let viewer = await promise
  let host: Host = { id: 'host', generation: 'runtime', service: 'Computer', key: { x: 'host' }, permission: 'control', sessions: [{ id: 'session', name: 'Work', panes: [{ id: 'pane', title: 'Page' }] }] }
  let receive = (payload: unknown) => socket.onmessage!({ data: JSON.stringify({ type: 'signal', from: host.id, envelope: { version: 1, from: host.id, to: viewer.id, generation: host.generation, nonce: crypto.randomUUID(), expires: Date.now() + 30000, payload: JSON.stringify(payload), signature: 'host signature' } }) })
  return { socket, channel, peer, events, viewer, host, receive, identity, observe, createPeer }
}
afterEach(() => vi.useRealTimers())

let watchingFixture = async () => {
  let value = await fixture(), watching = value.viewer.watch(value.host, 'session', 'pane')
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalled())
  value.receive({ type: 'offer', sdp: { type: 'offer', sdp: 'offer' } })
  await vi.waitFor(() => expect(value.peer.ondatachannel).toBeTypeOf('function'))
  value.peer.ondatachannel!({ channel: value.channel })
  value.channel.onmessage!({ data: JSON.stringify({ type: 'state', pane: 'pane', viewports: {}, sessions: [], controls: {} }) })
  await watching
  return value
}

it('keeps the viewer connected when its video connection recovers from a brief interruption', async () => {
  let value = await watchingFixture()
  vi.useFakeTimers()
  value.peer.connectionState = 'disconnected'; value.peer.onconnectionstatechange!()
  await vi.advanceTimersByTimeAsync(4000)
  expect(value.events.disconnected).not.toHaveBeenCalled()
  value.peer.connectionState = 'connected'; value.peer.onconnectionstatechange!()
  await vi.advanceTimersByTimeAsync(6000)
  expect(value.events.disconnected).not.toHaveBeenCalled()
  expect(value.viewer.send({ type: 'renew', session: 'session', generation: 1 })).toBe(true)
  value.viewer.close()
})

it('uses renewed TURN credentials for the next stream without closing the current stream', async () => {
  let value = await watchingFixture()
  vi.useFakeTimers()
  await vi.advanceTimersByTimeAsync(17 * 60 * 60 * 1000)
  let iceServers = [{ urls: ['turn:fixture.test'], username: 'renewed-viewer', credential: 'renewed-credential' }]
  value.socket.onmessage!({ data: JSON.stringify({ type: 'ready', id: value.viewer.id, iceServers, streamPermits: true }) })
  await vi.advanceTimersByTimeAsync(0)
  expect(value.peer.close).not.toHaveBeenCalled()
  expect(value.events.disconnected).not.toHaveBeenCalled()
  let watching = value.viewer.watch(value.host, 'session', 'pane')
  await vi.advanceTimersByTimeAsync(0)
  value.receive({ type: 'offer', sdp: { type: 'offer', sdp: 'next-offer' } })
  await vi.advanceTimersByTimeAsync(0)
  expect(value.createPeer).toHaveBeenLastCalledWith({ iceServers })
  value.peer.ondatachannel!({ channel: value.channel })
  value.channel.onmessage!({ data: JSON.stringify({ type: 'state', pane: 'pane', viewports: {}, sessions: [], controls: {} }) })
  await watching
  value.viewer.close()
})

it('reports a sustained connection loss once even if the host disconnects too', async () => {
  let value = await watchingFixture()
  vi.useFakeTimers()
  value.peer.connectionState = 'disconnected'; value.peer.onconnectionstatechange!()
  await vi.advanceTimersByTimeAsync(5000)
  expect(value.events.disconnected).toHaveBeenCalledOnce()
  value.socket.onmessage!({ data: JSON.stringify({ type: 'disconnected', id: value.host.id }) })
  await vi.advanceTimersByTimeAsync(0)
  expect(value.events.disconnected).toHaveBeenCalledOnce()
  value.viewer.close()
})

it('reports a failed connection immediately and cancels delayed disconnects when stopped', async () => {
  let value = await watchingFixture()
  vi.useFakeTimers()
  value.peer.connectionState = 'failed'; value.peer.onconnectionstatechange!()
  expect(value.events.disconnected).toHaveBeenCalledOnce()
  value.peer.connectionState = 'disconnected'; value.peer.onconnectionstatechange!()
  value.viewer.stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(value.events.disconnected).toHaveBeenCalledOnce()
  value.viewer.close()
})
it('creates a native-adapted viewer without browser storage, DOM or browser crypto', async () => {
  let value = await fixture()
  expect(value.viewer.id).toBe('viewer')
  expect(value.observe).toHaveBeenCalledOnce()
  expect(value.viewer.send({ type: 'input' })).toBe(false)
  value.viewer.close()
  expect(value.socket.close).toHaveBeenCalledOnce()
})
it('opens in watch and forwards correlated host acknowledgements without synthesizing resume', async () => {
  let value = await fixture()
  let watching = value.viewer.watch(value.host, 'session', 'pane')
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalled())
  let open = JSON.parse(JSON.parse(value.socket.send.mock.calls[0][0]).envelope.payload)
  expect(open).toMatchObject({ type: 'open', session: 'session', pane: 'pane' })
  value.receive({ type: 'offer', request: open.request, connection: 'connection', trickle: true, sdp: { type: 'offer', sdp: 'offer' } })
  await vi.waitFor(() => expect(value.peer.ondatachannel).toBeTypeOf('function'))
  value.peer.ondatachannel!({ channel: value.channel })
  value.channel.onopen!()
  expect(value.channel.send).toHaveBeenCalledWith('{"type":"state"}')
  let state = { type: 'state', pane: 'pane', viewports: {}, sessions: [], controls: {}, attention: [] }
  value.channel.onmessage!({ data: JSON.stringify(state) })
  await watching
  expect(value.events.state).toHaveBeenCalledWith(state)
  value.channel.onmessage!({ data: JSON.stringify({ type: 'result', request: 'resume-request', result: { resumed: true } }) })
  expect(value.events.message).toHaveBeenCalledWith({ type: 'result', request: 'resume-request', result: { resumed: true } })
  expect(value.channel.send.mock.calls.flat().some(value => value.includes('"type":"resume"'))).toBe(false)
  value.viewer.close()
})
it('rejects a host response whose signature does not verify', async () => {
  let value = await fixture()
  vi.mocked(value.identity.verify).mockResolvedValue(false)
  let watching = value.viewer.watch(value.host, 'session', 'pane').catch(error => error.message)
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalled())
  value.receive({ type: 'offer', sdp: { type: 'offer', sdp: 'offer' } })
  expect(await watching).toBe('Invalid host signature')
  expect(value.peer.setRemoteDescription).not.toHaveBeenCalled()
  value.viewer.close()
})
it('opens management without a pane or live-view subscription and uses its encrypted channel', async () => {
  let value = await fixture()
  let managing = value.viewer.manage(value.host)
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalled())
  let message = JSON.parse(JSON.parse(value.socket.send.mock.calls[0][0]).envelope.payload)
  expect(message).toEqual({ type: 'manage', request: 'fixture-request-12345' })
  value.receive({ type: 'offer', request: message.request, connection: 'management', trickle: true, sdp: { type: 'offer', sdp: 'offer' } })
  await vi.waitFor(() => expect(value.peer.ondatachannel).toBeTypeOf('function'))
  value.peer.ondatachannel!({ channel: value.channel })
  await managing
  expect(value.channel.send).not.toHaveBeenCalled()
  expect(value.viewer.send({ type: 'rpc', request: 'profile-read', method: 'profiles.list', params: {} })).toBe(true)
  value.channel.onmessage!({ data: JSON.stringify({ type: 'result', request: 'profile-read', result: { profiles: [] } }) })
  expect(value.events.message).toHaveBeenCalledWith({ type: 'result', request: 'profile-read', result: { profiles: [] } })
  expect(value.events.state).not.toHaveBeenCalled()
  value.viewer.close()
})
it('finishes a signed close before sending the next management request', async () => {
  let value = await fixture()
  let watching = value.viewer.watch(value.host, 'session', 'pane').catch(() => {})
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalledTimes(1))
  let resolve!: (value: string) => void
  vi.mocked(value.identity.sign).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  value.viewer.stop()
  let managing = value.viewer.manage(value.host).catch(() => {})
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  expect(value.socket.send).toHaveBeenCalledTimes(1)
  resolve('close-signature')
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalledTimes(3))
  expect(value.socket.send.mock.calls.map(([message]) => JSON.parse(JSON.parse(message).envelope.payload).type)).toEqual(['open', 'close', 'manage'])
  value.viewer.close()
  await Promise.all([watching, managing])
})
it('does not reopen a superseded pane when a signed close finishes late', async () => {
  let value = await fixture()
  let first = value.viewer.watch(value.host, 'session', 'pane').catch(() => {})
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalledTimes(1))
  let finishClose!: (signature: string) => void
  vi.mocked(value.identity.sign).mockImplementationOnce(() => new Promise(resolve => { finishClose = resolve }))
  let superseded = value.viewer.watch(value.host, 'session', 'old-pane').catch(error => error.message)
  await vi.waitFor(() => expect(finishClose).toBeTypeOf('function'))
  value.viewer.stop()
  let current = value.viewer.manage(value.host).catch(() => {})
  finishClose('signature')
  expect(await superseded).toBe('Connection replaced')
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalledTimes(4))
  let messages = value.socket.send.mock.calls.map(([message]) => JSON.parse(JSON.parse(message).envelope.payload))
  expect(messages.map(item => item.type)).toEqual(['open', 'close', 'close', 'manage'])
  expect(messages.some(item => item.pane === 'old-pane')).toBe(false)
  value.viewer.close()
  await Promise.all([first, current])
})

it('isolates signed peer offers and forwards workspace metadata without opening a media subscription', async () => {
  let value = await fixture('workspace')
  let managing = value.viewer.manage(value.host, 'session')
  await vi.waitFor(() => expect(value.socket.send).toHaveBeenCalledOnce())
  let request = JSON.parse(JSON.parse(value.socket.send.mock.calls[0][0]).envelope.payload)
  expect(request).toMatchObject({ type: 'manage', session: 'session', view: 'workspace' })
  value.receive({ type: 'offer', view: 'pane:2', sdp: { type: 'offer', sdp: 'wrong-peer' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(value.peer.setRemoteDescription).not.toHaveBeenCalled()
  value.receive({ type: 'offer', view: 'workspace', sdp: { type: 'offer', sdp: 'metadata' } })
  await vi.waitFor(() => expect(value.peer.ondatachannel).toBeTypeOf('function'))
  value.peer.ondatachannel!({ channel: value.channel })
  value.channel.onopen!()
  await managing
  expect(value.channel.send).toHaveBeenCalledWith('{"type":"state"}')
  let state = { type: 'state', pane: 'pane', sessions: [], controls: {}, viewports: {}, workspace: { session: { id: 'session', windows: [] }, profiles: [] } }
  value.channel.onmessage!({ data: JSON.stringify(state) })
  expect(value.events.state).toHaveBeenCalledWith(state)
  value.viewer.close()
})
