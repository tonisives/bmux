import { expect, it, vi } from 'vitest'
import { createViewer } from '../remote/web/client'
import type { Host, ViewerEvents, ViewerIdentity } from '../remote/web/client'

let fixture = async () => {
  let socket = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onopen: undefined as (() => void) | undefined, onmessage: undefined as ((event: { data: string }) => void) | undefined }
  let channel = { readyState: 'open', bufferedAmount: 0, send: vi.fn(), onopen: undefined as (() => void) | undefined, onmessage: undefined as ((event: { data: string }) => void) | undefined }
  let peer = { close: vi.fn(), remoteDescription: undefined as unknown, localDescription: { toJSON: () => ({ type: 'answer', sdp: 'answer' }) }, iceGatheringState: 'complete', ondatachannel: undefined as ((event: { channel: unknown }) => void) | undefined, setRemoteDescription: vi.fn(async (value: unknown) => { peer.remoteDescription = value }), setLocalDescription: vi.fn(async () => {}), createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'answer' })), addIceCandidate: vi.fn() }
  let events: ViewerEvents = { hosts: vi.fn(), state: vi.fn(), stream: vi.fn(), error: vi.fn(), disconnected: vi.fn(), message: vi.fn() }
  let identity: ViewerIdentity = { publicKey: { x: 'viewer' }, fingerprint: async key => key.x!, sign: vi.fn(async () => 'signature'), verify: vi.fn(async () => true) }
  let observe = vi.fn(() => vi.fn())
  let promise = createViewer(events, { origin: 'https://fixture.test', identity, connect: async () => ({ ticket: 'one-use-ticket', iceServers: [] }), socket: () => socket as unknown as WebSocket, peer: () => peer as unknown as RTCPeerConnection, uuid: () => 'fixture-request-12345', observe })
  await vi.waitFor(() => expect(socket.onopen).toBeTypeOf('function'))
  socket.onopen!()
  let viewer = await promise
  let host: Host = { id: 'host', generation: 'runtime', service: 'Computer', key: { x: 'host' }, permission: 'control', sessions: [{ id: 'session', name: 'Work', panes: [{ id: 'pane', title: 'Page' }] }] }
  let receive = (payload: unknown) => socket.onmessage!({ data: JSON.stringify({ type: 'signal', from: host.id, envelope: { version: 1, from: host.id, to: viewer.id, generation: host.generation, nonce: crypto.randomUUID(), expires: Date.now() + 30000, payload: JSON.stringify(payload), signature: 'host signature' } }) })
  return { socket, channel, peer, events, viewer, host, receive, identity, observe }
}
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
