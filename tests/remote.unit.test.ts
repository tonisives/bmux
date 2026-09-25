import { describe, expect, it } from 'vitest'
import { createControlLeases, validEnvelope } from '../src/shared/remote'

describe('human control leases', () => {
  it('rejects competing input, invalidates takeover, and expires disconnected owners', () => {
    let now = 0, leases = createControlLeases(() => now)
    let first = leases.acquire('session', 'first')
    expect(() => leases.assert('session')).toThrow('CONTROL_HELD')
    expect(() => leases.acquire('session', 'second')).toThrow('CONTROL_HELD')
    let second = leases.acquire('session', 'second', true)
    expect(() => leases.renew('session', 'first', first.generation)).toThrow('CONTROL_HELD')
    leases.renew('session', 'second', second.generation)
    now = 30001
    expect(() => leases.assert('session')).not.toThrow()
    expect(() => leases.assert('session', 'second')).toThrow('CONTROL_EXPIRED')
  })
  it('keeps unrelated sessions available and releases disconnected clients', () => {
    let leases = createControlLeases()
    leases.acquire('one', 'client')
    expect(() => leases.assert('two')).not.toThrow()
    leases.disconnect('client')
    expect(() => leases.assert('one')).not.toThrow()
  })
})
it('rejects stale runtime references and expired signaling', () => {
  let envelope = { version: 1 as const, from: 'client', to: 'host', generation: 'new', nonce: '0123456789abcdef', expires: 60000, payload: '{}', signature: 'signature' }
  expect(validEnvelope(envelope, 'host', 'new', 1)).toBe(true)
  expect(validEnvelope(envelope, 'host', 'old', 1)).toBe(false)
  expect(validEnvelope(envelope, 'other', 'new', 1)).toBe(false)
  expect(validEnvelope(envelope, 'host', 'new', 60001)).toBe(false)
})
