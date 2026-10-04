import { app, autoUpdater as nativeUpdater, dialog, Menu, Notification } from 'electron'
import type { MenuItem } from 'electron'
import electronUpdater from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { createUpdates } from './updates'

export let installUpdateMenu = (options: { enabled: () => boolean; setEnabled: (enabled: boolean) => void; beforeRestart: () => void }) => {
  // Development, test profiles, and local packages never fetch or install releases.
  if (process.platform !== 'darwin' || !app.isPackaged || process.env.BMUX_DATA_DIR || process.env.BROWMUX_DATA_DIR || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return
  electronUpdater.autoUpdater.channel = `latest-${process.arch}`
  let updates = createUpdates({
    updater: electronUpdater.autoUpdater,
    nativeUpdater,
    enabled: options.enabled,
    changed: state => {
      refresh()
      if (state.status === 'ready' && Notification.isSupported()) new Notification({ title: 'bmux update ready', body: `Version ${state.version} will be installed when you quit. Choose Restart to Update in the bmux menu to restart now.` }).show()
    },
  })
  let setEnabled = (item: MenuItem) => {
    try { options.setEnabled(item.checked) }
    catch { item.checked = options.enabled(); void dialog.showMessageBox({ type: 'error', message: 'Could not save the update preference.', detail: 'Fix the configuration file and try again.' }) }
  }
  let check = async () => {
    if (updates.state.status === 'ready') {
      let result = await dialog.showMessageBox({ message: `Restart bmux to install version ${updates.state.version}?`, buttons: ['Restart', 'Later'], defaultId: 1, cancelId: 1 })
      if (result.response === 0) updates.restart()
      return
    }
    await updates.check()
    if (updates.state.status === 'idle') await dialog.showMessageBox({ message: 'bmux is up to date.', detail: `Version ${app.getVersion()}` })
    if (updates.state.status === 'error') await dialog.showMessageBox({ type: 'error', message: 'Could not check for updates.', detail: 'Please try again later.' })
  }
  let refresh = () => {
    let menu = Menu.getApplicationMenu()
    let checkItem = menu?.getMenuItemById('check-for-updates')
    let automaticItem = menu?.getMenuItemById('automatic-updates')
    if (!checkItem || !automaticItem) return
    checkItem.visible = true
    checkItem.label = ({ idle: 'Check for Updates...', checking: 'Checking for Updates...', downloading: 'Downloading Update...', ready: 'Restart to Update...', error: 'Check for Updates...' })[updates.state.status]
    checkItem.enabled = !['checking', 'downloading'].includes(updates.state.status)
    checkItem.click = check
    automaticItem.visible = true
    automaticItem.checked = options.enabled()
    automaticItem.click = setEnabled
  }
  refresh()
  nativeUpdater.on('before-quit-for-update', options.beforeRestart)
  return {
    refresh,
    close: () => { updates.close(); nativeUpdater.off('before-quit-for-update', options.beforeRestart) },
  }
}
