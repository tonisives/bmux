import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BaseWindow, WebContents } from 'electron'
import { createFilePickerDiagnostics } from '../src/main/file-picker-diagnostics'

test('distinguishes picker requests, native sheets, and shared CDP interception', () => {
  let trace = createFilePickerDiagnostics()
  let window = Object.assign(new EventEmitter(), { id: 2, isVisible: () => true, isDestroyed: () => false })
  let contents = Object.assign(new EventEmitter(), { debugger: new EventEmitter() })
  let owner = { windowId: 1, visible: false }
  trace.watchWindow(window as unknown as BaseWindow)
  trace.watchPage('%3', contents as unknown as WebContents, () => owner)
  trace.interception('%3', { enabled: true, cancel: true, filePath: '/private/example.png' }, 'frame')
  contents.debugger.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 7, filePath: '/private/example.png' })
  owner = { windowId: 2, visible: true }
  trace.interception('%3', { enabled: false })
  contents.debugger.emit('message', {}, 'Page.fileChooserOpened', {})
  window.emit('sheet-begin')
  let snapshot = trace.snapshot()
  expect(snapshot.sheets).toEqual([2])
  expect(snapshot.events.map(({ at: _at, ...event }) => event)).toEqual([
    { event: 'cdp-interception', paneId: '%3', enabled: true, cancel: true, sessionId: 'frame' },
    { event: 'request', paneId: '%3', windowId: 1, visible: false },
    { event: 'cdp-interception', paneId: '%3', enabled: false, cancel: false },
    { event: 'request', paneId: '%3', windowId: 2, visible: true },
    { event: 'sheet-begin', windowId: 2, visible: true },
  ])
  expect(JSON.stringify(snapshot)).not.toContain('/private')
  window.emit('sheet-end')
  expect(trace.snapshot().sheets).toEqual([])
  window.emit('sheet-begin')
  window.emit('closed')
  expect(trace.snapshot().sheets).toEqual([])
  let debuggerApi = contents.debugger
  Object.defineProperty(contents, 'debugger', { get: () => { throw new Error('WebContents destroyed') } })
  expect(() => contents.emit('destroyed')).not.toThrow()
  expect(debuggerApi.listenerCount('message')).toBe(0)
  expect(debuggerApi.listenerCount('detach')).toBe(0)
})

test('bounds picker history and returns independent snapshots', () => {
  let trace = createFilePickerDiagnostics()
  for (let i = 0; i < 110; i++) trace.interception(`%${i}`, { enabled: true })
  let snapshot = trace.snapshot()
  expect(snapshot.events).toHaveLength(100)
  expect(snapshot.events[0].paneId).toBe('%10')
  snapshot.events[0].paneId = 'changed'
  expect(trace.snapshot().events[0].paneId).toBe('%10')
})
