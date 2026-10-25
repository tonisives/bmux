import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
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
