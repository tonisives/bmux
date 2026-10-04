import { afterEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AppUpdater } from 'electron-updater'
import { createUpdates } from '../src/main/updates'

let fixture = () => {
  vi.useFakeTimers()
  let updater = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: false, allowPrerelease: true, allowDowngrade: true,
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })),
    downloadUpdate: vi.fn(async () => []), quitAndInstall: vi.fn(),
  })
  let nativeUpdater = new EventEmitter()
  let enabled = true
  let changed = vi.fn()
  let updates = createUpdates({ updater: updater as unknown as AppUpdater, nativeUpdater, enabled: () => enabled, changed })
  return { updater, nativeUpdater, updates, changed, disable: () => { enabled = false } }
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

test('checks after startup and daily, respects the live preference, and permits manual checks', async () => {
  let current = fixture()
  current.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '0.1.0' } })
  await vi.advanceTimersByTimeAsync(4999)
  expect(current.updater.checkForUpdates).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(current.updater.checkForUpdates).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  expect(current.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  current.disable()
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  expect(current.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  await current.updates.check()
  expect(current.updater.checkForUpdates).toHaveBeenCalledTimes(3)
  current.updates.close()
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  expect(current.updater.checkForUpdates).toHaveBeenCalledTimes(3)
})

test('stages one download and only enables restart after native signature verification', async () => {
  let { updater, nativeUpdater, updates } = fixture()
  await Promise.all([updates.check(), updates.check()])
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  updater.emit('update-downloaded', { version: '0.2.0' })
  expect(updates.state).toEqual({ status: 'downloading', version: '0.2.0' })
  updates.restart()
  await updates.check()
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
  expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  nativeUpdater.emit('update-downloaded')
  expect(updates.state).toEqual({ status: 'ready', version: '0.2.0' })
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
  updates.restart()
  expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: true, allowPrerelease: false, allowDowngrade: false })
  updates.close()
})

test('network and native verification failures remain recoverable and never restart the app', async () => {
  let { updater, nativeUpdater, updates } = fixture()
  updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
  await updates.check()
  expect(updates.state).toEqual({ status: 'error', error: 'offline' })
  await updates.check()
  updater.emit('error', new Error('invalid signature'))
  updates.restart()
  expect(updates.state).toEqual({ status: 'error', error: 'invalid signature' })
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
  await updates.check()
  nativeUpdater.emit('update-downloaded')
  expect(updates.state.status).toBe('ready')
  updates.close()
  expect(nativeUpdater.listenerCount('update-downloaded')).toBe(0)
})

test('disabling automatic updates while checking prevents the background download', async () => {
  let { updater, updates, disable } = fixture()
  updater.checkForUpdates.mockImplementation(async () => { disable(); return { isUpdateAvailable: true, updateInfo: { version: '0.2.0' } } })
  await vi.advanceTimersByTimeAsync(5000)
  expect(updater.downloadUpdate).not.toHaveBeenCalled()
  expect(updates.state.status).toBe('idle')
  updates.close()
})
