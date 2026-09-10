import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let source = path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'bmux.app')
let directory = path.join(os.homedir(), 'workspace', '_tools')
let destination = path.join(directory, 'bmux.app')
let legacyDestination = path.join(directory, 'Browmux.app')
await fs.access(path.join(source, 'Contents', 'MacOS', 'bmux'), fs.constants.X_OK)
await fs.mkdir(directory, { recursive: true })
let temporary = await fs.mkdtemp(path.join(directory, '.bmux-install-'))
let staged = path.join(temporary, 'bmux.app')
let previous = path.join(temporary, 'previous.app')
let backedUp = false
try {
  await promisify(execFile)('/usr/bin/ditto', [source, staged])
  try { await fs.rename(destination, previous); backedUp = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await fs.rename(staged, destination) } catch (error) {
    if (backedUp) await fs.rename(previous, destination)
    throw error
  }
  await fs.rm(legacyDestination, { recursive: true, force: true })
  await fs.rm(source, { recursive: true })
  console.log(`Installed ${destination}`)
} finally {
  // Preserve the previous bundle if restoring it failed.
  if (backedUp) {
    try { await fs.access(destination) } catch { console.error(`Previous app preserved at ${previous}`); process.exitCode = 1 }
  }
  if (!process.exitCode) await fs.rm(temporary, { recursive: true, force: true })
}
