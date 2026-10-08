import { expect, test } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'

test('release metadata must identify the correct architecture and exact downloaded bytes', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-update-metadata-'))
  let file = path.join(directory, 'latest-arm64-mac.yml')
  let archive = path.join(directory, 'bmux-0.2.0-arm64.zip')
  let data = Buffer.from('fixture archive')
  let metadata = { version: '0.2.0', files: [{ url: path.basename(archive), size: data.length, sha512: createHash('sha512').update(data).digest('base64') }] }
  let verify = (arch = 'arm64') => promisify(execFile)(process.execPath, [path.resolve('scripts/verify-update-metadata.mjs'), file, '0.2.0', arch])
  try {
    await fs.writeFile(archive, data)
    await fs.writeFile(file, stringify(metadata))
    await expect(verify()).resolves.toMatchObject({ stdout: expect.stringContaining('Verified') })
    await expect(verify('x64')).rejects.toThrow('Update ZIP is missing')
    await fs.writeFile(archive, 'tampered bytes')
    await expect(verify()).rejects.toThrow()
    await fs.writeFile(archive, data)
    await fs.writeFile(file, stringify({ ...metadata, version: '0.3.0' }))
    await expect(verify()).rejects.toThrow()
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
