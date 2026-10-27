import { app } from 'electron'
import { createRemoteCapture } from '../../out/main/remote-capture.js'

if (process.platform === 'linux' && process.env.BMUX_TEST_WINDOW_MANAGER === 'none') {
  app.commandLine.removeSwitch('disable-dev-shm-usage')
  app.commandLine.removeSwitch('enable-features')
}
if (process.env.BMUX_TEST_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration()
app.setAppPath(process.cwd())
globalThis.createTestCapture = createRemoteCapture
globalThis.captureProcessFailures = []
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') globalThis.captureProcessFailures.push({ type: details.type, reason: details.reason, exitCode: details.exitCode })
})
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => globalThis.captureProcessFailures.push({ type: 'renderer', reason: details.reason, exitCode: details.exitCode }))
})
await import('../../out/main/index.js')
