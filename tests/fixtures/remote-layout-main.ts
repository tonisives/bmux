import { app, BaseWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { createRuntime } from '../../src/main/runtime'

;(app as any).setAppPath(process.cwd())
app.setPath('userData', process.env.BMUX_DATA_DIR!)
void app.whenReady().then(async () => {
  let runtime = createRuntime(process.env.BMUX_DATA_DIR!)
  ;(globalThis as any).remoteLayoutRuntime = runtime
  ;(globalThis as any).remoteLayoutHit = (x: number, y: number) => createRequire(import.meta.url)('../native-hit-test.node').hit(BaseWindow.getAllWindows().find(window => window.isVisible())!.getNativeWindowHandle(), x, y)
  ipcMain.handle('state', event => runtime.state(runtime.sourceClient(event.sender.id)))
  ipcMain.handle('command', (event, command) => runtime.execute(command, runtime.sourceClient(event.sender.id)))
  ipcMain.on('bounds', (event, bounds) => runtime.setBounds(event.sender.id, bounds))
  app.on('will-quit', () => runtime.shutdown())
  await runtime.start(false)
})
