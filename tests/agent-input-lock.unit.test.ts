import { afterEach, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: class {} }))
import { AGENT_INPUT_LOCK_MS, AGENT_INPUT_OVERRIDE_MS, createAgentInputOverrides, scheduleAgentInputUnlock } from '../src/main/agent-input-lock'
import type { Pane } from '../src/shared/types'

afterEach(() => { vi.useRealTimers() })

test('an early timer keeps native input expiry armed until the lock deadline', () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  let unlock = vi.fn()
  scheduleAgentInputUnlock(Date.now(), unlock)
  // Timer elapsed time and the wall clock can differ at millisecond boundaries.
  vi.setSystemTime(-1)
  vi.advanceTimersByTime(AGENT_INPUT_LOCK_MS)
  expect(unlock).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(unlock).toHaveBeenCalledTimes(1)
})


test('supports custom expiry, cancelling obsolete deadlines, and immediate unlock', () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  let unlock = vi.fn(), cancel = scheduleAgentInputUnlock(0, unlock, 100)
  vi.advanceTimersByTime(50); cancel()
  scheduleAgentInputUnlock(0, unlock, 200)
  vi.advanceTimersByTime(149); expect(unlock).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1); expect(unlock).toHaveBeenCalledTimes(1)
  scheduleAgentInputUnlock(Date.now(), unlock, 0)
  expect(unlock).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(0); expect(unlock).toHaveBeenCalledTimes(2)
})

test('a temporary override expires after five minutes and belongs to the original pane object', () => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  let changed = vi.fn(), overrides = createAgentInputOverrides(changed)
  let pane = { id: '%1' } as Pane, replacement = { id: '%1' } as Pane
  expect(AGENT_INPUT_OVERRIDE_MS).toBe(5 * 60_000)
  expect(overrides.set(pane, true)).toBe(301000)
  expect(overrides.has(pane)).toBe(true)
  expect(overrides.has(replacement)).toBe(false)
  expect(overrides.status()).toEqual({ '%1': 301000 })
  changed.mockClear()
  vi.advanceTimersByTime(AGENT_INPUT_OVERRIDE_MS - 1)
  expect(changed).not.toHaveBeenCalled()
  expect(overrides.has(pane)).toBe(true)
  vi.advanceTimersByTime(1)
  expect(changed).toHaveBeenCalledExactlyOnceWith('%1')
  expect(overrides.has(pane)).toBe(false)
  expect(overrides.status()).toEqual({})
})

test('restoring, replacing, closing and shutting down cancel obsolete override deadlines', () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  let changed = vi.fn(), overrides = createAgentInputOverrides(changed), pane = { id: '%1' } as Pane
  overrides.set(pane, true)
  vi.advanceTimersByTime(1000)
  expect(overrides.set(pane, false)).toBeUndefined()
  expect(overrides.has(pane)).toBe(false)
  overrides.set(pane, true)
  vi.advanceTimersByTime(1000)
  overrides.set(pane, true)
  changed.mockClear()
  vi.advanceTimersByTime(AGENT_INPUT_OVERRIDE_MS - 1)
  expect(overrides.has(pane)).toBe(true)
  expect(changed).not.toHaveBeenCalled()
  overrides.remove(pane.id)
  expect(overrides.status()).toEqual({})
  overrides.set(pane, true)
  overrides.clear()
  changed.mockClear()
  vi.advanceTimersByTime(AGENT_INPUT_OVERRIDE_MS)
  expect(changed).not.toHaveBeenCalled()
  expect(overrides.status()).toEqual({})
})
