import { expect, test, vi } from 'vitest'
import vm from 'node:vm'
import { hanzisizeAutoResizeSource } from '../src/main/hanzisize-extension'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

let fixture = (settings: Record<string, unknown> = { language: 'thai', minFontSize: 18 }) => {
  let listeners: Record<string, (...args: any[]) => void> = {}
  let runtime = { lastError: undefined as { message: string } | undefined }
  let receiver = false
  let denied = false
  let withError = (message: string | undefined, callback: () => void) => {
    runtime.lastError = message ? { message } : undefined
    callback()
    runtime.lastError = undefined
  }
  let get = vi.fn((_keys, callback) => callback(settings))
  let sendMessage = vi.fn((_id, _message, _options, callback) => withError(receiver ? undefined : 'No receiver', callback))
  let executeScript = vi.fn((_id, details, callback) => {
    if (details.file === 'contentScript.js' && !denied) receiver = true
    withError(denied ? 'No host permission' : undefined, callback)
  })
  let context = vm.createContext({ chrome: {
    runtime, storage: { local: { get } }, tabs: {
      query: (_query: unknown, callback: (tabs: unknown[]) => void) => callback([]), sendMessage, executeScript,
      onUpdated: { addListener: (callback: (...args: any[]) => void) => { listeners.updated = callback } },
      onRemoved: { addListener: (callback: (...args: any[]) => void) => { listeners.removed = callback } },
    },
  } })
  vm.runInContext(hanzisizeAutoResizeSource, context)
  let update = (status = 'complete', id = 7, url = 'https://example.com/') => listeners.updated(id, { status }, { id, url })
  return { context, update, get, sendMessage, executeScript, deny: () => { denied = true }, remove: (id: number) => listeners.removed(id) }
}

test('uses saved settings and the exact target tab without opening a popup', () => {
  let host = fixture()
  host.update()
  expect(host.executeScript.mock.calls.map(([id, details]) => [id, details.file])).toEqual([[7, 'jquery-3.5.1.min.js'], [7, 'contentScript.js']])
  expect(host.sendMessage).toHaveBeenLastCalledWith(7, { language: 'thai', minFontSize: 18, newMinFontSize: 18, mode: 'initial' }, { frameId: 0 }, expect.any(Function))
  host.update()
  expect(host.executeScript).toHaveBeenCalledTimes(2)
})

test('leaves zero-size settings and non-web pages alone', () => {
  let host = fixture({ language: 'thai', minFontSize: 0 })
  host.update()
  expect(host.sendMessage).not.toHaveBeenCalled()
  host = fixture()
  host.update('complete', 7, 'chrome-extension://other/popup.html')
  expect(host.get).not.toHaveBeenCalled()
})

test('honors Chromium host-permission errors instead of injecting the content script', () => {
  let host = fixture()
  host.deny()
  host.update()
  expect(host.executeScript.mock.calls.map(([, details]) => details.file)).toEqual(['jquery-3.5.1.min.js'])
  expect(host.sendMessage).toHaveBeenCalledTimes(1)
})

test.each(['navigation', 'close'])('abandons stale settings reads after %s', reason => {
  let host = fixture()
  let stored: ((settings: unknown) => void) | undefined
  host.get.mockImplementationOnce((_keys, callback) => { stored = callback })
  host.update()
  if (reason === 'navigation') host.update('loading')
  else host.remove(7)
  stored!({ language: 'thai', minFontSize: 18 })
  expect(host.sendMessage).not.toHaveBeenCalled()
})
