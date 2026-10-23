import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { closeTestApplication } from './electron-fixture'

test('session previews persist across restarts and are deleted when unloaded windows close', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-session-previews-'))
  let requests = new Map<string, number>()
  let server = http.createServer((request, response) => {
    requests.set(request.url!, (requests.get(request.url!) ?? 0) + 1)
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Saved preview</title><style>body{background:#e8eef8;color:#173353;font:24px sans-serif;padding:40px}</style><h1>Saved preview fixture</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as any).port}`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\nmemory:\n  lazyRestore: true\n')
  let application: ElectronApplication | undefined, chrome: Page
  let launch = async () => {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await expect(chrome.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible()
    expect((await chrome.evaluate(() => (window as any).bmux.state())).configError).toBeNull()
  }
  let state = () => chrome.evaluate(() => (window as any).bmux.state())
  let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
  let saved = (paneId: string) => fs.readFile(path.join(directory, 'previews', `${encodeURIComponent(paneId)}.json`), 'utf8').then(JSON.parse).catch(() => undefined)
  try {
    await launch()
    let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
    await rpc('activate-client', { client: client.id })
    await chrome!.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome!.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${url}/visible`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}/visible`)).toBe(true)
    await expect(application!.context().pages().find(page => page.url() === `${url}/visible`)!.locator('h1')).toHaveText('Saved preview fixture')
    await expect.poll(async () => !!(await state()).snapshots[client.paneId]).toBe(true)
    await expect.poll(async () => !!await saved(client.paneId)).toBe(true)

    let cached = await rpc('new-window', { session: client.sessionId, name: 'Saved background', url: `${url}/background` })
    let paneId = cached.panes[0].id
    let sibling = await rpc('split-window', { pane: paneId, url: `${url}/sibling`, axis: 'horizontal' })
    for (let pane of [paneId, sibling.id]) {
      await expect.poll(async () => !!(await state()).snapshots[pane]).toBe(true)
      await expect.poll(async () => !!await saved(pane)).toBe(true)
    }
    let privateSession = await rpc('new-session', { name: 'Private preview', private: true })
    let privatePane = privateSession.windows[0].panes[0].id
    await rpc('navigate', { pane: privatePane, url: `${url}/private` })
    await expect.poll(async () => !!(await state()).snapshots[privatePane]).toBe(true)
    expect(await saved(privatePane)).toBeUndefined()
    await rpc('kill-session', { session: privateSession.id, confirm: true })
    await expect.poll(async () => (await state()).snapshots[privatePane]).toBeUndefined()
    let snapshot = await saved(paneId), visits = requests.get('/background')
    await closeTestApplication(application); application = undefined

    await launch()
    await expect.poll(async () => (await state()).snapshots[paneId]).toEqual({ image: snapshot.image, capturedAt: snapshot.capturedAt })
    expect(application!.context().pages().some(page => page.url() === `${url}/background`)).toBe(false)
    expect(requests.get('/background')).toBe(visits)
    await chrome!.getByRole('button', { name: 'Sessions', exact: true }).click()
    let panel = chrome!.getByRole('dialog', { name: 'Sessions', exact: true })
    await panel.locator(`[data-window-row="${cached.id}"]`).focus()
    await expect(panel.locator(`[data-preview-pane="${paneId}"] img`)).toHaveAttribute('src', snapshot.image)
    await panel.screenshot({ path: test.info().outputPath('sessions-restored-previews.png') })
    await panel.getByRole('button', { name: 'Close window Saved background', exact: true }).click()
    await panel.getByRole('alertdialog', { name: 'Close window Saved background?', exact: true }).getByRole('button', { name: 'yes', exact: true }).click()
    for (let pane of [paneId, sibling.id]) {
      await expect.poll(async () => (await state()).snapshots[pane]).toBeUndefined()
      await expect.poll(() => saved(pane)).toBeUndefined()
    }
    expect((await state()).snapshots[client.paneId]).toBeDefined()
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
