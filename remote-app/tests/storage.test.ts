import { expect, it, vi } from 'vitest'
let storage = vi.hoisted(() => ({ getItemAsync: vi.fn(), deleteItemAsync: vi.fn(async () => {}) }))
vi.mock('expo-secure-store', () => storage)
import { readSession } from '../src/storage.native'

it.each([
  '{broken',
  JSON.stringify({ owner: 'owner', accessToken: 'a'.repeat(64), expiresAt: 'invalid' }),
  JSON.stringify({ accessToken: 'a'.repeat(64), expiresAt: '2100-01-01' }),
  JSON.stringify({ owner: 'owner', accessToken: 'invalid', expiresAt: '2100-01-01' }),
  JSON.stringify({ owner: 'owner', accessToken: 'a'.repeat(64), expiresAt: '2000-01-01' }),
])('discards an invalid or expired persisted native session', async value => {
  storage.getItemAsync.mockResolvedValueOnce(value)
  storage.deleteItemAsync.mockClear()
  expect(await readSession()).toBeUndefined()
  expect(storage.deleteItemAsync).toHaveBeenCalledWith('bmux.remote.session')
})
it('retains a valid native bearer until its expiry', async () => {
  let session = { owner: 'owner', accessToken: 'a'.repeat(64), expiresAt: '2100-01-01', refreshToken: 'b'.repeat(64), refreshExpiresAt: '2100-01-02' }
  storage.getItemAsync.mockResolvedValueOnce(JSON.stringify(session))
  storage.deleteItemAsync.mockClear()
  expect(await readSession()).toEqual(session)
  expect(storage.deleteItemAsync).not.toHaveBeenCalled()
})
