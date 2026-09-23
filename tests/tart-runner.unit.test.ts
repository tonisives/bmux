import { expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
let runner = path.resolve('scripts/tart.mjs')
let fixture = async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-tart-test-'))
  let source = path.join(directory, 'source'), binary = path.join(directory, 'fake-tart.mjs')
  await fs.mkdir(source)
  await exec('git', ['init', '-q', source])
  await fs.writeFile(path.join(source, '.gitignore'), 'ignored.txt\nartifacts/\n')
  await fs.writeFile(path.join(source, 'tracked.txt'), 'original')
  await fs.writeFile(path.join(source, 'deleted.txt'), 'deleted')
  await fs.writeFile(path.join(source, '.env'), 'fixture-only')
  await exec('git', ['-C', source, 'add', '.'])
  await fs.unlink(path.join(source, 'deleted.txt'))
  await fs.writeFile(path.join(source, 'tracked.txt'), 'edited')
  await fs.writeFile(path.join(source, "untracked ' file.txt"), 'new')
  await fs.writeFile(path.join(source, 'ignored.txt'), 'ignored')
  await fs.mkdir(path.join(directory, 'results/artifacts'), { recursive: true })
  await fs.mkdir(path.join(directory, 'results/test-results'), { recursive: true })
  await fs.writeFile(path.join(directory, 'results/artifacts/proof.txt'), 'guest result')
  await fs.writeFile(binary, `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
let directory = process.env.BMUX_RUNNER_FIXTURE
let args = process.argv.slice(2)
if (args[0] === 'list') console.log(JSON.stringify([{ Name: 'bmux-tests', Running: fs.existsSync(path.join(directory, 'running')) || (process.env.BMUX_RUNNER_STOPPED !== '1' && !fs.existsSync(path.join(directory, 'stopped'))) }]))
else if (args[0] === 'set') fs.appendFileSync(path.join(directory, 'settings'), args.slice(2).join(' ') + '\\n')
else if (args[0] === 'run') { fs.rmSync(path.join(directory, 'stopped'), { force: true }); fs.writeFileSync(path.join(directory, 'running'), '') }
else if (args[0] === 'stop') { fs.rmSync(path.join(directory, 'running'), { force: true }); fs.writeFileSync(path.join(directory, 'stopped'), ''); fs.appendFileSync(path.join(directory, 'stops'), 'stop\\n') }
else if (args.includes('/usr/bin/id')) console.log('admin')
else if (args.includes('/usr/bin/tar')) {
  let result = spawnSync('/usr/bin/tar', ['-cf', '-', '-C', path.join(directory, 'results'), 'artifacts', 'test-results'], { stdio: ['ignore', 'inherit', 'inherit'] })
  process.exitCode = result.status
} else {
  let script = args.at(-1)
  if (script.includes('tar -xf -')) {
    let chunks = []
    for await (let chunk of process.stdin) chunks.push(chunk)
    fs.writeFileSync(path.join(directory, 'snapshot.tar'), Buffer.concat(chunks))
  }
  if (script.includes('pnpm install') || script === 'hold') {
    fs.appendFileSync(path.join(directory, 'events'), 'start\\n')
    await new Promise(resolve => setTimeout(resolve, 400))
    fs.appendFileSync(path.join(directory, 'events'), 'end\\n')
    process.exitCode = Number(process.env.BMUX_RUNNER_EXIT ?? 0)
  }
}
`, { mode: 0o755 })
  let run = (code = 0, action = ['electron'], extraEnv = {}) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    let child = spawn(process.execPath, [runner, ...action], { cwd: source, env: { ...process.env, TART_HOME: path.join(directory, 'tart'), BMUX_TART_BIN: binary, BMUX_TART_VM: 'bmux-tests', BMUX_TEST_NATIVE: '0', GITHUB_ACTIONS: 'false', BMUX_RUNNER_FIXTURE: directory, BMUX_RUNNER_EXIT: String(code), ...extraEnv } })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    child.once('error', reject)
    child.once('close', code => resolve({ code, output }))
  })
  return { directory, source, run, cleanup: () => fs.rm(directory, { recursive: true, force: true }) }
}

it('sends current source edits without ignored or environment files and retrieves artifacts on failure', async () => {
  let current = await fixture()
  try {
    await fs.mkdir(path.join(current.directory, 'tart/bmux-runner'), { recursive: true })
    await fs.writeFile(path.join(current.directory, 'tart/bmux-runner/bmux-tests.lock'), '2147483647')
    let result = await current.run(7)
    expect(result.code, result.output).toBe(7)
    let archive = path.join(current.directory, 'snapshot.tar')
    let files = (await exec('/usr/bin/tar', ['-tf', archive])).stdout
    expect(files).toContain('tracked.txt')
    expect(files).toContain("untracked ' file.txt")
    expect(files).not.toMatch(/ignored\.txt|deleted\.txt|\.env|\.git\//)
    expect((await exec('/usr/bin/tar', ['-xOf', archive, 'tracked.txt'])).stdout).toBe('edited')
    let runs = await fs.readdir(path.join(current.source, 'artifacts/tart'))
    expect(await fs.readFile(path.join(current.source, 'artifacts/tart', runs[0], 'artifacts/proof.txt'), 'utf8')).toBe('guest result')
    expect(await fs.readFile(path.join(current.directory, 'stops'), 'utf8')).toBe('stop\n')
  } finally { await current.cleanup() }
}, 15000)

it('serializes simultaneous GUI runs and releases the queue after a failure', async () => {
  let current = await fixture()
  try {
    let results = await Promise.all([current.run(9), current.run(0, ['ui'])])
    expect(results.map(result => result.code)).toEqual([9, 0])
    expect(await fs.readFile(path.join(current.directory, 'events'), 'utf8')).toBe('start\nend\nstart\nend\n')
    expect(await fs.readFile(path.join(current.directory, 'stops'), 'utf8')).toBe('stop\n')
    expect(results.some(result => result.output.includes('Waiting for the other'))).toBe(true)
  } finally { await current.cleanup() }
}, 15000)

it('uses the GUI lock for ad hoc guest commands', async () => {
  let current = await fixture()
  try {
    let results = await Promise.all([current.run(), current.run(0, ['exec', 'hold'])])
    expect(results.map(result => result.code)).toEqual([0, 0])
    expect(await fs.readFile(path.join(current.directory, 'events'), 'utf8')).toBe('start\nend\nstart\nend\n')
    expect(results.some(result => result.output.includes('Waiting for the other'))).toBe(true)
  } finally { await current.cleanup() }
}, 15000)

it('sets the CPU and memory limits before starting a stopped VM', async () => {
  let current = await fixture()
  try {
    let result = await current.run(0, ['start'], { BMUX_RUNNER_STOPPED: '1' })
    expect(result.code, result.output).toBe(0)
    expect(await fs.readFile(path.join(current.directory, 'settings'), 'utf8')).toBe('--cpu 2 --memory 6144\n')
  } finally { await current.cleanup() }
}, 15000)

it('replaces an older identical queued test with the latest request', async () => {
  let current = await fixture()
  try {
    let hold = current.run(0, ['exec', 'hold'])
    await new Promise(resolve => setTimeout(resolve, 100))
    let older = current.run(0, ['electron'])
    await new Promise(resolve => setTimeout(resolve, 100))
    let newer = current.run(0, ['electron'])
    let results = await Promise.all([hold, older, newer])
    expect(results.map(result => result.code)).toEqual([0, 0, 0])
    expect(results[1].output).toContain('replaced this queued run')
    expect(await fs.readFile(path.join(current.directory, 'events'), 'utf8')).toBe('start\nend\nstart\nend\n')
    expect(await fs.readFile(path.join(current.directory, 'stops'), 'utf8')).toBe('stop\n')
  } finally { await current.cleanup() }
}, 15000)
