import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

let execute = promisify(execFile)
let output = path.resolve('ios-smoke')
let app = path.resolve('ios/build/Build/Products/Release-iphonesimulator/bmuxremote.app')
let bundle = 'cc.bmux.remote'
let stateFile = path.join(output, 'device.json')
let screenshot = path.join(output, 'ios-launch.png')
await mkdir(output, { recursive: true })

let run = async (command, args, timeout = 180_000) => {
  let started = Date.now()
  let record = { command, args, startedAt: new Date(started).toISOString() }
  console.log(`Starting ${command} ${args.join(' ')}`)
  try {
    let { stdout, stderr } = await execute(command, args, { timeout, maxBuffer: 8 * 1024 * 1024 })
    Object.assign(record, { stdout: stdout.slice(-16_000), stderr: stderr.slice(-16_000), code: 0 })
    return stdout.trim()
  } catch (error) {
    Object.assign(record, { stdout: error.stdout?.slice(-16_000), stderr: error.stderr?.slice(-16_000), code: error.code, signal: error.signal, killed: error.killed })
    throw error
  } finally {
    record.durationMs = Date.now() - started
    await appendFile(path.join(output, 'commands.jsonl'), JSON.stringify(record) + '\n')
    console.log(`Finished ${command} ${args.join(' ')} in ${record.durationMs}ms`)
  }
}
let simctl = (...args) => run('xcrun', ['simctl', ...args])

if (process.argv[2] === 'prepare') {
  await writeFile(path.join(output, 'runtimes.txt'), await simctl('runtime', 'list'))
  let { runtimes } = JSON.parse(await simctl('list', 'runtimes', '--json'))
  let runtime = runtimes.find(value => value.isAvailable && value.identifier.includes('.iOS-') && value.version.startsWith('27.'))
  assert.ok(runtime, 'The startup regression must run on an iOS 27 simulator')
  let device = await simctl('create', `bmux-launch-${process.pid}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime.identifier)
  await writeFile(stateFile, JSON.stringify({ device, runtime: runtime.version, bundle, startedAt: new Date().toISOString() }))
  await simctl('boot', device)
} else if (process.argv[2] === 'cleanup') {
  let state = await readFile(stateFile, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  if (state && !state.cleanedAt) {
    await run('xcrun', ['simctl', 'shutdown', state.device], 30_000).catch(() => {})
    await run('xcrun', ['simctl', 'delete', state.device], 30_000)
    state.cleanedAt = new Date().toISOString()
    await writeFile(stateFile, JSON.stringify(state, null, 2))
  }
} else {
  let state = JSON.parse(await readFile(stateFile, 'utf8'))
  let { device } = state
  let result = { ...state, phase: 'boot' }
  let captured = false
  try {
    await simctl('bootstatus', device, '-b')
    result.phase = 'installation-service'
    await run('xcrun', ['simctl', 'listapps', device], 60_000)
    result.phase = 'install'
    await simctl('install', device, app)
    await simctl('get_app_container', device, bundle, 'app')
    result.phase = 'launch'
    let launch = await simctl('launch', '--terminate-running-process', device, bundle)
    let pid = Number(launch.match(/cc\.bmux\.remote:\s*(\d+)/)?.[1])
    assert.ok(pid, `The app must launch: ${launch}`)
    result.pid = pid
    result.phase = 'process-survival'
    let started = Date.now()
    while (Date.now() - started < 10_000) {
      let { stdout } = await execute('ps', ['-ww', '-p', String(pid), '-o', 'stat=,comm='], { timeout: 5000 })
      assert.match(stdout, /bmuxremote\.app\/bmuxremote/, 'The app process must remain alive after launch')
      assert.doesNotMatch(stdout.trim(), /^Z/, 'The app process must remain running')
      await delay(250)
    }
    result.survivedMs = Date.now() - started
    result.phase = 'screenshot'
    await run('xcrun', ['simctl', 'io', device, 'screenshot', screenshot], 30_000)
    captured = true
    result.phase = 'complete'
    console.log(`iOS ${state.runtime}: ${bundle} remained running for ${result.survivedMs}ms`)
  } catch (error) {
    result.error = { message: error.message, code: error.code, signal: error.signal, killed: error.killed }
    let logs = await run('xcrun', ['simctl', 'spawn', device, 'log', 'show', '--last', '3m', '--style', 'compact', '--predicate', 'process == "installd" OR process == "installcoordinationd" OR process == "bmuxremote"'], 30_000).catch(error => error.message)
    await writeFile(path.join(output, 'simulator.log'), logs)
    throw error
  } finally {
    if (!captured) await run('xcrun', ['simctl', 'io', device, 'screenshot', screenshot], 30_000).catch(() => {})
    result.completedAt = new Date().toISOString()
    await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  }
}
