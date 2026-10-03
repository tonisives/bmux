import { test, expect, vi } from 'vitest'
import { settlePageNavigation } from '../src/main/navigation'

let url = 'https://example.com/video.mp4'
let failure = () => Object.assign(new Error('Navigation failed'), { code: 'ERR_FAILED', url })
let fixture = (mimeType = 'video/mp4') => ({
  isDestroyed: vi.fn(() => false), isLoadingMainFrame: vi.fn(() => false), getURL: vi.fn(() => url),
  debugger: { isAttached: vi.fn(() => true), attach: vi.fn(), sendCommand: vi.fn(async () => ({ frameTree: { frame: { url, mimeType } } })) },
})
let run = (contents: ReturnType<typeof fixture>, navigation: Promise<void>) => settlePageNavigation(contents as unknown as Parameters<typeof settlePageNavigation>[0], navigation)

test('successful navigation does not inspect the document', async () => {
  let contents = fixture()
  await run(contents, Promise.resolve())
  expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
})
for (let mime of ['video/mp4', 'audio/mpeg']) test(`accepts a committed ${mime} document after Electron's synthetic failure`, async () => {
  let contents = fixture(mime)
  await expect(run(contents, Promise.reject(failure()))).resolves.toBeUndefined()
  expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Page.getFrameTree')
})
test('an MP4 filename cannot hide an HTML error page', async () => {
  let error = failure()
  await expect(run(fixture('text/html'), Promise.reject(error))).rejects.toBe(error)
})
for (let code of ['ERR_ABORTED', 'ERR_CONNECTION_RESET']) test(`preserves ${code} errors`, async () => {
  let contents = fixture(), error = Object.assign(failure(), { code })
  await expect(run(contents, Promise.reject(error))).rejects.toBe(error)
  expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
})
for (let state of ['destroyed', 'loading', 'different-url']) test(`does not inspect ${state} contents`, async () => {
  let contents = fixture(), error = failure()
  if (state === 'destroyed') contents.isDestroyed.mockReturnValue(true)
  if (state === 'loading') contents.isLoadingMainFrame.mockReturnValue(true)
  if (state === 'different-url') contents.getURL.mockReturnValue('https://example.com/previous.mp4')
  await expect(run(contents, Promise.reject(error))).rejects.toBe(error)
  expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
})
test('preserves failures when the frame or current URL changed during inspection', async () => {
  for (let changed of ['frame', 'contents']) {
    let contents = fixture(), error = failure()
    if (changed === 'frame') contents.debugger.sendCommand.mockResolvedValue({ frameTree: { frame: { url: url + '?other', mimeType: 'video/mp4' } } })
    else contents.getURL.mockReturnValueOnce(url).mockReturnValue(url + '?other')
    await expect(run(contents, Promise.reject(error))).rejects.toBe(error)
  }
})
test('preserves the original navigation failure when inspection fails or stalls', async () => {
  let contents = fixture(), error = failure()
  contents.debugger.sendCommand.mockRejectedValue(new Error('Renderer unavailable'))
  await expect(run(contents, Promise.reject(error))).rejects.toBe(error)
  vi.useFakeTimers()
  try {
    contents.debugger.sendCommand.mockImplementation(() => new Promise(() => {}))
    let result = expect(run(contents, Promise.reject(error))).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(1500)
    await result
  } finally { vi.useRealTimers() }
})
