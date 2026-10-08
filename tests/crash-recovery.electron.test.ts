import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { closeTestApplication } from './electron-fixture'
import { initialModel, newPane, splitLayout } from '../src/main/model'
import { writeModel } from '../src/main/store'

for (let lazyRestore of [false, true]) test(`keeps ${lazyRestore ? 'lazy visible' : 'eager'} restores serialized through a crash and restart`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-recovery-client-'))
  let requests: string[] = [], held = new Set<http.ServerResponse>()
  let server = http.createServer((request, response) => {
    requests.push(request.url!)
    response.setHeader('Content-Type', 'text/html')
    if (request.url === '/held.js') { held.add(response); response.on('close', () => held.delete(response)); return }
    response.end(request.url === '/first' ? '<!doctype html><h1>First restore</h1><script src="/held.js"></script>' : '<!doctype html><h1>Second restore</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let model = initialModel(), session = model.sessions[0], window = session.windows[0], first = window.panes[0]
  first.url = `${origin}/first`
  let second = newPane(session.defaultProfileId, `${origin}/second`, model)
  window.panes.push(second)
  window.layout = splitLayout(window.layout, first.id, second.id, 'horizontal')
  model.clients.push({ id: 'client_restore', sessionId: session.id, windowId: window.id, paneId: first.id, width: 1000, height: 700 })
  writeModel(directory, model)
  await fs.writeFile(path.join(directory, 'config.yaml'), `memory:\n  lazyRestore: ${lazyRestore}\n`)
  await fs.writeFile(path.join(directory, 'browser-run.json'), JSON.stringify({ version: 1, recovery: false }))
  let application: ElectronApplication | undefined, child: ChildProcess | undefined
  let launch = async () => {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    child = application.process()
  }
  let savedMarker = () => fs.readFile(path.join(directory, 'navigation-crash.json'), 'utf8').then(text => JSON.parse(text)).catch(() => undefined)
  try {
    await launch()
    await expect.poll(() => requests.includes('/held.js')).toBe(true)
    await expect.poll(async () => (await savedMarker())?.paneId).toBe(first.id)
    // Both native views exist, but the second navigation must wait for the first.
    await expect.poll(() => application!.evaluate(({ webContents, session }) => webContents.getAllWebContents().filter(contents => contents.session === session.fromPartition('persist:profile_default')).length)).toBe(2)
    expect(requests).not.toContain('/second')
    child!.kill('SIGKILL')
    await closeTestApplication(application, child)
    application = undefined
    for (let response of held) response.end()
    requests = []

    await launch()
    await expect.poll(() => requests.includes('/second')).toBe(true)
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application!.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await expect.poll(async () => (await chrome.evaluate(() => (globalThis as any).bmux.state())).startupNotice).toBe('Removed a pane after 127.0.0.1 crashed bmux during navigation.')
    let state = await chrome.evaluate(() => (globalThis as any).bmux.state())
    expect(state.model.sessions[0].windows[0].panes.map((pane: { id: string }) => pane.id)).toEqual([second.id])
    expect(state.model.clients[0].paneId).toBe(second.id)
    expect(requests).not.toContain('/first')
    await expect(chrome.getByRole('status').filter({ hasText: state.startupNotice })).toBeVisible()
    await expect.poll(() => application!.context().pages().some(page => page.url() === second.url)).toBe(true)
    let page = application!.context().pages().find(page => page.url() === second.url)!
    await expect(page.locator('h1')).toHaveText('Second restore')
  } finally {
    for (let response of held) response.end()
    await closeTestApplication(application, child)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
