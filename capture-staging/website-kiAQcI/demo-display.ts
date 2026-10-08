import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let exec = promisify(execFile)

export let prepareDemoDisplay = async () => {
  if (process.env.BMUX_TEST_NATIVE !== '1') throw new Error('Use the Tart runner.')
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-demo-display-'))
  try {
    let binary = path.join(directory, 'display')
    await exec('/usr/bin/clang', [fileURLToPath(new URL('./demo-display.c', import.meta.url)), '-framework', 'CoreGraphics', '-framework', 'CoreFoundation', '-o', binary])
    console.log((await exec(binary)).stdout.trim())
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}
