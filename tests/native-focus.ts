import type { ElectronApplication, TestInfo } from '@playwright/test'
import fs from 'node:fs/promises'

export let observeNativeFocus = async (application: ElectronApplication) => {
  await application.evaluate(({ app, BaseWindow, webContents }) => {
    let events: unknown[] = []
    let windows = new WeakSet<Electron.BaseWindow>()
    ;(globalThis as any).bmuxTestFocusEvents = events
    let record = (event: string, id: number) => {
      events.push({ event, id, at: Date.now(), focused: webContents.getFocusedWebContents()?.id, window: BaseWindow.getFocusedWindow()?.id })
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
    }
    for (let contents of webContents.getAllWebContents()) observe(contents)
    app.on('web-contents-created', (_event, contents) => observe(contents))
  })
}

export let recordNativeFocus = async (application: ElectronApplication, info: TestInfo) => {
  if (info.status === info.expectedStatus) return
  let state = await application.evaluate(({ BaseWindow, webContents }) => ({
    events: (globalThis as any).bmuxTestFocusEvents,
    focused: webContents.getFocusedWebContents()?.id,
    windows: BaseWindow.getAllWindows().map(window => ({
      id: window.id, focused: window.isFocused(), visible: window.isVisible(),
      views: window.contentView.children.flatMap(view => 'webContents' in view ? [{ id: (view as Electron.WebContentsView).webContents.id, bounds: view.getBounds() }] : []),
    })),
  })).catch(error => ({ error: String(error) }))
  let output = info.outputPath('native-focus.json')
  await fs.writeFile(output, JSON.stringify(state, null, 2))
  await info.attach('native-focus', { path: output, contentType: 'application/json' })
}
