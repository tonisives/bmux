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
exit "\${TEST_EXIT:-0}"
`, { mode: 0o755 })
    await fs.writeFile(path.join(bin, 'node'), `#!/bin/sh
test "$1" = scripts/install-app.mjs || exit 94
test "$2" = --source || exit 95
test -d "$BMUX_OUTPUT_DIR/.bmux-build.lock" || exit 96
exit 0
`, { mode: 0o755 })
    let env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BMUX_OUTPUT_DIR: output }
    let run = (extra = {}) => exec('/bin/sh', [script], { env: { ...env, ...extra } })
    await run()
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
