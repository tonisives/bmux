import { afterEach, describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import { bitwardenMemoryPort, patchBitwardenMemoryPort } from '../src/main/bitwarden-memory-port'

let event = <T,>() => {
  let listeners = new Set<(value: T) => void>()
  return { addListener: (listener: (value: T) => void) => listeners.add(listener), removeListener: (listener: (value: T) => void) => listeners.delete(listener), emit: (value: T) => { for (let listener of [...listeners]) listener(value) }, listeners }
}
let fixture = (factory = bitwardenMemoryPort) => {
  vi.useFakeTimers()
  let ports: any[] = []
  let sequence = 0
  let connect = vi.fn(() => {
    let port = { onMessage: event<any>(), onDisconnect: event<unknown>(), postMessage: vi.fn(), disconnect: vi.fn() }
    ports.push(port)
    return port
  })
  let initialize = vi.fn(), update = vi.fn()
  let storage = factory({ connect, initialize, update, id: () => String(++sequence) })
  let reply = (port: any, data: unknown, index = 0) => port.onMessage.emit({ ...port.postMessage.mock.calls[index][0], originator: 'background', data: JSON.stringify(data) })
  return { ports, storage, connect, initialize, update, reply }
}
afterEach(() => { vi.useRealTimers() })

describe('Bitwarden memory connection recovery', () => {
  it('reconnects after an idle disconnect and keeps initialization and updates live', async () => {
    let f = fixture(), old = f.ports[0]
    old.onMessage.emit({ originator: 'background', action: 'initialization', data: ['user-key', 'ciphers'] })
    old.onDisconnect.emit(undefined)
    await vi.advanceTimersByTimeAsync(100)
    let port = f.ports[1]
    port.onMessage.emit({ originator: 'background', action: 'initialization', data: ['ciphers'] })
    expect(f.update).toHaveBeenCalledWith({ key: 'user-key', updateType: 'remove' })
    port.onMessage.emit({ originator: 'background', action: 'subject_update', data: { key: 'ciphers', updateType: 'save' } })
    expect(f.update).toHaveBeenLastCalledWith({ key: 'ciphers', updateType: 'save' })
    expect(old.onMessage.listeners.size).toBe(0)
    expect(old.onDisconnect.listeners.size).toBe(0)
    let read = f.storage.request('get', 'ciphers')
    f.reply(port, { count: 705 })
    await expect(read).resolves.toEqual({ count: 705 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries simultaneous reads with their own response IDs when a port throws', async () => {
    let f = fixture()
    f.ports[0].postMessage.mockImplementation(() => { throw new Error('Attempting to use a disconnected port object') })
    let read = f.storage.request('get', 'ciphers')
    let has = f.storage.request('has', 'other')
    let port = f.ports[1]
    f.reply(port, true, 1)
    f.reply(port, { count: 705 })
    await expect(read).resolves.toEqual({ count: 705 })
    await expect(has).resolves.toBe(true)
    await vi.runAllTimersAsync()
    expect(f.connect).toHaveBeenCalledTimes(2)
  })

  it('retries an in-flight read once and rejects interrupted writes without replay', async () => {
    let f = fixture()
    let read = f.storage.request('get', 'ciphers')
    let write = expect(f.storage.request('save', 'key', { fixture: true })).rejects.toThrow('connection was interrupted')
    f.ports[0].onDisconnect.emit(undefined)
    await write
    await vi.advanceTimersByTimeAsync(100)
    expect(f.ports[1].postMessage.mock.calls.map(([message]: any[]) => message.action)).toEqual(['get'])
    f.reply(f.ports[1], [1, 2])
    await expect(read).resolves.toEqual([1, 2])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a silent worker failure without returning an empty vault', async () => {
    let f = fixture()
    let read = expect(f.storage.request('get', 'ciphers')).rejects.toThrow('connection was interrupted')
    await vi.advanceTimersByTimeAsync(10300)
    await read
    await vi.runAllTimersAsync()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects pending reads when the replacement worker cannot start', async () => {
    let f = fixture()
    let read = expect(f.storage.request('get', 'ciphers')).rejects.toThrow('connection was interrupted')
    f.connect.mockImplementation(() => { throw new Error('worker unavailable') })
    f.ports[0].onDisconnect.emit(undefined)
    await vi.runAllTimersAsync()
    await read
    expect(f.connect).toHaveBeenCalledTimes(4)
  })

  it('ignores responses from untrusted senders and clears malformed responses', async () => {
    let f = fixture()
    let read = expect(f.storage.request('get', 'ciphers')).rejects.toThrow('connection was interrupted')
    let message = f.ports[0].postMessage.mock.calls[0][0]
    f.ports[0].onMessage.emit({ ...message, originator: 'foreground', data: '[]' })
    expect(vi.getTimerCount()).toBe(1)
    f.ports[0].onMessage.emit({ ...message, originator: 'background', data: 'invalid' })
    await read
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps separate partitions isolated and runs serialized without module globals', async () => {
    let factory = vm.runInNewContext(`(${bitwardenMemoryPort.toString()})`, { setTimeout, clearTimeout })
    let a = fixture(factory), b = fixture(factory)
    let readA = a.storage.request('get', 'same-key'), readB = b.storage.request('get', 'same-key')
    a.reply(a.ports[0], 1)
    b.reply(b.ports[0], 2)
    await expect(readA).resolves.toBe(1)
    await expect(readB).resolves.toBe(2)
  })

  it('fails closed if an official popup changes and leaves patched packages alone', () => {
    expect(() => patchBitwardenMemoryPort('changed upstream bundle', '2026.6.1')).toThrow('compatibility target was not found')
    expect(patchBitwardenMemoryPort('/* bmux-reconnecting-memory-port */', '2026.6.1')).toBe('/* bmux-reconnecting-memory-port */')
  })
})
