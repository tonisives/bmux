import { expect, it } from 'vitest'
import { qualityNetwork } from '../src/stream-quality'
import { remoteStreamQuality } from '../../src/shared/remote-management'

it('uses Data saver on cellular, unknown and expensive Wi-Fi', () => {
  for (let state of [{ type: 'cellular' }, { type: 'unknown' }, { type: 'wifi', details: { isConnectionExpensive: true } }]) expect(remoteStreamQuality('auto', qualityNetwork(state)).effective).toBe('data-saver')
  expect(remoteStreamQuality('auto', qualityNetwork({ type: 'wifi' })).effective).toBe('quality')
  expect(remoteStreamQuality('auto', qualityNetwork({ type: 'ethernet' })).effective).toBe('quality')
})
it('keeps explicit stream quality choices across network types', () => {
  expect(remoteStreamQuality('quality', 'cellular').effective).toBe('quality')
  expect(remoteStreamQuality('data-saver', 'wifi').effective).toBe('data-saver')
})
