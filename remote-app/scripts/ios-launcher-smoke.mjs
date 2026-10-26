import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

let execute = promisify(execFile)
let output = path.resolve('ios-smoke')
let metroURL = 'http://localhost:19731'
let testResults = 'ios/launcher-build/LauncherTests.xcresult'
let { device } = JSON.parse(await readFile(path.join(output, 'device.json'), 'utf8'))
assert.equal(await fetch(`${metroURL}/status`, { signal: AbortSignal.timeout(2000) }).then(() => true).catch(() => false), false, 'The disposable Metro port must be free')
let sourceSha = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim()
if (process.env.GITHUB_SHA) assert.equal(sourceSha, process.env.GITHUB_SHA)
assert.equal((await execute('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim(), '', 'The Metro fixture must serve the committed checkout')
let sourceTree = (await execute('git', ['rev-parse', `${sourceSha}:remote-app/src`])).stdout.trim()
let metroLog = await open(path.join(output, 'metro.log'), 'w')
let metro = spawn('pnpm', ['exec', 'expo', 'start', '--dev-client', '--localhost', '--port', '19731', '--max-workers', '4'], {
  detached: true,
  stdio: ['ignore', metroLog.fd, metroLog.fd],
  env: { ...process.env, CI: '1', EXPO_PACKAGER_PROXY_URL: metroURL, EXPO_NO_TELEMETRY: '1' },
})
let result = { device, phase: 'metro', metroURL }
metro.once('exit', (code, signal) => { result.metroExit = { code, signal, at: new Date().toISOString() } })
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
  result.phase = 'metro-source'
  let manifestResponse = await fetch(metroURL, { headers: { accept: 'application/expo+json', 'expo-platform': 'ios' }, signal: AbortSignal.timeout(120_000) })
  assert.equal(manifestResponse.status, 200)
  let manifest = await manifestResponse.json()
  let bundleURL = new URL(manifest.launchAsset.url)
  assert.equal(bundleURL.origin, metroURL)
  let bundleResponse = await fetch(bundleURL, { signal: AbortSignal.timeout(180_000) })
  assert.equal(bundleResponse.status, 200)
  let bundle = Buffer.from(await bundleResponse.arrayBuffer())
  assert.ok(bundle.includes('Page details') && bundle.includes('Search sessions'), 'The fixture must serve the current companion UI')
  await writeFile(path.join(output, 'metro-source-proof.json'), JSON.stringify({
    sourceSha, sourceTree, workingDirectory: process.cwd(), metroURL, bundleURL: bundleURL.href,
    bundleSha256: createHash('sha256').update(bundle).digest('hex'), bundleBytes: bundle.length, fetchedAt: new Date().toISOString(),
  }, null, 2))
  result.sourceSha = sourceSha
  result.sourceTree = sourceTree
  result.phase = 'native-ui-tests'
  let log = await open(path.join(output, 'launcher-tests.log'), 'w')
  let monitoring = true
  result.metroHealth = { checks: 0, failures: [] }
  let monitor = (async () => {
    while (monitoring) {
      let at = new Date().toISOString()
      let ready = await fetch(`${metroURL}/status`, { signal: AbortSignal.timeout(2000) }).then(response => response.text()).then(text => text.includes('packager-status:running')).catch(() => false)
      result.metroHealth.checks++
      result.metroHealth.last = { at, ready }
      if (!ready) result.metroHealth.failures.push({ at, exitCode: metro.exitCode, signalCode: metro.signalCode })
      if (monitoring) await delay(1000)
    }
  })()
  try {
    let test = spawn('xcodebuild', ['test', '-project', 'ios/launcher/BMUXLauncherTests.xcodeproj', '-scheme', 'BMUXLauncherTests', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', 'ios/launcher-build', '-resultBundlePath', testResults, '-jobs', '4', '-parallel-testing-enabled', 'NO', 'CODE_SIGNING_ALLOWED=NO'], { stdio: ['ignore', log.fd, log.fd], timeout: 480_000 })
    let startedAt = Date.now()
    result.nativeTestProcess = await new Promise((resolve, reject) => { test.once('error', reject); test.once('exit', (code, signal) => resolve({ code, signal, elapsedMs: Date.now() - startedAt })) })
    let summary = await execute('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', testResults]).then(({ stdout }) => JSON.parse(stdout)).catch(error => { result.summaryError = error.message })
    if (summary) await writeFile(path.join(output, 'launcher-summary.json'), JSON.stringify(summary, null, 2))
    assert.equal(result.nativeTestProcess.code, 0, `The native server chooser tests must pass (signal: ${result.nativeTestProcess.signal ?? 'none'}); see launcher-tests.log`)
    assert.ok(summary, 'The native chooser test must produce a result summary')
    assert.equal(summary.totalTestCount, 1, 'The native chooser test must execute')
    assert.equal(summary.passedTests, 1)
    assert.equal(summary.failedTests, 0)
    assert.equal(summary.skippedTests, 0)
    result.phase = 'complete'
  } finally {
    monitoring = false
    await monitor
    await log.close()
  }
} catch (error) {
  result.error = error.message
  throw error
} finally {
  let cleanupError
  result.metroBeforeCleanup = { exitCode: metro.exitCode, signalCode: metro.signalCode }
  if (metro.pid) {
    try { process.kill(-metro.pid, 'SIGTERM') } catch (error) {
      if (error.code !== 'ESRCH') { cleanupError = error; result.metroCleanupError = error.message }
    }
  }
  await metroLog.close()
  try {
    let predicate = 'process == "bmuxremote" AND (eventMessage CONTAINS[c] "transport" OR eventMessage CONTAINS[c] "font" OR eventMessage CONTAINS[c] "asset" OR eventMessage CONTAINS[c] "localhost" OR eventMessage CONTAINS[c] "load")'
    let logs = await execute('xcrun', ['simctl', 'spawn', device, 'log', 'show', '--style', 'compact', '--last', '10m', '--info', '--predicate', predicate], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
    await writeFile(path.join(output, 'native-asset-logs.txt'), logs.stdout)
  } catch (error) { result.nativeAssetLogError = error.message }
  await execute('xcrun', ['xcresulttool', 'export', 'attachments', '--path', testResults, '--output-path', path.join(output, 'ui')], { timeout: 30_000 }).catch(error => { result.attachmentExportError = error.message })
  result.completedAt = new Date().toISOString()
  await writeFile(path.join(output, 'launcher-result.json'), JSON.stringify(result, null, 2))
  if (cleanupError && result.phase === 'complete') throw cleanupError
}
