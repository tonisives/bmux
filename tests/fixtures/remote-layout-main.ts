import { app, BaseWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { createRuntime } from '../../src/main/runtime'

;(app as any).setAppPath(process.cwd())
app.setPath('userData', process.env.BMUX_DATA_DIR!)
void app.whenReady().then(async () => {
  let runtime = createRuntime(process.env.BMUX_DATA_DIR!)
  ;(globalThis as any).remoteLayoutRuntime = runtime
  ;(globalThis as any).remoteLayoutHits = (points: { x: number; y: number }[]) => new Promise(resolve => setImmediate(() => {
    let native = createRequire(import.meta.url)('../native-hit-test.node'), handle = BaseWindow.getAllWindows().find(window => window.isVisible())!.getNativeWindowHandle()
    resolve(points.map(point => native.hit(handle, point.x, point.y)))
  }))
  ;(globalThis as any).remoteLayoutScroll = (point: { x: number; y: number }) => {
    let native = createRequire(import.meta.url)('../native-hit-test.node')
    native.scroll(BaseWindow.getAllWindows().find(window => window.isVisible())!.getNativeWindowHandle(), point.x, point.y, -3)
    return native.hit(BaseWindow.getAllWindows().find(window => window.isVisible())!.getNativeWindowHandle(), point.x, point.y)
  }
  ;(globalThis as any).remoteLayoutTree = () => createRequire(import.meta.url)('../native-hit-test.node').tree(BaseWindow.getAllWindows().find(window => window.isVisible())!.getNativeWindowHandle())
  ipcMain.handle('state', event => runtime.state(runtime.sourceClient(event.sender.id)))
  ipcMain.handle('command', (event, command) => ['record.list', 'record.status'].includes(command.method) ? [] : runtime.execute(command, runtime.sourceClient(event.sender.id)))
  ipcMain.on('bounds', (event, bounds) => runtime.setBounds(event.sender.id, bounds))
  app.on('will-quit', () => runtime.shutdown())
  await runtime.start(false)
})
