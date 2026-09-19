import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 2026.7.0 and 2026.8.0 can sync encrypted ciphers but leave the decrypted
// vault empty for affected accounts. Keep the last known-good browser build
// until Bitwarden ships the upstream WASM decryption fix.
let version = '2026.6.1'
let digest = 'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e'
export let installBitwardenExtension = async (directory: string, installedPath?: string) => {
  let root = path.join(directory, 'extension-packages')
  let target = installedPath ? path.resolve(installedPath) : path.join(root, 'bitwarden')
  if (path.dirname(target) !== path.resolve(root) || !/^bitwarden(?:-|$)/.test(path.basename(target))) throw new Error('Existing Bitwarden package path is invalid')
  try {
    let manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'))
    if (manifest.version === version) return target
  } catch { /* First installation or an incomplete package. */ }
  await fs.mkdir(root, { recursive: true })
  let temporary = await fs.mkdtemp(path.join(root, '.bitwarden-'))
  let backup = `${temporary}-previous`
  let movedPrevious = false
  try {
    let response = await fetch(`https://github.com/bitwarden/clients/releases/download/browser-v${version}/dist-chrome-${version}.zip`, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Bitwarden download failed (${response.status})`)
    let archive = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(archive).digest('hex') !== digest) throw new Error('Bitwarden download checksum did not match')
    let zip = path.join(temporary, 'extension.zip'), unpacked = path.join(temporary, 'unpacked')
    await fs.writeFile(zip, archive, { mode: 0o600 })
    await promisify(execFile)('/usr/bin/unzip', ['-q', zip, '-d', unpacked], { timeout: 30000 })
    try { await fs.rename(target, backup); movedPrevious = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    try { await fs.rename(unpacked, target) } catch (error) {
      if (movedPrevious) await fs.rename(backup, target)
      throw error
    }
    if (movedPrevious) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
    return target
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}
