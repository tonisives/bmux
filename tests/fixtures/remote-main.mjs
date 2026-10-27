import { app } from 'electron'
import fs from 'node:fs'
import { createRemoteCapture } from '../../out/main/remote-capture.js'

if (process.platform === 'linux' && process.env.BMUX_TEST_WINDOW_MANAGER === 'none') {
  app.commandLine.removeSwitch('disable-dev-shm-usage')
  app.commandLine.removeSwitch('enable-features')
}
if (process.env.BMUX_TEST_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration()
app.setAppPath(process.cwd())
globalThis.createTestCapture = createRemoteCapture
globalThis.captureProcessFailures = []
globalThis.captureResources = () => process.platform !== 'linux' ? undefined : {
  filesystems: Object.fromEntries(['/dev/shm', '/tmp'].map(directory => { let status = fs.statfsSync(directory); return [directory, { type: status.type.toString(16), totalBytes: status.bsize * status.blocks, availableBytes: status.bsize * status.bavail }] })),
  memory: Object.fromEntries(['memory.current', 'memory.max', 'memory.peak', 'memory.events'].filter(name => fs.existsSync(`/sys/fs/cgroup/${name}`)).map(name => [name, fs.readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim()])),
}
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') globalThis.captureProcessFailures.push({ type: details.type, reason: details.reason, exitCode: details.exitCode })
})
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => globalThis.captureProcessFailures.push({ type: 'renderer', reason: details.reason, exitCode: details.exitCode }))
})
await import('../../out/main/index.js')
