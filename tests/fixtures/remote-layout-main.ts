import { app, BaseWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { createRuntime } from '../../src/main/runtime'

;(app as any).setAppPath(process.cwd())
app.setPath('userData', process.env.BMUX_DATA_DIR!)
void app.whenReady().then(async () => {
  let runtime = createRuntime(process.env.BMUX_DATA_DIR!)
  ;(globalThis as any).remoteLayoutRuntime = runtime
  let inputWindow = () => BaseWindow.fromId((globalThis as any).remoteLayoutWindowId ?? -1) ?? BaseWindow.getAllWindows().find(window => window.isVisible())!
  ;(globalThis as any).remoteLayoutHits = (points: { x: number; y: number }[]) => new Promise(resolve => setImmediate(() => {
    let native = createRequire(import.meta.url)('../native-hit-test.node'), handle = inputWindow().getNativeWindowHandle()
    resolve(points.map(point => native.hit(handle, point.x, point.y)))
  }))
  ;(globalThis as any).remoteLayoutScroll = (point: { x: number; y: number }) => {
    let native = createRequire(import.meta.url)('../native-hit-test.node')
    native.scroll(inputWindow().getNativeWindowHandle(), point.x, point.y, -3)
    return native.hit(inputWindow().getNativeWindowHandle(), point.x, point.y)
  }
  ;(globalThis as any).remoteLayoutMouse = (point: { x: number; y: number; phase: number; modifier: number; direct?: boolean }) => new Promise<void>(resolve => setImmediate(() => {
    let native = createRequire(import.meta.url)('../native-hit-test.node')
    native.mouse(inputWindow().getNativeWindowHandle(), point.x, point.y, point.phase, point.modifier, point.direct ?? false)
    resolve()
  }))
  ;(globalThis as any).remoteLayoutTree = () => createRequire(import.meta.url)('../native-hit-test.node').tree(inputWindow().getNativeWindowHandle())
  ipcMain.handle('state', event => runtime.state(runtime.sourceClient(event.sender.id)))
  ipcMain.handle('command', (event, command) => ['record.list', 'record.status'].includes(command.method) ? [] : runtime.execute(command, runtime.sourceClient(event.sender.id)))
  ipcMain.on('bounds', (event, bounds) => runtime.setBounds(event.sender.id, bounds))
  app.on('before-quit', () => runtime.shutdown())
  await runtime.start(false)
})
