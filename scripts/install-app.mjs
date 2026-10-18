import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

let exec = promisify(execFile)
let script = fileURLToPath(import.meta.url)
let pendingFile = directory => path.join(directory, '.bmux-pending.json')
let readPending = directory => fs.readFile(pendingFile(directory), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })

export let runningApp = async destination => {
  // Read executable names, never arguments or environment variables.
  let { stdout } = await exec('/bin/ps', ['-axo', 'comm='])
  for (let command of stdout.split('\n')) {
    let executable = command.trim(), index = executable.indexOf('/bmux.app/Contents/')
    if (index < 0) continue
    let app = executable.slice(0, index + '/bmux.app'.length)
    // ps may retain /var or a symlink used to launch the app.
    if (app === destination || await fs.realpath(app).catch(() => undefined) === destination) return true
  }
  return false
}

let locked = async (directory, action) => {
  let lock = path.join(directory, '.bmux-install.lock'), started = Date.now(), handle
  while (!handle) {
    try { handle = await fs.open(lock, 'wx') }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (Date.now() - started > 10000) throw new Error(`Installation lock is busy: ${lock}`)
      await delay(100)
    }
  }
  try { return await action() }
  finally { await handle.close(); await fs.unlink(lock) }
}

let promote = async (temporary, destination) => {
  let staged = path.join(temporary, 'bmux.app'), previous = path.join(temporary, 'previous.app'), backedUp = false
  try { await fs.rename(destination, previous); backedUp = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await fs.rename(staged, destination) }
  catch (error) {
    if (backedUp) {
      try { await fs.rename(previous, destination) }
      catch (restoreError) { throw new AggregateError([error, restoreError], `Installation and rollback failed; files preserved at ${temporary}`) }
    }
    throw error
  }
}

export let finishPendingInstall = async (temporary, destination, { running = runningApp, wait = () => delay(1000) } = {}) => {
  let directory = path.dirname(destination)
  for (;;) {
    if ((await readPending(directory))?.temporary !== temporary) {
      await fs.rm(temporary, { recursive: true, force: true })
      return false
    }
    if (!await running(destination)) {
      let installed = await locked(directory, async () => {
        if ((await readPending(directory))?.temporary !== temporary || await running(destination)) return false
        await promote(temporary, destination)
        await fs.unlink(pendingFile(directory))
        return true
      })
      if (installed) {
        await fs.rm(temporary, { recursive: true, force: true })
        return true
      }
    }
    await wait()
  }
}

let deferInstall = async (temporary, destination) => {
  // Copy the worker so cleaning up a task worktree cannot remove its code.
  let worker = path.join(temporary, 'install.mjs')
  await fs.copyFile(script, worker)
  let log = await fs.open(path.join(temporary, 'install.log'), 'a')
  try {
    let child = spawn(process.execPath, [worker, '--wait-for-exit', temporary, destination], { detached: true, stdio: ['ignore', log.fd, log.fd] })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
  } finally { await log.close() }
}

export let installApp = async ({ source, directory, sign, running = runningApp, defer = deferInstall, copy = (from, to) => exec('/usr/bin/ditto', [from, to]) }) => {
  source = await fs.realpath(source)
  await fs.access(path.join(source, 'Contents', 'MacOS', 'bmux'), fs.constants.X_OK)
  await fs.mkdir(directory, { recursive: true })
  directory = await fs.realpath(directory)
  let destination = path.join(directory, 'bmux.app')
  if (source === destination) return { destination, deferred: false }
  let temporary = await fs.mkdtemp(path.join(directory, '.bmux-install-')), queued = false, installed = false
  try {
    let staged = path.join(temporary, 'bmux.app')
    await copy(source, staged)
    // Never expose an incompletely signed bundle or alter a running app's path.
    await sign(staged)
    let deferred = await locked(directory, async () => {
      if (await running(destination)) {
        let pending = path.join(temporary, 'pending.json')
        await fs.writeFile(pending, JSON.stringify({ temporary, destination }))
        await fs.rename(pending, pendingFile(directory))
        queued = true
        return true
      }
      await promote(temporary, destination)
      installed = true
      await fs.rm(pendingFile(directory), { force: true })
      return false
    })
    if (deferred) await defer(temporary, destination)
    return { destination, deferred, ...(deferred ? { temporary } : {}) }
  } finally {
    // A queued worker owns its stage. Keep rollback material if promotion failed.
    if (!queued && (installed || !await fs.stat(path.join(temporary, 'previous.app')).then(() => true, () => false))) await fs.rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  if (process.argv[2] === '--wait-for-exit') {
    let installed = await finishPendingInstall(process.argv[3], process.argv[4])
    if (installed) console.log(`Installed ${process.argv[4]}`)
  } else {
    let explicitSource = process.argv[2] === '--source' ? process.argv[3] : undefined
    let source = path.resolve(explicitSource ?? path.join('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'bmux.app'))
    let { signApp } = await import('./sign-app.mjs')
    let result = await installApp({ source, directory: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build'), sign: async staged => {
      await signApp(staged)
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged])
    } })
    if (!explicitSource && await fs.realpath(source) !== result.destination) await fs.rm(source, { recursive: true })
    console.log(result.deferred ? `Queued ${result.destination}; installation will finish after bmux exits. Staged files: ${result.temporary}` : `Installed ${result.destination}`)
  }
}
