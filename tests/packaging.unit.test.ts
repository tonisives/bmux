import { afterEach, describe, expect, test } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
let installer = path.resolve('scripts/install-app.mjs')
let directories: string[] = []
let fixture = async () => {
  let root = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-install-test-'))
  directories.push(root)
  let source = path.join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'bmux.app')
  await fs.mkdir(path.join(source, 'Contents/MacOS'), { recursive: true })
  await fs.writeFile(path.join(source, 'Contents/MacOS/bmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  await fs.writeFile(path.join(source, 'version'), 'new build')
  return { root, source }
}
let install = (root: string, output = '') => exec(process.execPath, [installer], { cwd: root, env: { ...process.env, BMUX_OUTPUT_DIR: output } })
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })

describe.runIf(process.platform === 'darwin')('packaged app output', () => {
  test('defaults to build and preserves build resources', async () => {
    let { root } = await fixture()
    await fs.mkdir(path.join(root, 'build'), { recursive: true })
    await fs.writeFile(path.join(root, 'build/icon.icns'), 'icon fixture')
    await install(root)
    expect(await fs.readFile(path.join(root, 'build/bmux.app/version'), 'utf8')).toBe('new build')
    expect(await fs.readFile(path.join(root, 'build/icon.icns'), 'utf8')).toBe('icon fixture')
    await fs.access(path.join(root, 'build/bmux.app/Contents/MacOS/bmux'), fs.constants.X_OK)
  })

  test.each(['custom tools', '/absolute'])('replaces only bmux.app in a custom folder: %s', async output => {
    let { root } = await fixture()
    let configured = output === '/absolute' ? path.join(root, 'absolute tools') : output
    let directory = path.resolve(root, configured)
    await fs.mkdir(path.join(directory, 'bmux.app'), { recursive: true })
    await fs.mkdir(path.join(directory, 'Browmux.app'), { recursive: true })
    await fs.writeFile(path.join(directory, 'bmux.app/old-file'), 'old')
    await fs.writeFile(path.join(directory, 'Browmux.app/keep'), 'unrelated app')
    await install(root, configured)
    expect(await fs.readFile(path.join(directory, 'bmux.app/version'), 'utf8')).toBe('new build')
    await expect(fs.access(path.join(directory, 'bmux.app/old-file'))).rejects.toThrow()
    expect(await fs.readFile(path.join(directory, 'Browmux.app/keep'), 'utf8')).toBe('unrelated app')
    expect((await fs.readdir(directory)).sort()).toEqual(['Browmux.app', 'bmux.app'])
  })

  test('preserves the existing app when the new bundle is invalid', async () => {
    let { root, source } = await fixture()
    await fs.mkdir(path.join(root, 'build/bmux.app'), { recursive: true })
    await fs.writeFile(path.join(root, 'build/bmux.app/version'), 'previous build')
    await fs.rm(path.join(source, 'Contents/MacOS/bmux'))
    await expect(install(root)).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'build/bmux.app/version'), 'utf8')).toBe('previous build')
  })

  test('keeps the bundle when output is already the packaging folder', async () => {
    let { root, source } = await fixture()
    await install(root, path.dirname(source))
    expect(await fs.readFile(path.join(source, 'version'), 'utf8')).toBe('new build')
  })
})
