import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { signApp } from './sign-app.mjs'

let source = await fs.realpath(path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'bmux.app'))
let directory = path.resolve(process.env.BMUX_OUTPUT_DIR || 'build')
await fs.access(path.join(source, 'Contents', 'MacOS', 'bmux'), fs.constants.X_OK)
await fs.mkdir(directory, { recursive: true })
directory = await fs.realpath(directory)
let destination = path.join(directory, 'bmux.app')
if (source === destination) {
  console.log(`Built ${destination}`)
  process.exit(0)
}
let temporary = await fs.mkdtemp(path.join(directory, '.bmux-install-'))
let staged = path.join(temporary, 'bmux.app')
let previous = path.join(temporary, 'previous.app')
let backedUp = false
let installed = false
let preserveTemporary = false
try {
  await promisify(execFile)('/usr/bin/ditto', [source, staged])
  try { await fs.rename(destination, previous); backedUp = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  try {
    await fs.rename(staged, destination)
    installed = true
    await signApp(destination)
  } catch (error) {
    try {
      if (installed) await fs.rm(destination, { recursive: true, force: true })
      if (backedUp) {
        await fs.rename(previous, destination)
        backedUp = false
      }
    } catch (restoreError) {
      preserveTemporary = true
      throw new AggregateError([error, restoreError], `Failed to install ${destination} and restore the previous app`)
    }
    throw error
  }
  await fs.rm(source, { recursive: true })
  console.log(`Installed ${destination}`)
} finally {
  if (preserveTemporary) {
    console.error(`Installation files preserved at ${temporary}`)
  } else {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
