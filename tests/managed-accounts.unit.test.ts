import { expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { accountText, accountTimezone, createAccounts } from '../remote/accounts'

it('validates account text and timezones', () => {
  expect(accountText(' tskr ', 'name')).toBe('tskr')
  expect(accountTimezone('Asia/Bangkok')).toBe('Asia/Bangkok')
  for (let value of ['', 'bad\nname', 'x'.repeat(121)]) expect(() => accountText(value, 'name')).toThrow()
  expect(() => accountTimezone('invalid/zone')).toThrow()
})
it('scopes overview reads and keeps execution disabled', async () => {
  let query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  let result = await createAccounts({ query } as unknown as Pool).api('owner-a', 'GET', '/api/v1/accounts/overview', {})
  expect(result).toMatchObject({ accounts: [], schedules: [], executionEnabled: false })
  expect(query).toHaveBeenCalledTimes(4)
  for (let [sql, args] of query.mock.calls) { expect(sql).toContain('WHERE owner=$1'); expect(args).toEqual(['owner-a']) }
})
it('rejects foreign parents and unsupported platforms', async () => {
  let query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  let api = createAccounts({ query } as unknown as Pool).api
  let input = { personaId: '00000000-0000-4000-8000-000000000001', platform: 'x', handle: 'example' }
  await expect(api('owner-b', 'POST', '/api/v1/accounts', input)).rejects.toThrow('Persona unavailable')
  expect(query.mock.calls[0][0]).toContain('WHERE owner=$2 AND id=$3')
  expect(query.mock.calls[0][1][1]).toBe('owner-b')
  query.mockClear()
  await expect(api('owner', 'POST', '/api/v1/accounts', { ...input, platform: 'unknown' })).rejects.toThrow('supported platform')
  expect(query).not.toHaveBeenCalled()
})
it('rejects invalid schedule times and durations before writing', async () => {
  let query = vi.fn(), api = createAccounts({ query } as unknown as Pool).api
  let input = { accountId: '00000000-0000-4000-8000-000000000001', kind: 'post', job: 'post', scheduledAt: '2099-01-01T12:00:00Z', durationMinutes: 15 }
  for (let scheduledAt of ['2099-01-01T12:00', '2000-01-01T12:00:00Z', 'invalid']) await expect(api('owner', 'POST', '/api/v1/schedules', { ...input, scheduledAt })).rejects.toThrow('future time')
  await expect(api('owner', 'POST', '/api/v1/schedules', { ...input, durationMinutes: 0 })).rejects.toThrow('Duration')
  expect(query).not.toHaveBeenCalled()
})
