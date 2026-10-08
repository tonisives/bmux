import { afterEach, expect, it, vi } from 'vitest'
import { createFrameCapture } from '../src/main/frame-capture'

afterEach(() => { vi.useRealTimers() })
let fixture = () => {
  vi.useFakeTimers()
  let contents = { id: 1, capturePage: vi.fn(() => Promise.resolve('frame')), getBackgroundThrottling: () => true, setBackgroundThrottling: vi.fn(), isDestroyed: () => false }
  return { contents, subscribe: createFrameCapture((frame: string) => frame) }
}

it('shares capture across viewers and restores throttling after the last viewer leaves', async () => {
  let { contents, subscribe } = fixture(), first = vi.fn(), second = vi.fn()
  let stopFirst = subscribe(contents, first), stopSecond = subscribe(contents, second)
  await vi.advanceTimersByTimeAsync(100)
  expect(contents.capturePage).toHaveBeenCalledTimes(2)
  expect(first).toHaveBeenCalledTimes(2)
  expect(second).toHaveBeenCalledTimes(2)
  stopFirst()
  await vi.advanceTimersByTimeAsync(100)
  expect(first).toHaveBeenCalledTimes(2)
  expect(second).toHaveBeenCalledTimes(3)
  stopSecond()
  await vi.advanceTimersByTimeAsync(1000)
  expect(contents.capturePage).toHaveBeenCalledTimes(3)
  expect(contents.setBackgroundThrottling.mock.calls).toEqual([[false], [true]])
})

it('bounds capture concurrency and discards frames from a closed stream after reconnect', async () => {
  let { contents, subscribe } = fixture(), receive = vi.fn()
  let finish: (frame: string) => void = () => {}
  contents.capturePage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let stop = subscribe(contents, receive)
  await vi.advanceTimersByTimeAsync(1000)
  expect(contents.capturePage).toHaveBeenCalledOnce()
  stop()
  let stopNew = subscribe(contents, receive)
  finish('obsolete')
  await vi.advanceTimersByTimeAsync(0)
  expect(receive.mock.calls).toEqual([['frame']])
  stopNew()
})

it('continues after a failed capture and ignores a page destroyed during capture', async () => {
  let { contents, subscribe } = fixture(), receive = vi.fn(), destroyed = false
  contents.capturePage.mockRejectedValueOnce(new Error('navigation interrupted capture'))
  contents.isDestroyed = () => destroyed
  let stop = subscribe(contents, receive)
  await vi.advanceTimersByTimeAsync(100)
  expect(receive).toHaveBeenCalledWith('frame')
  destroyed = true
  await vi.advanceTimersByTimeAsync(100)
  expect(contents.capturePage).toHaveBeenCalledTimes(2)
  stop()
  expect(contents.setBackgroundThrottling.mock.calls).toEqual([[false]])
})
