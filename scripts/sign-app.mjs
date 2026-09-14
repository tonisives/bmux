import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
export let signApp = async (app) => {
  let configured = process.env.BMUX_SIGNING_IDENTITY?.trim()
  let identity = configured || process.env.BMUX_DEFAULT_SIGNING_IDENTITY?.trim()
  if (!identity) return false
  let entitlements = path.resolve('build', 'entitlements.mac.plist')
  await fs.access(path.join(app, 'Contents', 'MacOS', 'bmux'), fs.constants.X_OK)

  let { stdout } = await exec('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])
  if (!stdout.includes(identity)) {
    if (configured) throw new Error(`Configured bmux signing identity is unavailable: ${identity}`)
    console.log('Skipped macOS signing because the bmux Developer ID identity is unavailable')
    return false
  }

  await exec('/usr/bin/codesign', ['--deep', '--force', '--timestamp', '--options', 'runtime', '--entitlements', entitlements, '--sign', identity, app])
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  console.log(`Signed ${app}`)
  return true
}
