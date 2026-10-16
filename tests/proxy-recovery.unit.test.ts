import { afterEach, expect, test, vi } from 'vitest'
import { createProxyRecovery } from '../src/main/proxy-recovery'

afterEach(() => { vi.useRealTimers() })

test('retries three times with backoff and stops until explicitly requested again', async () => {
  vi.useFakeTimers()
  let check = vi.fn(async () => false)
  let recovery = createProxyRecovery(check)
  recovery.schedule('saved')
  recovery.schedule('saved')
  await vi.advanceTimersByTimeAsync(17000)
  expect(check.mock.calls).toHaveLength(3)
  await vi.advanceTimersByTimeAsync(60000)
  expect(check.mock.calls).toHaveLength(3)
  await recovery.retry('saved')
  expect(check).toHaveBeenLastCalledWith('saved')
  expect(check.mock.calls).toHaveLength(4)
  await vi.advanceTimersByTimeAsync(17000)
  expect(check.mock.calls).toHaveLength(7)
  recovery.close()
})

test('stops after a successful retry', async () => {
  vi.useFakeTimers()
  let check = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  let recovery = createProxyRecovery(check)
  recovery.schedule('saved')
  await vi.advanceTimersByTimeAsync(60000)
  expect(check.mock.calls).toHaveLength(2)
  recovery.close()
})

test('shares in-flight probes and cancels queued and late retries', async () => {
  vi.useFakeTimers()
  let finish!: (value: boolean) => void
  let check = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  let recovery = createProxyRecovery(check)
  recovery.schedule('saved')
  let first = recovery.retry('saved'), second = recovery.retry('saved')
  expect(first).toBe(second)
  expect(check.mock.calls).toHaveLength(1)
  recovery.cancel('saved')
  finish(false)
  await first
  await vi.advanceTimersByTimeAsync(60000)
  expect(check.mock.calls).toHaveLength(1)
  recovery.schedule('other')
  recovery.close()
  await vi.advanceTimersByTimeAsync(60000)
  expect(check.mock.calls).toHaveLength(1)
})
