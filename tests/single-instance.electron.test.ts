import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

test('background launches reuse the primary before ready and preserve launch documents', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-single-instance-'))
  let profile = path.join(directory, 'profile'), fixture = path.join(directory, 'app')
  let claims = path.join(directory, 'claims.jsonl')
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: profile, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    await fs.mkdir(fixture)
    await fs.writeFile(env.BMUX_CONFIG, 'keyboard: {}\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
    await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
    await fs.writeFile(path.join(fixture, 'main.mjs'), `
import { app } from 'electron'
import fs from 'node:fs'
app.setAppPath(${JSON.stringify(process.cwd())})
let claim = app.requestSingleInstanceLock.bind(app)
app.requestSingleInstanceLock = data => {
  let ready = app.isReady(), acquired = claim(data)
  fs.appendFileSync(${JSON.stringify(claims)}, JSON.stringify({ pid: process.pid, ready, acquired, data }) + '\\n')
  return acquired
}
let on = app.on.bind(app)
app.on = (event, listener) => {
  let result = on(event, listener)
  if (event === 'open-file' && process.env.BMUX_FIXTURE_DOCUMENT) queueMicrotask(() => app.emit('open-file', { preventDefault() {} }, process.env.BMUX_FIXTURE_DOCUMENT))
  return result
}
await import(${JSON.stringify(pathToFileURL(path.resolve('out/main/index.js')).href)})
`)
    application = await electron.launch({ args: [fixture], env })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string) => chrome.evaluate(method => (window as any).bmux.command({ method }), method)
    let before = await command('diagnostics')
    let readClaims = async () => (await fs.readFile(claims, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect((await readClaims()).find(item => item.pid === before.pid)).toMatchObject({ ready: true, acquired: true })
    let executable = createRequire(import.meta.url)('electron') as string
    let launch = async (args: string[], extra: Record<string, string> = {}) => promisify(execFile)(executable, [fixture, ...args], { env: { ...env, ...extra }, timeout: 20000 })
    // Independent CLI calls can race while a human already has the app open.
    await Promise.all([launch(['--background']), launch(['--background']), launch([], { BMUX_BACKGROUND: '1' })])
    let after = await command('diagnostics')
    expect(after.pid).toBe(before.pid)
    expect(after.windows).toEqual(before.windows)
    let secondaryClaims = (await readClaims()).filter(item => item.pid !== before.pid)
    expect(new Set(secondaryClaims.map(item => item.pid)).size).toBe(3)
    expect(secondaryClaims.every(item => !item.acquired)).toBe(true)
    expect(secondaryClaims.filter(item => !item.ready)).toHaveLength(3)
    if (process.platform === 'darwin') expect(await application.evaluate(({ app }) => app.dock?.isVisible())).toBe(true)
    let cli = async () => {
      let { stdout } = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), 'diagnostics', '--no-start'], { env, timeout: 20000 })
      return JSON.parse(stdout)
    }
    expect(await cli()).toMatchObject({ ok: true, result: { pid: before.pid } })
    let document = path.join(directory, 'launch document.html')
    await fs.writeFile(document, '<!doctype html><title>Launch document</title><main>Launch document</main>')
    let windowsBefore = (await command('list-sessions')).flatMap((session: any) => session.windows)
    await launch([], { BMUX_FIXTURE_DOCUMENT: document })
    await expect.poll(async () => (await command('list-sessions')).flatMap((session: any) => session.windows).filter((window: any) => window.panes.some((pane: any) => pane.url === pathToFileURL(document).href)).length).toBe(1)
    expect((await command('list-sessions')).flatMap((session: any) => session.windows)).toHaveLength(windowsBefore.length + 1)
    expect(await cli()).toMatchObject({ ok: true, result: { pid: before.pid } })
  } finally {
    await closeTestApplication(application)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})


test('Quit blocks background relaunches until the app is opened again', async () => {
  test.setTimeout(90000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-quit-policy-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  let cli = async (...args: string[]) => promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env, timeout: 15000 })
  let launch = async () => {
    application = await electron.launch({ args: ['.'], env })
    let pid = application.process().pid
    await expect(async () => expect(JSON.parse((await cli('diagnostics', '--no-start')).stdout).result.pid).toBe(pid)).toPass({ timeout: 15000 })
  }
  try {
    await fs.writeFile(env.BMUX_CONFIG, 'keyboard: {}\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
    await launch()
    let exited = new Promise(resolve => application!.process().once('exit', resolve))
    // The native Quit menu and Cmd-Q both emit before-quit.
    await application!.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await exited
    application = undefined
    expect(await fs.stat(path.join(directory, 'autostart-paused')).then(() => true)).toBe(true)
    await expect(cli('list-sessions')).rejects.toMatchObject({ stderr: expect.stringContaining('bmux was quit') })
    let executable = createRequire(import.meta.url)('electron') as string
    await promisify(execFile)(executable, ['.', '--background'], { env: { ...env, BMUX_AUTOSTART: '1' }, timeout: 15000 })
    await expect(cli('diagnostics', '--no-start')).rejects.toMatchObject({ stderr: expect.stringContaining('BMUX is not running') })
    await launch()
    expect(await fs.stat(path.join(directory, 'autostart-paused')).then(() => true, () => false)).toBe(false)
    expect(JSON.parse((await cli('list-sessions')).stdout).ok).toBe(true)
  } finally {
    await closeTestApplication(application)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
