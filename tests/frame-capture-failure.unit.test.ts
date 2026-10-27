import { expect, it, vi } from 'vitest'
import { capturePageFrame, frameCaptureError, stopFrameCapture } from '../src/main/frame-capture'

it('blocks further native captures and discards an in-flight frame after a GPU failure', async () => {
  let finish!: (frame: string) => void
  let contents = { isDestroyed: () => false, isCrashed: () => false, capturePage: vi.fn(() => new Promise<string>(resolve => { finish = resolve })) }
  let pending = capturePageFrame(contents)
  let rejected = expect(pending).rejects.toThrow('GPU failure')
  await vi.waitFor(() => expect(contents.capturePage).toHaveBeenCalledOnce())
  stopFrameCapture('Video capture unavailable after GPU failure')
  finish('obsolete')
  await rejected
  await expect(capturePageFrame(contents)).rejects.toThrow('GPU failure')
  expect(frameCaptureError()).toBe('Video capture unavailable after GPU failure')
  expect(contents.capturePage).toHaveBeenCalledOnce()
})
