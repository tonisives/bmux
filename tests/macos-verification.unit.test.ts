import { test, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)

test.each([
  { mode: 'recover', status: 0, calls: 4, waits: 2 },
  { mode: 'network', status: 68, calls: 3, waits: 2 },
  { mode: 'invalid', status: 68, calls: 1, waits: 0 },
  { mode: 'other', status: 65, calls: 1, waits: 0 },
])('macOS ticket verification: $mode', async ({ mode, status, calls, waits }) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-ticket-test-'))
  try {
    let bin = path.join(directory, 'bin'), count = path.join(directory, 'calls'), delays = path.join(directory, 'waits')
    await fs.mkdir(bin)
    let stub = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const tool = path.basename(process.argv[1]), args = process.argv.slice(2);
const app = root => { let folder = path.join(root, 'bmux.app/Contents/_CodeSignature'); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'CodeResources'), 'signed fixture'); };
if (tool === 'hdiutil' && args[0] === 'attach') app(args.at(-1));
if (tool === 'hdiutil' && args[0] === 'detach') fs.rmSync(path.join(args[1], 'bmux.app'), { recursive: true, force: true });
if (tool === 'ditto') app(args.at(-1));
if (tool === 'sleep') fs.appendFileSync(process.env.TEST_WAITS, 'wait\\n');
if (tool === 'xcrun') {
  let count = Number(fs.existsSync(process.env.TEST_COUNT) ? fs.readFileSync(process.env.TEST_COUNT, 'utf8') : 0) + 1;
  fs.writeFileSync(process.env.TEST_COUNT, String(count));
  let mode = process.env.TEST_TICKET_MODE;
  if (mode === 'recover' && count > 2) process.exit(0);
  if (mode === 'recover' || mode === 'network') console.error('Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."');
  else console.error('The validate action failed: invalid ticket');
  process.exit(mode === 'other' ? 65 : 68);
}
`
    for (let tool of ['codesign', 'hdiutil', 'ditto', 'xcrun', 'spctl', 'lipo', 'sleep']) await fs.writeFile(path.join(bin, tool), stub, { mode: 0o755 })
    let result = await exec('bash', ['scripts/verify-macos-dmg.sh', 'release/bmux-fixture-arm64.dmg', 'arm64'], {
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_TICKET_MODE: mode, TEST_COUNT: count, TEST_WAITS: delays },
    }).then(value => ({ ...value, code: 0 }), error => error)
    expect(result.code).toBe(status)
    expect(Number(await fs.readFile(count, 'utf8'))).toBe(calls)
    expect(await fs.readFile(delays, 'utf8').then(value => value.trim().split('\n').length, () => 0)).toBe(waits)
    if (status === 0) expect(result.stdout).toContain('Developer ID, notarization, and arm64 executables')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
