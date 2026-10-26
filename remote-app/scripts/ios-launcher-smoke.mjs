import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

let execute = promisify(execFile)
let output = path.resolve('ios-smoke')
let metroURL = 'http://localhost:19731'
let { device } = JSON.parse(await readFile(path.join(output, 'device.json'), 'utf8'))
let metroLog = await open(path.join(output, 'metro.log'), 'w')
let metro = spawn('pnpm', ['exec', 'expo', 'start', '--dev-client', '--localhost', '--port', '19731', '--max-workers', '4'], {
  detached: true,
  stdio: ['ignore', metroLog.fd, metroLog.fd],
  env: { ...process.env, CI: '1', EXPO_PACKAGER_PROXY_URL: metroURL, EXPO_NO_TELEMETRY: '1' },
})
let result = { device, phase: 'metro', metroURL }
try {
  await new Promise((resolve, reject) => { metro.once('spawn', resolve); metro.once('error', reject) })
  let deadline = Date.now() + 120_000
  while (true) {
    let ready = await fetch(`${metroURL}/status`, { signal: AbortSignal.timeout(2000) }).then(response => response.text()).then(text => text.includes('packager-status:running')).catch(() => false)
    if (ready) break
    assert.equal(metro.exitCode, null, 'The disposable Metro server must remain running')
    assert.ok(Date.now() < deadline, 'The disposable Metro server must become ready')
    await delay(250)
  }
  result.phase = 'native-ui-tests'
  let log = await open(path.join(output, 'launcher-tests.log'), 'w')
  try {
    let test = spawn('xcodebuild', ['test', '-workspace', 'ios/bmuxremote.xcworkspace', '-scheme', 'BMUXLauncherTests', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', 'ios/build', '-resultBundlePath', 'ios/build/LauncherTests.xcresult', '-jobs', '4', '-parallel-testing-enabled', 'NO', 'CODE_SIGNING_ALLOWED=NO', '-quiet'], { stdio: ['ignore', log.fd, log.fd], timeout: 480_000 })
    let code = await new Promise((resolve, reject) => { test.once('error', reject); test.once('exit', resolve) })
    assert.equal(code, 0, 'The native server chooser tests must pass; see launcher-tests.log')
    result.phase = 'complete'
  } finally {
    await log.close()
  }
} catch (error) {
  result.error = error.message
  throw error
} finally {
  let cleanupError
  if (metro.pid) {
    try { process.kill(-metro.pid, 'SIGTERM') } catch (error) {
      if (error.code !== 'ESRCH') { cleanupError = error; result.metroCleanupError = error.message }
    }
  }
  await metroLog.close()
  await execute('xcrun', ['xcresulttool', 'export', 'attachments', '--path', 'ios/build/LauncherTests.xcresult', '--output-path', path.join(output, 'ui')], { timeout: 30_000 }).catch(error => { result.attachmentExportError = error.message })
  result.completedAt = new Date().toISOString()
  await writeFile(path.join(output, 'launcher-result.json'), JSON.stringify(result, null, 2))
  if (cleanupError && result.phase === 'complete') throw cleanupError
}
