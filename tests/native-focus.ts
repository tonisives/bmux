import type { ElectronApplication, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

let nativeDialogLogs = new WeakMap<ElectronApplication, string>()

export let sendNativeKeys = async (application: ElectronApplication, events: Omit<Electron.KeyboardInputEvent, 'type'>[]) => {
  // Inspector evaluation can run inside an AppKit focus transition. Check and send
  // together so no separate RPC can land between readiness and input delivery.
  await expect.poll(() => application.evaluate(async ({ BaseWindow, webContents }, events) => {
    let contents = webContents.getFocusedWebContents(), window = BaseWindow.getFocusedWindow()
    if (!contents || !window?.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents === contents)) return false
    for (let [index, event] of events.entries()) {
      contents.sendInputEvent({ type: 'keyDown', ...event })
      contents.sendInputEvent({ type: 'keyUp', ...event })
      if (index < events.length - 1) await new Promise(resolve => setTimeout(resolve, 30))
    }
    return true
  }, events), { intervals: [10, 20, 50] }).toBe(true)
}

export let observeNativeFocus = async (application: ElectronApplication) => {
  let logPath = path.join(await application.evaluate(({ app }) => app.getPath('userData')), 'test-native-dialogs.log')
  nativeDialogLogs.set(application, logPath)
  await fs.rm(logPath, { force: true })
  await application.evaluate(({ app, BaseWindow, webContents, dialog }, logPath) => {
    let log = (title: string, detail: string) => require('node:fs').appendFileSync(logPath, `${title}\n${detail}\n`.replace(/[a-f0-9]{24,}/gi, '[redacted]'), { mode: 0o600 })
    dialog.showErrorBox = (title, content) => {
      // Electron's default uncaught-exception dialog blocks headless desktops.
      // Retain the error and exit this disposable test process instead.
      log(title, content)
      app.exit(1)
    }
    let messageBox = dialog.showMessageBoxSync
    dialog.showMessageBoxSync = (...args: any[]) => {
      let options = args.at(-1) as Electron.MessageBoxSyncOptions
      log(options.title ?? 'Native message box', [options.message, options.detail].filter(Boolean).join('\n'))
      return Reflect.apply(messageBox, dialog, args)
    }
    let events: unknown[] = []
    let windows = new WeakSet<Electron.BaseWindow>()
    ;(globalThis as any).bmuxTestFocusEvents = events
    let record = (event: string, id: number) => {
      // Native focus/input callbacks can run during view reattachment or window
      // destruction. Record the notification without reentering focus lookup;
      // the failure snapshot reads the settled native state separately.
      events.push({ event, id, at: Date.now() })
      if (events.length > 100) events.shift()
    }
    let observe = (contents: Electron.WebContents) => {
      for (let window of BaseWindow.getAllWindows()) {
        if (windows.has(window)) continue
        windows.add(window)
        window.on('focus', () => record('window-focus', window.id))
        window.on('blur', () => record('window-blur', window.id))
      }
      contents.on('focus', () => record('focus', contents.id))
      contents.on('blur', () => record('blur', contents.id))
      // Record delivery and routing, never text or typed credentials.
      contents.on('before-input-event', (_event, input) => record(input.type, contents.id))
      contents.on('before-mouse-event', (_event, mouse) => record(mouse.type, contents.id))
    }
    for (let contents of webContents.getAllWebContents()) observe(contents)
    app.on('web-contents-created', (_event, contents) => observe(contents))
  }, logPath)
}

export let recordNativeFocus = async (application: ElectronApplication, info: TestInfo, failed = info.status !== info.expectedStatus) => {
  let logPath = nativeDialogLogs.get(application)
  let dialogs = logPath ? await fs.readFile(logPath, 'utf8').catch(() => undefined) : undefined
  if (dialogs && failed) {
    console.error('NATIVE_DIALOG_DIAGNOSTICS', dialogs)
    await info.attach('native-dialogs', { body: dialogs, contentType: 'text/plain' })
  }
  if (!failed) return
  let timer: ReturnType<typeof setTimeout> | undefined
  let capture = application.evaluate(({ BaseWindow, webContents }) => ({
    events: (globalThis as any).bmuxTestFocusEvents,
    focused: webContents.getFocusedWebContents()?.id,
    windows: BaseWindow.getAllWindows().map(window => ({
      id: window.id, focused: window.isFocused(), visible: window.isVisible(),
      views: window.contentView.children.flatMap(view => 'webContents' in view ? [{ id: (view as Electron.WebContentsView).webContents.id, bounds: view.getBounds() }] : []),
    })),
  }))
  let state
  try {
    state = await Promise.race([capture, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Native focus capture timed out')), 5000)
    })]).catch(error => ({ error: String(error) }))
  } finally { clearTimeout(timer) }
  let output = info.outputPath('native-focus.json')
  await fs.writeFile(output, JSON.stringify(state, null, 2))
  await info.attach('native-focus', { path: output, contentType: 'application/json' })
  if (process.platform === 'darwin' && state && typeof state === 'object' && 'error' in state) {
    let trace = info.outputPath('native-hang.txt')
    try {
      await promisify(execFile)('/usr/bin/sample', [String(application.process().pid), '1', '1', '-file', trace], { timeout: 5000 })
    } catch (error) { await fs.writeFile(trace, String(error)) }
    await info.attach('native-hang', { path: trace, contentType: 'text/plain' })
  }
}
