import { expect, it } from 'vitest'
import { createExtensionSessionStorage } from '../src/main/extension-session-storage'

it('isolates extensions, clones values, and clears data on unload', () => {
  let storage = createExtensionSessionStorage()
  let value = { nested: { value: 'fixture' } }
  expect(storage.update('one', value)).toEqual({ nested: { newValue: { value: 'fixture' } } })
  value.nested.value = 'changed'
  let result = storage.get('one') as typeof value
  result.nested.value = 'changed again'
  expect(storage.get('one', 'nested')).toEqual({ nested: { value: 'fixture' } })
  expect(storage.get('two')).toEqual({})
  expect(storage.get('two', { fallback: 42 })).toEqual({ fallback: 42 })
  storage.unload('one')
  expect(storage.get('one')).toEqual({})
})

it('enforces the byte quota atomically and handles prototype-shaped keys', () => {
  let storage = createExtensionSessionStorage()
  storage.update('one', JSON.parse('{"__proto__":{"fixture":1},"constructor":2}'))
  expect(storage.get('one', '__proto__')).toEqual(JSON.parse('{"__proto__":{"fixture":1}}'))
  expect(() => storage.update('one', { large: 'x'.repeat(10485760) })).toThrow('quota')
  expect(storage.keys('one')).toEqual(['__proto__', 'constructor'])
  expect(storage.clear('one')).toEqual(JSON.parse('{"__proto__":{"oldValue":{"fixture":1}},"constructor":{"oldValue":2}}'))
  expect(storage.bytes('one')).toBe(0)
})
