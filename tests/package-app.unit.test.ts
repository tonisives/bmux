import { test, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
let script = path.resolve('scripts/package-app.sh')

test('holds the build marker throughout packaging and clears it after success or failure', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-package-test-'))
  try {
    let bin = path.join(directory, 'bin'), output = path.join(directory, 'tools')
    await fs.mkdir(bin)
    await fs.writeFile(path.join(bin, 'python3'), `#!/bin/sh
test "$1" = scripts/build-local.py || exit 91
test -d "$BMUX_OUTPUT_DIR/.bmux-build.lock" || exit 92
test ! -e "$BMUX_OUTPUT_DIR/.bmux-build-failed" || exit 93
test "\${TEST_EXIT:-0}" = 0 || exit "$TEST_EXIT"
mkdir -p "$TEST_BUNDLE"
`, { mode: 0o755 })
    await fs.writeFile(path.join(bin, 'node'), `#!/bin/sh
test "$1" = scripts/install-app.mjs || exit 94
test "$2" = --source || exit 95
test -d "$BMUX_OUTPUT_DIR/.bmux-build.lock" || exit 96
test -d "$TEST_BUNDLE" || exit 97
exit 0
`, { mode: 0o755 })
    let bundle = path.join(directory, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'bmux.app')
    let env = { ...process.env, TEST_BUNDLE: bundle, PATH: `${bin}:${process.env.PATH}`, BMUX_OUTPUT_DIR: output }
    let run = (extra = {}) => exec('/bin/sh', [script], { cwd: directory, env: { ...env, ...extra } })
    await run()
    await expect(fs.access(bundle)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readdir(output)).toEqual([])
    await expect(run({ TEST_EXIT: '7' })).rejects.toMatchObject({ code: 7 })
    expect(await fs.readdir(output)).toEqual(['.bmux-build-failed'])
    expect(await fs.readFile(path.join(output, '.bmux-build-failed'), 'utf8')).toContain('exit 7')
    await run()
    expect(await fs.readdir(output)).toEqual([])
    await fs.mkdir(path.join(output, '.bmux-build.lock'))
    await expect(run()).rejects.toThrow('already in progress')
    expect(await fs.readdir(output)).toEqual(['.bmux-build.lock'])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
