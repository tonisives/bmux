import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createPreviewRefresh, PREVIEW_INTERVAL_MS } from '../src/main/preview-refresh'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000) })
afterEach(() => vi.useRealTimers())

let fixture = () => {
  let snapshots = new Map<string, number>(), existing = new Set(['one', 'two'])
  let capture = vi.fn((pane: string): Promise<void> | undefined => Promise.resolve().then(() => { snapshots.set(pane, Date.now()) }))
  let refresh = createPreviewRefresh({ exists: pane => existing.has(pane), capturedAt: pane => snapshots.get(pane), capture })
  return { refresh, capture, snapshots, existing }
}

test('captures after activity and performs no work while idle', async () => {
  let { refresh, capture } = fixture()
  refresh.request('one')
  await vi.advanceTimersByTimeAsync(250)
  expect(capture).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(capture).toHaveBeenCalledTimes(1)
  refresh.request('one')
  await vi.advanceTimersByTimeAsync(250)
  expect(capture).toHaveBeenCalledTimes(2)
  refresh.close()
})

test('coalesces a burst into a trailing frame with independent per-pane limits', async () => {
  let { refresh, capture, snapshots } = fixture()
  refresh.request('one'); await vi.advanceTimersByTimeAsync(250)
  for (let action = 0; action < 5; action++) { await vi.advanceTimersByTimeAsync(1000); refresh.request('one') }
  refresh.request('two'); await vi.advanceTimersByTimeAsync(250)
  expect(capture.mock.calls).toEqual([['one'], ['two']])
  await vi.advanceTimersByTimeAsync(9749)
  expect(capture).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(snapshots.get('one')).toBe(115_250)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(capture.mock.calls).toEqual([['one'], ['two'], ['one']])
  refresh.close()
})

test('retains activity that arrives during capture and never overlaps a pane', async () => {
  let { refresh, capture, snapshots } = fixture(), finish!: () => void
  capture.mockImplementationOnce(pane => new Promise<void>(resolve => { finish = () => { snapshots.set(pane, Date.now()); resolve() } }))
  refresh.request('one'); await vi.advanceTimersByTimeAsync(250)
  refresh.request('one'); await vi.advanceTimersByTimeAsync(1000)
  expect(capture).toHaveBeenCalledTimes(1)
  finish(); await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS - 1)
  expect(capture).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(capture).toHaveBeenCalledTimes(2)
  refresh.close()
})

test('waits for a busy capture slot and rate limits failed captures', async () => {
  let { refresh, capture } = fixture()
  capture.mockReturnValueOnce(undefined).mockRejectedValueOnce(new Error('Unavailable'))
  refresh.request('one'); await vi.advanceTimersByTimeAsync(500)
  expect(capture).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS - 1)
  expect(capture).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(capture).toHaveBeenCalledTimes(3)
  refresh.close()
})

test('respects a restored frame and drops unloaded, removed, and shutdown work', async () => {
  let { refresh, capture, snapshots, existing } = fixture()
  snapshots.set('one', Date.now())
  refresh.request('one'); refresh.request('two'); existing.delete('two')
  await vi.advanceTimersByTimeAsync(PREVIEW_INTERVAL_MS - 1)
  expect(capture).not.toHaveBeenCalled()
  refresh.remove('one'); await vi.advanceTimersByTimeAsync(1)
  expect(capture).not.toHaveBeenCalled()
  refresh.request('one'); refresh.close(); refresh.request('one')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(capture).not.toHaveBeenCalled()
})
