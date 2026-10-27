import { app, dialog } from 'electron'
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
globalThis.captureFetchCalls = 0
let fetch = globalThis.fetch
globalThis.fetch = (...args) => { globalThis.captureFetchCalls++; return Reflect.apply(fetch, globalThis, args) }
globalThis.captureResources = () => process.platform !== 'linux' ? undefined : {
  filesystems: Object.fromEntries(['/dev/shm', '/tmp'].map(directory => { let status = fs.statfsSync(directory); return [directory, { type: status.type.toString(16), totalBytes: status.bsize * status.blocks, availableBytes: status.bsize * status.bavail }] })),
  memory: Object.fromEntries(['memory.current', 'memory.max', 'memory.peak', 'memory.events'].filter(name => fs.existsSync(`/sys/fs/cgroup/${name}`)).map(name => [name, fs.readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim()])),
}
let showErrorBox = dialog.showErrorBox
dialog.showErrorBox = (title, content) => {
  fs.appendFileSync(`${process.env.BMUX_DATA_DIR}/test-native-errors.log`, `${title}\n${content}\n`.replace(/[a-f0-9]{24,}/gi, '[redacted]'), { mode: 0o600 })
  return Reflect.apply(showErrorBox, dialog, [title, content])
}
if (process.platform === 'linux' && process.env.BMUX_NATIVE_CRASH_DIAGNOSTICS === '1') {
  setInterval(() => fs.writeFileSync(`${process.env.BMUX_DATA_DIR}/test-main-heartbeat.json`, JSON.stringify({ time: Date.now() }), { mode: 0o600 }), 1000).unref()
}
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') globalThis.captureProcessFailures.push({ type: details.type, reason: details.reason, exitCode: details.exitCode })
})
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => globalThis.captureProcessFailures.push({ type: 'renderer', reason: details.reason, exitCode: details.exitCode }))
})
await import('../../out/main/index.js')
