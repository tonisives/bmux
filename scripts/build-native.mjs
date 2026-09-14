import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import headers from 'node-api-headers'

if (process.platform === 'darwin') {
  let architectures = { arm64: 'arm64', x64: 'x86_64' }
  let requestedArchitecture = process.env.BMUX_NATIVE_ARCH ?? process.arch
  let architecture = architectures[requestedArchitecture]
  if (!architecture) throw new Error(`Unsupported BMUX_NATIVE_ARCH: ${requestedArchitecture}`)
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  let output = path.join(root, 'out/native/pointer.node')
  await fs.mkdir(path.dirname(output), { recursive: true })
  execFileSync('/usr/bin/xcrun', [
    'clang', '-arch', architecture, '-bundle', '-undefined', 'dynamic_lookup', '-std=c11', '-O2',
    '-Wall', '-Wextra', '-Werror', '-DNAPI_VERSION=8', '-I', headers.include_dir,
    path.join(root, 'native/pointer.c'), '-framework', 'ApplicationServices', '-o', output,
  ], { stdio: 'inherit' })
}
