import { expect, it, vi } from 'vitest'
import { captureViewportScreenshot } from '../src/main/viewport-screenshot'

it('maps CSS post bounds into native frame coordinates before resizing', async () => {
  let frame: any = { isEmpty: () => false, getSize: () => ({ width: 800, height: 500 }), crop: vi.fn(), resize: vi.fn(), toJPEG: () => Buffer.from('post') }
  let cropped = { ...frame, getSize: () => ({ width: 300, height: 250 }) }
  frame.crop.mockReturnValue(cropped)
  let contents: any = { capturePage: vi.fn(async () => frame), isDestroyed: () => false, isCrashed: () => false }
  let result = await captureViewportScreenshot(contents, { format: 'jpeg', clip: { x: 400, y: 200, width: 600, height: 500 }, viewport: [1600, 1000], maxDimension: 1024 })
  expect(contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
  expect(frame.crop).toHaveBeenCalledWith({ x: 200, y: 100, width: 300, height: 250 })
  expect(frame.resize).not.toHaveBeenCalled()
  expect(result.data.toString()).toBe('post')
  await expect(captureViewportScreenshot(contents, { clip: { x: 2000, y: 0, width: 100, height: 100 }, viewport: [1600, 1000] })).rejects.toThrow('outside the viewport')
})
