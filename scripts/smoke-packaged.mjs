import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

let exec = promisify(execFile)
let root = process.cwd()
let data = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-package-'))
let appPath = process.env.BMUX_APP ?? process.env.BROWMUX_APP ?? path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app')
let env = { ...process.env, BMUX_DATA_DIR: data }
let command = async (...args) => {
  let result = await exec(process.execPath, [path.join(root, 'bin/bmux.mjs'), ...args], { env, maxBuffer: 8 * 1024 * 1024 })
  let response = JSON.parse(result.stdout)
  assert.equal(response.ok, true)
  return response.result
}
let frontmost = async () => (await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to get unix id of first application process whose frontmost is true'])).stdout.trim()
let server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Packaged bmux</title><input id="text"><div style="height:1800px">Package fixture</div><footer>Full document bottom</footer>') })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  // The host CLI must be executable outside app.asar by arbitrary plugin scripts.
  let pluginDirectory = path.join(data, 'plugins', 'local.page-tools')
  await fs.cp(path.join(appPath, 'Contents', 'Resources', 'plugins', 'local.page-tools'), pluginDirectory, { recursive: true })
  await fs.writeFile(path.join(data, 'config.yaml'), 'keyboard: {}\nplugins:\n  local.page-tools:\n    enabled: true\n')
  let before = await frontmost()
  let session = await command('new-session', '-s', 'packaged', '--profile', 'bot')
  let pane = session.windows[0].panes[0]
  let tab = pane.tabs[0]
  await command('navigate', '-t', tab.id, `http://127.0.0.1:${server.address().port}`)
  await command('type', '-t', tab.id, '--selector', '#text', '--text', 'Packaged input')
  await command('key', '-t', tab.id, 'Meta+A')
  await command('type', '-t', tab.id, '--text', 'Replaced')
  assert.equal(await command('eval', '-t', tab.id, 'document.querySelector("#text").value'), 'Replaced')
  assert.match((await command('dom', '-t', tab.id)).content, /Full document bottom/)
  let plugin = await command('plugin', 'run', 'local.page-tools/title', '-t', tab.id)
  let pluginRun
  for (let attempt = 0; attempt < 50; attempt++) {
    pluginRun = (await command('plugin', 'runs')).find(run => run.id === plugin.id)
    if (!['queued', 'running'].includes(pluginRun?.status)) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(pluginRun.status, 'completed')
  assert.equal(pluginRun.result.result, 'Packaged bmux')
  let imagePath = path.join(data, 'page.png')
  await command('screenshot', '-t', tab.id, '--output', imagePath)
  let png = await fs.readFile(imagePath)
  assert.ok(png.readUInt32BE(20) > 1800)
  assert.equal(await frontmost(), before, 'Packaged background startup or automation stole focus')
  let client = await command('attach-session', '-t', 'packaged')
  assert.equal((await command('list-clients')).length, 1)
  await command('detach-client', '-c', client.id)
  assert.equal(await command('eval', '-t', tab.id, 'document.title'), 'Packaged bmux')
  console.log(JSON.stringify({ packagedApp: appPath, passed: ['silent CLI startup', 'CLI argument parsing', 'packaged plugin host and example', 'typing and modifier keys', 'DOM extraction', 'full-page PNG', 'unchanged macOS focus', 'client attach/detach', 'detached page lifetime'] }))
} finally {
  await command('quit').catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 500))
  await new Promise(resolve => server.close(resolve))
  await fs.rm(data, { recursive: true, force: true })
}
