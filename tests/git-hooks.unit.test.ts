import { afterEach, describe, expect, test } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
let hook = path.resolve('.githooks/post-merge')
let directories: string[] = []

let fixture = async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-hook-test-'))
  directories.push(directory)
  let repository = path.join(directory, 'bmux')
  let worktree = path.join(directory, 'task')
  let bin = path.join(directory, 'bin')
  let log = path.join(directory, 'package.log')
  let output = path.join(directory, 'tools')
  await fs.mkdir(repository)
  await fs.mkdir(bin)
  await exec('git', ['init', '-q', repository])
  await fs.writeFile(path.join(repository, 'tracked'), 'fixture')
  await exec('git', ['-C', repository, 'add', 'tracked'])
  await exec('git', ['-C', repository, '-c', 'user.name=bmux tests', '-c', 'user.email=bmux@example.invalid', 'commit', '-qm', 'fixture'])
  await exec('git', ['-C', repository, 'worktree', 'add', '-qb', 'task', worktree])
  await fs.writeFile(path.join(bin, 'pnpm'), '#!/bin/sh\nprintf \'%s|%s|%s\\n\' "$PWD" "$BMUX_OUTPUT_DIR" "$*" >> "$BMUX_HOOK_LOG"\n', { mode: 0o755 })
  let env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BMUX_HOOK_LOG: log, BMUX_OUTPUT_DIR: output }
  return { env, log, output, repository, worktree }
}

afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })

describe.runIf(process.platform === 'darwin')('post-merge package hook', () => {
  test('packages primary-checkout merges into the configured output folder', async () => {
    let current = await fixture()
    await exec('/bin/sh', [hook], { cwd: current.repository, env: current.env })
    let repository = await fs.realpath(current.repository)
    expect(await fs.readFile(current.log, 'utf8')).toBe(`${repository}|${current.output}|package\n`)
  })

  test('skips task worktrees and explicit opt-outs', async () => {
    let current = await fixture()
    await exec('/bin/sh', [hook], { cwd: current.worktree, env: current.env })
    await exec('/bin/sh', [hook], { cwd: current.repository, env: { ...current.env, BMUX_SKIP_POST_MERGE_PACKAGE: '1' } })
    await expect(fs.access(current.log)).rejects.toThrow()
  })
})
