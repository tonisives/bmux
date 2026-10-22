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
