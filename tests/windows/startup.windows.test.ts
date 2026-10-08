import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { stringify } from 'yaml'
import { controlSocketPath } from '../../bin/ipc.mjs'
import { closeTestApplication } from '../electron-fixture'

let exec = promisify(execFile)
let executable = process.env.BMUX_WINDOWS_APP!
let cliPath = path.join(path.dirname(executable), 'resources', 'bin', 'bmux.mjs')
let directory: string, env: Record<string, string>, application: ElectronApplication | undefined, pid: number | undefined
let rpc = (method: string, args = {}) => new Promise<any>((resolve, reject) => {
  let connection = net.createConnection(controlSocketPath(directory)), response = ''
  connection.setEncoding('utf8'); connection.setTimeout(10_000, () => connection.destroy(new Error('Control pipe timed out')))
  connection.on('connect', () => connection.write(JSON.stringify({ method, args }) + '\n'))
  connection.on('data', chunk => { response += chunk }); connection.on('error', reject)
  connection.on('end', () => {
    try { let result = JSON.parse(response); if (!result.ok) throw new Error(result.error); resolve(result.result) }
    catch (error) { reject(error) }
  })
})
let cli = async (...args: string[]) => {
  let result = await exec(process.execPath, [cliPath, ...args], { env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
  let response = JSON.parse(result.stdout)
  expect(response.ok).toBe(true)
  return response.result
}
let ready = async () => {
  // Direct IPC must work before using a CLI that could auto-start another app.
  await expect.poll(() => rpc('diagnostics').catch(() => undefined), { timeout: 30_000 }).toMatchObject({ pid: expect.any(Number) })
  pid = (await rpc('diagnostics')).pid
}
let stopped = async () => {
  await expect.poll(() => rpc('status').then(() => false, () => true), { timeout: 15_000 }).toBe(true)
  if (pid) await expect.poll(() => { try { process.kill(pid!, 0); return false } catch { return true } }, { timeout: 15_000 }).toBe(true)
  pid = undefined
}

test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux Windows 测试 '))
  env = Object.fromEntries(Object.entries({ ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  delete env.ELECTRON_RUN_AS_NODE; delete env.BMUX_APP; delete env.BROWMUX_APP
  await fs.writeFile(env.BMUX_CONFIG!, stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false }, plugins: { test: { enabled: true }, 'bmux.forms': { enabled: true } } }))
  await fs.access(cliPath)
})
test.afterEach(async ({}, info) => {
  try {
    await rpc('quit').catch(() => undefined)
    if (application) { await closeTestApplication(application); application = undefined }
    await stopped()
  } finally {
    if (pid) await exec('taskkill', ['/pid', String(pid), '/t', '/f']).catch(() => undefined)
    pid = undefined
    if (info.status !== info.expectedStatus) {
      let log = await fs.readFile(path.join(directory, 'server.log')).catch(() => undefined)
      if (log) await info.attach('startup-log', { body: log, contentType: 'text/plain' })
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('installed Windows app opens a window, serves its CLI and restarts', async () => {
  for (let index = 0; index < 2; index++) {
    application = await electron.launch({ executablePath: executable, args: [], env })
    await ready()
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await expect(chrome.getByRole('button', { name: 'Address', exact: true })).toBeVisible()
    expect((await cli('plugin', 'list')).some((plugin: any) => plugin.id === 'bmux.forms')).toBe(true)
    expect((await rpc('diagnostics')).windows.some((window: any) => window.visible)).toBe(true)
    await closeTestApplication(application); application = undefined
    await stopped()
  }
})

test('installed CLI starts bmux, drives a local page and runs authenticated plugins', async () => {
  let folder = path.join(directory, 'plugins', 'test')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Windows fixture', version: '1', actions: [{ id: 'run', title: 'Read fixture', command: ['node', './run.mjs'], capabilities: ['browser.read'] }] }))
  await fs.writeFile(path.join(folder, 'run.mjs'), `import { execFileSync } from 'node:child_process';
let host = method => JSON.parse(execFileSync(process.execPath, [process.env.BMUX_CLI, 'plugin', 'host', method], { encoding: 'utf8' }));
let token = process.env.BMUX_PLUGIN_TOKEN, context = host('context').result;
process.env.BMUX_PLUGIN_TOKEN = 'forged';
let denied = false;
try { host('context') } catch { denied = true }
if (!denied) process.exit(1);
process.env.BMUX_PLUGIN_TOKEN = token;
let title = JSON.parse(execFileSync(process.execPath, [process.env.BMUX_CLI, 'plugin', 'host', 'dom'], { encoding: 'utf8' })).result;
execFileSync(process.execPath, [process.env.BMUX_CLI, 'plugin', 'host', 'result', JSON.stringify({ pane: context.paneId, denied, content: title.content })]);
`)
  let fixture = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Windows fixture</title><main>Windows startup page</main>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  try {
    // Exercise discovery of ../bmux.exe from the installed resources/bin CLI.
    await cli('status'); await ready()
    let session = await cli('new-session', '-s', 'windows')
    let pane = session.windows[0].panes[0].id
    await cli('navigate', '-t', pane, `http://127.0.0.1:${(fixture.address() as net.AddressInfo).port}`)
    expect(await cli('eval', '-t', pane, 'document.title')).toBe('Windows fixture')
    let plugin = await cli('plugin', 'run', 'test/run', '-t', pane)
    await expect.poll(async () => (await cli('plugin', 'runs')).find((run: any) => run.id === plugin.id)?.status, { timeout: 15_000 }).toBe('completed')
    expect((await cli('plugin', 'runs')).find((run: any) => run.id === plugin.id).result).toMatchObject({ pane, denied: true, content: expect.stringContaining('Windows startup page') })
    let bundled = await cli('plugin', 'run', 'bmux.forms/fill', '-t', pane)
    await expect.poll(async () => (await cli('plugin', 'runs')).find((run: any) => run.id === bundled.id)?.status, { timeout: 15_000 }).toBe('completed')
    expect((await cli('plugin', 'runs')).find((run: any) => run.id === bundled.id).progress.message).toBe('No saved forms for this site and profile')
  } finally { await new Promise<void>(resolve => fixture.close(() => resolve())) }
})
