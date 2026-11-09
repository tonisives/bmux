import { expect, test, vi } from 'vitest'
import { createAgentStatePublisher } from '../src/main/agent-state-publisher'

test('parallel observations publish at most four status updates per second without starving the final update', async () => {
  vi.useFakeTimers()
  try {
    let publish = vi.fn(), pending = createAgentStatePublisher(publish)
    for (let tick = 0; tick < 100; tick++) {
      for (let pane = 0; pane < 4; pane++) pending.request()
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(publish).toHaveBeenCalledTimes(4)
    pending.request()
    await vi.advanceTimersByTimeAsync(250)
    expect(publish).toHaveBeenCalledTimes(5)
  } finally { vi.useRealTimers() }
})

test('an immediate UI update or shutdown cancels redundant agent publication', async () => {
  vi.useFakeTimers()
  try {
    let publish = vi.fn(), pending = createAgentStatePublisher(publish)
    pending.request(); pending.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(publish).not.toHaveBeenCalled()
    pending.request()
    await vi.advanceTimersByTimeAsync(250)
    expect(publish).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
})
