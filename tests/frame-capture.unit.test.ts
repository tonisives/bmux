import { afterEach, expect, it, vi } from 'vitest'
import { capturePageFrame, createFrameCapture } from '../src/main/frame-capture'

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
  await vi.advanceTimersByTimeAsync(1000)
  expect(contents.capturePage).toHaveBeenCalledOnce()
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

it('shares native capture between startup, live video, and previews without changing page visibility', async () => {
  let { contents, subscribe } = fixture(), receive = vi.fn()
  let finish!: (frame: string) => void
  contents.capturePage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let stop = subscribe(contents, receive)
  await vi.advanceTimersByTimeAsync(0)
  let initial = capturePageFrame(contents), preview = capturePageFrame(contents), connected = capturePageFrame(contents)
  await vi.advanceTimersByTimeAsync(1000)
  expect(contents.capturePage.mock.calls).toEqual([[undefined, { stayHidden: true }]])
  finish('shared frame')
  expect(await Promise.all([initial, preview, connected])).toEqual(['shared frame', 'shared frame', 'shared frame'])
  expect(receive).toHaveBeenCalledWith('shared frame')
  await vi.advanceTimersByTimeAsync(100)
  expect(contents.capturePage).toHaveBeenCalledTimes(2)
  stop()
})

it('releases a rejected native capture so later previews and streams can recover', async () => {
  let { contents } = fixture()
  contents.capturePage.mockRejectedValueOnce(new Error('surface changed'))
  let first = capturePageFrame(contents), other = capturePageFrame(contents)
  expect(first).toBe(other)
  await expect(first).rejects.toThrow('surface changed')
  await expect(capturePageFrame(contents)).resolves.toBe('frame')
  expect(contents.capturePage).toHaveBeenCalledTimes(2)
})

it('keeps the last video frame when navigation produces an empty capture', async () => {
  let { contents } = fixture(), receive = vi.fn()
  let subscribe = createFrameCapture((frame: string) => frame || undefined)
  contents.capturePage.mockResolvedValueOnce('')
  let stop = subscribe(contents, receive)
  await vi.advanceTimersByTimeAsync(0)
  expect(receive).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  expect(receive).toHaveBeenCalledExactlyOnceWith('frame')
  stop()
})
