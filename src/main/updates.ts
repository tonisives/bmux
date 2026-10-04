import type { AppUpdater } from 'electron-updater'
import type { EventEmitter } from 'node:events'

export type UpdateState = { status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'; version?: string; error?: string }
type Options = {
  updater: Pick<AppUpdater, 'autoDownload' | 'autoInstallOnAppQuit' | 'allowPrerelease' | 'allowDowngrade' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'on' | 'off'>
  nativeUpdater: Pick<EventEmitter, 'on' | 'off'>
  enabled: () => boolean
  changed: (state: UpdateState) => void
}

export let createUpdates = ({ updater, nativeUpdater, enabled, changed }: Options) => {
  let state: UpdateState = { status: 'idle' }
  let pending: Promise<void> | undefined
  let closed = false
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  let update = (next: UpdateState) => { if (!closed) { state = next; changed(state) } }
  let failed = (error: Error) => update({ status: 'error', error: error.message })
  // Squirrel's event follows native signature verification; the JS download event does not.
  let ready = () => update({ status: 'ready', version: state.version })
  updater.on('error', failed)
  nativeUpdater.on('update-downloaded', ready)
  let check = (manual = true) => {
    if (closed || state.status === 'ready') return Promise.resolve()
    if (pending) return pending
    if (state.status === 'downloading') return Promise.resolve()
    update({ status: 'checking' })
    pending = (async () => {
      try {
        let result = await updater.checkForUpdates()
        if (closed) return
        if (!result?.isUpdateAvailable || (!manual && !enabled())) { update({ status: 'idle' }); return }
        update({ status: 'downloading', version: result.updateInfo.version })
        await updater.downloadUpdate()
      } catch (error) { failed(error instanceof Error ? error : new Error(String(error))) }
      finally { pending = undefined }
    })()
    return pending
  }
  let automatic = () => { if (enabled()) void check(false) }
  let startup = setTimeout(automatic, 5000)
  let daily = setInterval(automatic, 24 * 60 * 60 * 1000)
  startup.unref(); daily.unref()
  return {
    get state() { return state },
    check,
    restart: () => { if (!closed && state.status === 'ready') updater.quitAndInstall() },
    close: () => {
      closed = true
      clearTimeout(startup); clearInterval(daily)
      updater.off('error', failed)
      nativeUpdater.off('update-downloaded', ready)
    },
  }
}
