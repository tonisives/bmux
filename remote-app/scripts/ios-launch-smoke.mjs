import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

let execute = promisify(execFile)
let simctl = async (...args) => (await execute('xcrun', ['simctl', ...args], { timeout: 180_000 })).stdout.trim()
let output = path.resolve('ios-smoke')
let app = path.resolve('ios/build/Build/Products/Release-iphonesimulator/bmuxremote.app')
let bundle = 'cc.bmux.remote'
let { runtimes } = JSON.parse(await simctl('list', 'runtimes', '--json'))
let runtime = runtimes.find(value => value.isAvailable && value.identifier.includes('.iOS-') && value.version.startsWith('27.'))
assert.ok(runtime, 'The startup regression must run on an iOS 27 simulator')
let device = await simctl('create', `bmux-launch-${process.pid}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime.identifier)
let result = { runtime: runtime.version, bundle, startedAt: new Date().toISOString() }
let screenshot = path.join(output, 'ios-launch.png')
let booted = false
let captured = false
await mkdir(output, { recursive: true })
try {
  await simctl('boot', device)
  booted = true
  await simctl('bootstatus', device, '-b')
  await simctl('install', device, app)
  let launch = await simctl('launch', '--terminate-running-process', device, bundle)
  let pid = Number(launch.match(/cc\.bmux\.remote:\s*(\d+)/)?.[1])
  assert.ok(pid, `The app must launch: ${launch}`)
  result.pid = pid
  let started = Date.now()
  while (Date.now() - started < 10_000) {
    let { stdout } = await execute('ps', ['-ww', '-p', String(pid), '-o', 'stat=,comm='], { timeout: 5000 })
    assert.match(stdout, /bmuxremote\.app\/bmuxremote/, 'The app process must remain alive after launch')
    assert.doesNotMatch(stdout.trim(), /^Z/, 'The app process must remain running')
    await delay(250)
  }
  result.survivedMs = Date.now() - started
  await simctl('io', device, 'screenshot', screenshot)
  captured = true
  console.log(`iOS ${runtime.version}: ${bundle} remained running for ${result.survivedMs}ms`)
} catch (error) {
  result.error = error.message
  throw error
} finally {
  if (booted && !captured) await simctl('io', device, 'screenshot', screenshot).catch(() => {})
  result.completedAt = new Date().toISOString()
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  await simctl('shutdown', device).catch(() => {})
  await simctl('delete', device)
}
