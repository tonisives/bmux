import { afterEach, expect, test, vi } from 'vitest'
import type { MenuItem } from 'electron'
import fs from 'node:fs'

vi.mock('electron', async () => {
  let { EventEmitter } = await import('node:events')
  return {
    app: { isPackaged: true, getVersion: () => '0.1.4' },
    autoUpdater: new EventEmitter(),
    dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    Menu: { getApplicationMenu: vi.fn() },
    Notification: { isSupported: () => false },
  }
})
vi.mock('electron-updater', async () => {
  let { EventEmitter } = await import('node:events')
  return { default: { autoUpdater: Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.1.5' } })),
    downloadUpdate: vi.fn(async () => []), quitAndInstall: vi.fn(),
  }) } }
})
import { app, autoUpdater as nativeUpdater, dialog, Menu } from 'electron'
import electronUpdater from 'electron-updater'
import { installUpdateMenu } from '../src/main/update-menu'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.(); cleanup = undefined
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers()
  nativeUpdater.removeAllListeners()
})

test.runIf(process.platform === 'darwin')('update menu survives config reloads and only restarts on explicit confirmation', async () => {
  vi.useFakeTimers()
  vi.stubEnv('BMUX_DATA_DIR', '')
  vi.stubEnv('BROWMUX_DATA_DIR', '')
  let resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: '/fixture/Resources', configurable: true })
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  let enabled = true
  let setEnabled = vi.fn((value: boolean) => { enabled = value })
  let beforeRestart = vi.fn()
  let items = { 'check-for-updates': {} as MenuItem, 'automatic-updates': {} as MenuItem }
  vi.mocked(Menu.getApplicationMenu).mockImplementation(() => ({ getMenuItemById: (id: keyof typeof items) => items[id] }) as unknown as Menu)
  let menu = installUpdateMenu({ enabled: () => enabled, setEnabled, beforeRestart })!
  cleanup = () => {
    menu.close()
    if (resources) Object.defineProperty(process, 'resourcesPath', resources)
    else Reflect.deleteProperty(process, 'resourcesPath')
  }
  expect(electronUpdater.autoUpdater.channel).toBe(`latest-${process.arch}`)
  expect(items['automatic-updates']).toMatchObject({ visible: true, checked: true })
  items['automatic-updates'].checked = false
  items['automatic-updates'].click(items['automatic-updates'], null, {})
  expect(setEnabled).toHaveBeenCalledWith(false)
  items = { 'check-for-updates': {} as MenuItem, 'automatic-updates': {} as MenuItem }
  menu.refresh()
  expect(items['automatic-updates'].checked).toBe(false)
  await items['check-for-updates'].click(items['check-for-updates'], null, {})
  expect(items['check-for-updates']).toMatchObject({ label: 'Downloading Update...', enabled: false })
  nativeUpdater.emit('update-downloaded')
  expect(items['check-for-updates']).toMatchObject({ label: 'Restart to Update...', enabled: true })
  await items['check-for-updates'].click(items['check-for-updates'], null, {})
  expect(electronUpdater.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
  await items['check-for-updates'].click(items['check-for-updates'], null, {})
  expect(electronUpdater.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  nativeUpdater.emit('before-quit-for-update')
  expect(beforeRestart).toHaveBeenCalledTimes(1)
})

test('development and isolated profiles never initialize the updater', () => {
  let options = { enabled: () => true, setEnabled: vi.fn(), beforeRestart: vi.fn() }
  let packaged = vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(false)
  expect(installUpdateMenu(options)).toBeUndefined()
  packaged.mockReturnValue(true)
  vi.stubEnv('BMUX_DATA_DIR', '/fixture/disposable-profile')
  expect(installUpdateMenu(options)).toBeUndefined()
})
