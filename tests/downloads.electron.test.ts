import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initialModel } from '../src/main/model'

let application: ElectronApplication, chrome: Page, directory: string, url: string, server: http.Server
let model = initialModel(), pane = model.sessions[0].windows[0].panes[0]
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let cli = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20000 })).stdout)
let downloads = () => rpc('downloads') as Promise<any[]>
let open = async () => {
  await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  let input = chrome.getByRole('combobox', { name: 'Command', exact: true })
  await input.fill('downloads'); await input.press('Enter')
  await expect(chrome.getByRole('dialog', { name: 'Downloads', exact: true })).toBeVisible()
}
let start = (route: string, profile = model.profiles[0].id) => application.evaluate(({ session }, { route, profile, url }) => {
  session.fromPartition(`persist:${profile}`).downloadURL(`${url}/${route}`)
}, { route, profile, url })

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-downloads-'))
  server = http.createServer((request, response) => {
    if (request.url === '/fixture') { response.end('<!doctype html><h1>Download fixture</h1>'); return }
    let slow = request.url?.startsWith('/slow'), broken = request.url === '/broken'
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${slow ? 'slow' : broken ? 'broken' : 'complete'}.bin"`, 'Content-Length': slow ? 1024 * 1024 * 8 : broken ? 1024 * 1024 : 1024, 'Accept-Ranges': 'bytes', 'ETag': '"fixture"', 'Last-Modified': 'Mon, 01 Jun 2026 00:00:00 GMT' })
    if (broken) { response.write(Buffer.alloc(1024)); setTimeout(() => response.destroy(), 100); return }
    if (!slow) { response.end(Buffer.alloc(1024)); return }
    let sent = 0
    let timer = setInterval(() => { response.write(Buffer.alloc(16384)); sent += 16384; if (sent >= 1024 * 1024 * 8) { clearInterval(timer); response.end() } }, 100)
    response.on('close', () => clearInterval(timer))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}`
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await application.evaluate(({ app }, directory) => app.setPath('downloads', directory), directory)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(`${url}/fixture`); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === `${url}/fixture`)).toBe(true)
  await expect(application.context().pages().find(page => page.url() === `${url}/fixture`)!.locator('h1')).toHaveText('Download fixture')
})
test.afterAll(async () => {
  await application?.close()
  server?.closeAllConnections()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

test('download manager controls real transfers and isolates profiles', async () => {
  await open(); await expect(chrome.getByText('No downloads in this profile.')).toBeVisible()
  await start('slow')
  let row = chrome.getByRole('article', { name: 'slow.bin', exact: true })
  await expect(row.getByRole('progressbar')).toBeVisible()
  await expect.poll(async () => (await downloads())[0]?.received ?? 0).toBeGreaterThan(0)
  await row.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(row).toContainText('Paused')
  let record = (await downloads())[0]
  await expect(rpc('download.cancel', { id: record.id, profile: model.profiles[1].id })).rejects.toThrow('another profile')
  await row.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(row).toContainText('Downloading')
  await row.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(row).toContainText('Cancelled')
  await expect(row.getByRole('button')).toHaveCount(0)
  await expect(rpc('download.resume', { id: record.id, profile: record.profileId })).rejects.toThrow('no longer active')
  await start('complete')
  let complete = chrome.getByRole('article', { name: 'complete.bin', exact: true })
  await expect(complete).toContainText('Completed')
  await expect(complete).toContainText('100%')
  await expect(complete.getByRole('button', { name: 'Show in Finder' })).toBeVisible()
  record = (await downloads()).find(item => item.name === 'complete.bin')
  expect((await fs.stat(record.path)).size).toBe(1024)
  await fs.unlink(record.path)
  await complete.getByRole('button', { name: 'Show in Finder' }).click()
  await expect(chrome.getByText('Downloaded file no longer exists')).toBeVisible()
  await start('broken')
  let interrupted = chrome.getByRole('article', { name: 'broken.bin' })
  await expect(interrupted).toContainText('Interrupted')
  await expect(interrupted.getByRole('button', { name: 'Resume' })).toBeEnabled()
  await interrupted.getByRole('button', { name: 'Cancel' }).click()
  await rpc('new-session', { name: 'other', profile: model.profiles[1].id })
  await start('complete-other', model.profiles[1].id)
  await expect.poll(async () => (await downloads()).filter(item => item.profileId === model.profiles[1].id && item.state === 'completed').length).toBe(1)
  let listed = await cli('downloads', '--profile', model.profiles[1].id)
  expect(listed.ok).toBe(true)
  expect(listed.result).toHaveLength(1)
  expect(listed.result[0].profileId).toBe(model.profiles[1].id)
  let rejected = await cli('download', 'cancel', listed.result[0].id, '--profile', model.profiles[0].id).catch(error => JSON.parse(error.stdout))
  expect(rejected.error).toContain('another profile')
  // The selected default profile never shows the other profile's transfer.
  await expect(complete).toHaveCount(1)
  let state = await chrome.evaluate(() => (window as any).bmux.state())
  expect(state.model.sessions[0].windows[0].panes[0].activeTabId).toBe(pane.activeTabId)
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
  await chrome.screenshot({ path: path.resolve('artifacts/download-manager.png') })
})
