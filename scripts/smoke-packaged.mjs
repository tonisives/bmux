import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

let exec = promisify(execFile)
let root = process.cwd()
let data = await fs.mkdtemp(path.join(os.tmpdir(), 'browmux-package-'))
let appPath = process.env.BROWMUX_APP ?? path.join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Browmux.app')
let env = { ...process.env, BROWMUX_DATA_DIR: data, BROWMUX_APP: appPath }
let command = async (...args) => {
  let result = await exec(process.execPath, [path.join(root, 'bin/brmux.mjs'), ...args], { env, maxBuffer: 8 * 1024 * 1024 })
  let response = JSON.parse(result.stdout)
  assert.equal(response.ok, true)
  return response.result
}
let frontmost = async () => (await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to get unix id of first application process whose frontmost is true'])).stdout.trim()
let server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Packaged Browmux</title><input id="text"><div style="height:1800px">Package fixture</div><footer>Full document bottom</footer>') })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
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
  let imagePath = path.join(data, 'page.png')
  await command('screenshot', '-t', tab.id, '--output', imagePath)
  let png = await fs.readFile(imagePath)
  assert.ok(png.readUInt32BE(20) > 1800)
  assert.equal(await frontmost(), before, 'Packaged background startup or automation stole focus')
  let client = await command('attach-session', '-t', 'packaged')
  assert.equal((await command('list-clients')).length, 1)
  await command('detach-client', '-c', client.id)
  assert.equal(await command('eval', '-t', tab.id, 'document.title'), 'Packaged Browmux')
  console.log(JSON.stringify({ packagedApp: appPath, passed: ['silent CLI startup', 'CLI argument parsing', 'typing and modifier keys', 'DOM extraction', 'full-page PNG', 'unchanged macOS focus', 'client attach/detach', 'detached page lifetime'] }))
} finally {
  await command('quit').catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 500))
  await new Promise(resolve => server.close(resolve))
  await fs.rm(data, { recursive: true, force: true })
}
