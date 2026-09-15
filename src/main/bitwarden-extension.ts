import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Official browser-v2026.8.0 release asset and its GitHub SHA-256 digest.
let version = '2026.8.0'
let digest = '867b5a671ae40f3122b79b580841de9dc37c84b83dd13d34e971fc986e36d6c0'
export let installBitwardenExtension = async (directory: string) => {
  let root = path.join(directory, 'extension-packages')
  let target = path.join(root, `bitwarden-${version}`)
  try { await fs.access(path.join(target, 'manifest.json')); return target } catch { /* First installation. */ }
  await fs.mkdir(root, { recursive: true })
  let temporary = await fs.mkdtemp(path.join(root, '.bitwarden-'))
  try {
    let response = await fetch(`https://github.com/bitwarden/clients/releases/download/browser-v${version}/dist-chrome-${version}.zip`, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Bitwarden download failed (${response.status})`)
    let archive = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(archive).digest('hex') !== digest) throw new Error('Bitwarden download checksum did not match')
    let zip = path.join(temporary, 'extension.zip'), unpacked = path.join(temporary, 'unpacked')
    await fs.writeFile(zip, archive, { mode: 0o600 })
    await promisify(execFile)('/usr/bin/unzip', ['-q', zip, '-d', unpacked], { timeout: 30000 })
    await fs.rename(unpacked, target)
    return target
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}
