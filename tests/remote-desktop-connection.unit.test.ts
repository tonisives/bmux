import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { createRemoteDesktopConnection } from '../src/main/remote-desktop-connection'
import { createRemoteIdentity } from '../src/main/remote-identity'

let sockets = vi.hoisted(() => [] as any[])
vi.mock('ws', async () => {
  let { EventEmitter } = await import('node:events')
  class WebSocket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    sent: any[] = []
    constructor(public url: URL, public options: { origin: string }) { super(); sockets.push(this); queueMicrotask(() => this.emit('open')) }
    send(data: string) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3; this.emit('close') }
  }
  return { WebSocket }
})
beforeEach(() => { sockets.length = 0 })
afterEach(() => { vi.useRealTimers() })
let contents = (id: number) => Object.assign(new EventEmitter(), { id, send: vi.fn(), isDestroyed: () => false }) as unknown as WebContents
it('shares one signaling socket and identity, scopes peer signals and releases each pane separately', async () => {
  let host = { id: 'host', generation: 'generation', service: 'fixture', permission: 'control' as const, key: createRemoteIdentity().publicKey, sessions: [] }
  let identity = createRemoteIdentity()
  let connect = vi.fn(async () => ({ ticket: 'one-use-fixture', iceServers: [] })), group = createRemoteDesktopConnection('https://fixture.test', host, connect, identity)
  let metadata = contents(1), first = contents(2), second = contents(3)
  let firstView = group.attach(metadata, true)
  expect(firstView).toMatch(/^workspace:/)
  expect(group.attach(first, false)).toBe('pane:2')
  group.attach(second, false)
  let result = await Promise.all([group.open(), group.open(), group.open()])
  expect(connect).toHaveBeenCalledOnce()
  expect(sockets).toHaveLength(1)
  expect(sockets[0].options.origin).toBe('file://')
  expect(result.every(value => value.ticket === 'desktop')).toBe(true)
  let envelope = group.seal(first, { type: 'open', view: 'spoofed', pane: 'pane' })
  expect(JSON.parse(envelope.payload)).toMatchObject({ view: 'pane:2', type: 'open' })
  let signal = JSON.stringify({ type: 'signal', to: host.id, envelope })
  expect(() => group.send(second, signal)).toThrow('Invalid remote signal')
  group.send(first, signal)
  sockets[0].emit('message', JSON.stringify({ type: 'hosts', hosts: [host] }))
  expect(group.initial()).toHaveLength(1)
  expect(metadata.send).toHaveBeenCalledWith('remote-client-socket', { type: 'message', data: group.initial()[0] })
  ;(first as unknown as EventEmitter).emit('destroyed')
  expect(JSON.parse(sockets[0].sent.at(-1).envelope.payload)).toEqual({ type: 'close', view: 'pane:2' })
  expect(sockets[0].readyState).toBe(1)
  ;(metadata as unknown as EventEmitter).emit('destroyed')
  expect(sockets[0].readyState).toBe(3)
  await expect(group.open()).rejects.toThrow('Remote view closed')
  let next = createRemoteDesktopConnection('https://fixture.test', host, connect, identity)
  let nextMetadata = contents(4), nextView = next.attach(nextMetadata, true)
  expect(next.publicKey).toEqual(group.publicKey)
  expect(nextView).not.toBe(firstView)
  expect(JSON.parse(next.seal(nextMetadata, { type: 'manage' }).payload).view).toBe(nextView)
  next.close()
})

it('replays the latest relay credentials when a new pane joins after the original credentials expire', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'))
  let host = { id: 'host', generation: 'generation', service: 'fixture', permission: 'control' as const, key: createRemoteIdentity().publicKey, sessions: [] }
  let credentials = () => [{ urls: 'turn:relay.fixture.test:3478', username: `${Math.floor(Date.now() / 1000) + 600}:viewer`, credential: `fixture-${Date.now()}` }]
  let original = credentials(), connect = vi.fn(async () => ({ ticket: 'one-use-fixture', iceServers: original }))
  let group = createRemoteDesktopConnection('https://fixture.test', host, connect), metadata = contents(1)
  group.attach(metadata, true)
  expect(await group.open()).toEqual({ ticket: 'desktop', iceServers: original })
  let hosts = JSON.stringify({ type: 'hosts', hosts: [host] })
  sockets[0].emit('message', hosts)
  let latest = original, ready = ''
  for (let renewal = 0; renewal < 4; renewal++) {
    await vi.advanceTimersByTimeAsync(8 * 60 * 1000)
    latest = credentials()
    ready = JSON.stringify({ type: 'ready', id: 'viewer', iceServers: latest, iceExpiresAt: Date.now() + 600000, streamPermits: true })
    sockets[0].emit('message', ready)
  }
  expect(Number(original[0].username.split(':')[0]) * 1000).toBeLessThan(Date.now())
  let pane = contents(2)
  group.attach(pane, false)
  expect(group.initial()).toEqual([ready, hosts])
  expect(await group.open()).toEqual({ ticket: 'desktop', iceServers: latest })
  expect(connect).toHaveBeenCalledOnce()
  expect(sockets).toHaveLength(1)
  expect(metadata.send).toHaveBeenLastCalledWith('remote-client-socket', { type: 'message', data: ready })
  group.close()
})

it.each(['socket', 'workspace', 'metadata'] as const)('clears cached relay credentials and hosts on %s closure', async closure => {
  let host = { id: 'host', generation: 'generation', service: 'fixture', permission: 'control' as const, key: createRemoteIdentity().publicKey, sessions: [] }
  let iceServers = [{ urls: 'turn:relay.fixture.test:3478', username: 'fixture', credential: 'fixture' }]
  let connect = vi.fn(async () => ({ ticket: 'one-use-fixture', iceServers }))
  let group = createRemoteDesktopConnection('https://fixture.test', host, connect), metadata = contents(1)
  group.attach(metadata, true)
  await group.open()
  let socket = sockets[0], ready = JSON.stringify({ type: 'ready', iceServers })
  socket.emit('message', ready)
  socket.emit('message', JSON.stringify({ type: 'hosts', hosts: [host] }))
  expect(group.initial()).toHaveLength(2)
  if (closure === 'socket') socket.close()
  else {
    vi.spyOn(socket, 'close').mockImplementation(() => { socket.readyState = 2 })
    if (closure === 'workspace') group.close()
    else (metadata as unknown as EventEmitter).emit('destroyed')
  }
  expect(group.initial()).toEqual([])
  socket.emit('message', ready)
  expect(group.initial()).toEqual([])
  if (closure === 'socket') {
    let replacement = [{ urls: 'turn:replacement.fixture.test:3478', username: 'replacement', credential: 'replacement-fixture' }]
    connect.mockResolvedValueOnce({ ticket: 'replacement-fixture', iceServers: replacement })
    expect(await group.open()).toEqual({ ticket: 'desktop', iceServers: replacement })
    expect(connect).toHaveBeenCalledTimes(2)
    expect(group.initial()).toEqual([])
    group.close()
  } else await expect(group.open()).rejects.toThrow('Remote view closed')
})
