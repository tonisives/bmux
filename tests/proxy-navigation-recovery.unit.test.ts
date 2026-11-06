import { afterEach, expect, test, vi } from 'vitest'
import { createProxyNavigationRecovery } from '../src/main/proxy-navigation-recovery'

afterEach(() => { vi.useRealTimers() })
let error = 'ERR_TUNNEL_CONNECTION_FAILED (-111)'

test('shares connection probes, waits through a long outage and reloads only failed panes', async () => {
  vi.useFakeTimers()
  let healthy = false, check = vi.fn(async () => healthy)
  let load = vi.fn(async (pane: string) => { recovery.clear(pane) })
  let recovery = createProxyNavigationRecovery(check, load)
  recovery.record('linkedin', 'social', 'https://linkedin.test/', error, true)
  recovery.record('threads', 'social', 'https://threads.test/', error, true)
  recovery.record('direct', 'system', 'https://direct.test/', error, false)
  recovery.record('certificate', 'social', 'https://cert.test/', 'ERR_CERT_AUTHORITY_INVALID', true)
  await vi.advanceTimersByTimeAsync(17000)
  expect(check.mock.calls).toEqual([['social'], ['social'], ['social']])
  expect(load).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60000)
  expect(check).toHaveBeenCalledTimes(5)
  healthy = true
  await vi.advanceTimersByTimeAsync(30000)
  expect(load.mock.calls).toEqual([['linkedin', 'https://linkedin.test/'], ['threads', 'https://threads.test/']])
  let probes = check.mock.calls.length
  await vi.advanceTimersByTimeAsync(120000)
  expect(check).toHaveBeenCalledTimes(probes)
  recovery.close()
})

test('navigation or closure during a probe prevents a late reload', async () => {
  vi.useFakeTimers()
  let finish!: (healthy: boolean) => void
  let check = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve })), load = vi.fn(async () => undefined)
  let recovery = createProxyNavigationRecovery(check, load)
  recovery.record('pane', 'social', 'https://old.test/', error, true)
  await vi.advanceTimersByTimeAsync(2000)
  recovery.clear('pane')
  finish(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(load).not.toHaveBeenCalled()
  recovery.record('pane', 'social', 'https://new.test/', error, true)
  await vi.advanceTimersByTimeAsync(2000)
  recovery.close()
  finish(true)
  await vi.advanceTimersByTimeAsync(120000)
  expect(load).not.toHaveBeenCalled()
})

test('destination failures retain backoff even when the shared proxy probe succeeds', async () => {
  vi.useFakeTimers()
  let check = vi.fn(async () => true)
  let load = vi.fn(async (pane: string, url: string) => {
    recovery.clear(pane)
    recovery.record(pane, 'social', url, error, true)
    throw new Error(error)
  })
  let recovery = createProxyNavigationRecovery(check, load)
  recovery.record('pane', 'social', 'https://blocked.test/', error, true)
  await vi.advanceTimersByTimeAsync(17000)
  expect(load).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(29999)
  expect(load).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(1)
  expect(load).toHaveBeenCalledTimes(4)
  recovery.clear('pane')
  await vi.advanceTimersByTimeAsync(120000)
  expect(load).toHaveBeenCalledTimes(4)
  recovery.close()
})
