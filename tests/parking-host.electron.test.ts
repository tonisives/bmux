import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { closeTestApplication } from './electron-fixture'

test('parking hosts stay hidden when a native show exposes background pages', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-parking-host-'))
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Parked page</title><h1>Background page</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await expect(chrome.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible()
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let original = (await rpc('state')).model.clients
    let background = await rpc('new-window', { session: original[0].sessionId, name: 'Background fixture', url })
    let pane = background.panes[0].id
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}/`)).toBe(true)
    let page = application.context().pages().find(page => page.url() === `${url}/`)!
    await expect(page.locator('h1')).toHaveText('Background page')
    let diagnostics = await rpc('diagnostics')
    let host = diagnostics.parkingWindows.find((window: any) => window.panes.includes(pane))
    expect(host).toBeDefined()
    expect(host.visible).toBe(false)
    let clients = diagnostics.windows.map((window: any) => window.nativeId)
    expect(clients).not.toContain(host.nativeId)
    for (let method of ['showInactive', 'show'] as const) {
      await application.evaluate(({ BaseWindow }, { id, method }) => BaseWindow.fromId(id)![method](), { id: host.nativeId, method })
      await expect.poll(async () => (await rpc('diagnostics')).parkingWindows.find((window: any) => window.nativeId === host.nativeId)?.visible).toBe(false)
      expect((await rpc('state')).model.clients).toEqual(original)
      expect((await rpc('diagnostics')).windows.map((window: any) => window.nativeId)).toEqual(clients)
      await expect(page.locator('h1')).toHaveText('Background page')
    }
    // The parked WebContents must still attach normally when the user opens it.
    await rpc('select-window', { client: original[0].id, window: background.id })
    await expect.poll(async () => (await chrome.evaluate(() => (window as any).bmux.state())).nativePagePanes).toContain(pane)
    await expect.poll(async () => (await rpc('diagnostics')).parkingWindows.find((window: any) => window.nativeId === host.nativeId)?.panes).not.toContain(pane)
    await expect(page.locator('h1')).toHaveText('Background page')
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
