import { afterEach, describe, expect, test } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
let installer = path.resolve('scripts/install-app.mjs')
let directories: string[] = []
let fixture = async () => {
  let root = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-install-test-'))
  directories.push(root)
  let source = path.join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'bmux.app')
  await fs.mkdir(path.join(source, 'Contents/MacOS'), { recursive: true })
  // Re-signing Apple's system sleep binary can crash on macOS CI runners.
  // Build our own executable so the fixture has no platform signing metadata.
  let program = path.join(root, 'fixture.c')
  await fs.writeFile(program, '#include <unistd.h>\nint main(void) { for (;;) pause(); }\n')
  await exec('/usr/bin/xcrun', ['clang', program, '-o', path.join(source, 'Contents/MacOS/bmux')])
  await fs.writeFile(path.join(source, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>bmux</string><key>CFBundleIdentifier</key><string>dev.bmux.install-fixture</string></dict></plist>')
  await fs.mkdir(path.join(source, 'Contents/Resources'), { recursive: true })
  await fs.writeFile(path.join(source, 'Contents/Resources/version'), 'new build')
  await exec('/usr/bin/codesign', ['--force', '--sign', '-', source])
  return { root, source }
}
let install = (root: string, output = '') => exec(process.execPath, [installer], { cwd: root, env: { ...process.env, BMUX_OUTPUT_DIR: output, BMUX_SIGNING_IDENTITY: '', BMUX_DEFAULT_SIGNING_IDENTITY: '' } })
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })

describe.runIf(process.platform === 'darwin')('packaged app output', () => {
  test('defaults to build and preserves build resources', async () => {
    let { root } = await fixture()
    await fs.mkdir(path.join(root, 'build'), { recursive: true })
    await fs.writeFile(path.join(root, 'build/icon.icns'), 'icon fixture')
    await install(root)
    expect(await fs.readFile(path.join(root, 'build/bmux.app/Contents/Resources/version'), 'utf8')).toBe('new build')
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
    expect(await fs.readFile(path.join(directory, 'bmux.app/Contents/Resources/version'), 'utf8')).toBe('new build')
    await expect(fs.access(path.join(directory, 'bmux.app/old-file'))).rejects.toThrow()
    expect(await fs.readFile(path.join(directory, 'Browmux.app/keep'), 'utf8')).toBe('unrelated app')
    expect((await fs.readdir(directory)).sort()).toEqual(['Browmux.app', 'bmux.app'])
  })

  test('preserves the existing app when the new bundle is invalid', async () => {
    let { root, source } = await fixture()
    await fs.mkdir(path.join(root, 'build/bmux.app/Contents/Resources'), { recursive: true })
    await fs.writeFile(path.join(root, 'build/bmux.app/Contents/Resources/version'), 'previous build')
    await fs.rm(path.join(source, 'Contents/MacOS/bmux'))
    await expect(install(root)).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'build/bmux.app/Contents/Resources/version'), 'utf8')).toBe('previous build')
  })

  test('rejects an invalid signature before replacing the existing app', async () => {
    let { root, source } = await fixture()
    await fs.mkdir(path.join(root, 'build/bmux.app/Contents/Resources'), { recursive: true })
    await fs.writeFile(path.join(root, 'build/bmux.app/Contents/Resources/version'), 'previous build')
    await fs.writeFile(path.join(source, 'Contents/Resources/version'), 'tampered build')
    await expect(install(root)).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'build/bmux.app/Contents/Resources/version'), 'utf8')).toBe('previous build')
  })

  test('defers replacement of a real running executable and installs after it exits', async () => {
    let { root, source } = await fixture()
    let output = path.join(root, 'tools'), destination = path.join(output, 'bmux.app')
    await fs.mkdir(output)
    await fs.cp(source, destination, { recursive: true })
    await fs.writeFile(path.join(destination, 'Contents/Resources/version'), 'running build')
    await exec('/usr/bin/codesign', ['--force', '--sign', '-', destination])
    let executable = path.join(destination, 'Contents/MacOS/bmux'), original = await fs.stat(executable)
    let child = spawn(executable)
    let exited = new Promise(resolve => child.once('exit', resolve))
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      // spawn does not establish that macOS has published the executable path.
      await expect.poll(async () => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Fixture exited before installation: ${child.exitCode ?? child.signalCode}`)
        let { stdout } = await exec('/bin/ps', ['-p', String(child.pid), '-o', 'comm='])
        return stdout.trim()
      }, { timeout: 5000 }).toBe(executable)
      let result = await install(root, output)
      expect(result.stdout).toContain('installation will finish after bmux exits')
      expect((await fs.stat(executable)).ino).toBe(original.ino)
      expect(await fs.readFile(path.join(destination, 'Contents/Resources/version'), 'utf8')).toBe('running build')
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', destination])
      child.kill()
      await exited
      // The detached installer polls once per second, beyond Vitest's default
      // one-second assertion budget. Allow its next check and staged cleanup.
      await expect.poll(() => fs.readFile(path.join(destination, 'Contents/Resources/version'), 'utf8'), { timeout: 5000 }).toBe('new build')
      await expect.poll(() => fs.readdir(output), { timeout: 5000 }).toEqual(['bmux.app'])
      await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', destination])
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited } }
  }, 15000)

  test('keeps the bundle when output is already the packaging folder', async () => {
    let { root, source } = await fixture()
    await install(root, path.dirname(source))
    expect(await fs.readFile(path.join(source, 'Contents/Resources/version'), 'utf8')).toBe('new build')
  })
})
