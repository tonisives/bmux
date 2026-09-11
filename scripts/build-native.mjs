import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import headers from 'node-api-headers'

if (process.platform === 'darwin') {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  let output = path.join(root, 'out/native/pointer.node')
  await fs.mkdir(path.dirname(output), { recursive: true })
  execFileSync('/usr/bin/xcrun', [
    'clang', '-bundle', '-undefined', 'dynamic_lookup', '-std=c11', '-O2',
    '-Wall', '-Wextra', '-Werror', '-DNAPI_VERSION=8', '-I', headers.include_dir,
    path.join(root, 'native/pointer.c'), '-framework', 'ApplicationServices', '-o', output,
  ], { stdio: 'inherit' })
}
