import { afterEach, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: class {} }))
import { AGENT_INPUT_LOCK_MS, scheduleAgentInputUnlock } from '../src/main/agent-input-lock'

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
