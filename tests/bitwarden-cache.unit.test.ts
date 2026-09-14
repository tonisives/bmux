import { afterEach, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createVault } from '../src/main/bitwarden-cli'

let cleanup: (() => void)[] = []
afterEach(() => { for (let close of cleanup.splice(0)) close(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
let setup = () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-vault-cache-'))
  let executable = path.join(directory, 'bw-fixture'), file = path.join(directory, 'data.json'), calls = path.join(directory, 'calls')
  fs.writeFileSync(file, JSON.stringify({ userId: 'fixture-account' }))
  fs.writeFileSync(executable, `#!${process.execPath}
let fs = require('node:fs'), path = require('node:path'), directory = process.env.BITWARDENCLI_APPDATA_DIR;
let command = process.argv[2], data = JSON.parse(fs.readFileSync(path.join(directory, 'data.json'), 'utf8'));
fs.appendFileSync(path.join(directory, 'calls'), command + '\\n');
setTimeout(() => {
if (command === 'unlock') process.stdout.write(Buffer.alloc(64, 7).toString('base64'));
if (command === 'status') process.stdout.write(JSON.stringify({ status: process.env.BW_SESSION ? 'unlocked' : 'locked', userId: data.userId }));
if (command === 'list') process.stdout.write(JSON.stringify([{ id: 'fixture', type: 1, login: { password: 'fixture-secret', uris: [{ uri: 'https://example.test' }] } }]));
}, 100);
`, { mode: 0o700 })
  vi.stubEnv('BITWARDENCLI_APPDATA_DIR', directory); vi.stubEnv('BW_SESSION', '')
  let vault = createVault({ executable })
  cleanup.push(() => { vault.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { vault, file, calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [] }
}

test('warm status and URL lookups spawn no CLI process and return separate objects', async () => {
  let f = setup()
  await f.vault.unlock('fixture-master')
  let status = await f.vault.status(), items = await f.vault.logins('https://example.test')
  let calls = f.calls()
  status.status = 'locked'; items[0].login.password = 'changed-fixture'
  expect((await f.vault.status()).status).toBe('unlocked')
  expect((await f.vault.logins('https://example.test'))[0].login.password).toBe('fixture-secret')
  expect(f.calls()).toEqual(calls)
  await f.vault.status(undefined, true)
  expect(f.calls()).toHaveLength(calls.length + 1)
  expect(await f.vault.logins('https://different.test')).toEqual([])
  expect(f.calls()).toHaveLength(calls.length + 2)
  await expect(f.vault.status(AbortSignal.abort())).rejects.toThrow()
})

test('vault-file replacement and session locking invalidate warm results', async () => {
  let f = setup()
  await f.vault.unlock('fixture-master'); await f.vault.status(); await f.vault.logins('https://example.test')
  let count = f.calls().length
  fs.writeFileSync(f.file + '.new', JSON.stringify({ userId: 'another-account' })); fs.renameSync(f.file + '.new', f.file)
  expect((await f.vault.status()).userId).toBe('another-account')
  await f.vault.logins('https://example.test')
  expect(f.calls()).toHaveLength(count + 2)
  f.vault.close()
  expect((await f.vault.status()).status).toBe('locked')
  expect(f.calls()).toHaveLength(count + 3)
})

test('warm results expire and an unobservable data file disables reuse', async () => {
  let f = setup()
  await f.vault.unlock('fixture-master'); await f.vault.status(); await f.vault.logins('https://example.test')
  let count = f.calls().length, now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 31000)
  await f.vault.status(); await f.vault.logins('https://example.test')
  expect(f.calls()).toHaveLength(count + 2)
  fs.unlinkSync(f.file)
  await expect(f.vault.status()).rejects.toThrow()
})

test('results from a changing vault file are not cached', async () => {
  let f = setup()
  await f.vault.unlock('fixture-master')
  let pending = f.vault.status()
  await vi.waitFor(() => expect(f.calls()).toContain('status'), { interval: 5 })
  fs.writeFileSync(f.file, JSON.stringify({ userId: 'changed-account' }))
  await pending
  expect((await f.vault.status()).userId).toBe('changed-account')
  expect(f.calls().filter(command => command === 'status')).toHaveLength(2)
})
