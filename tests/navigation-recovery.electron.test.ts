import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { stringify } from 'yaml'

test('reload interrupts a restored streaming page and permits later inspection', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-navigation-recovery-'))
  let hang = false, requests = 0
  let server = http.createServer((_request, response) => {
    requests++
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.write('<!doctype html><title>Retained fixture</title><main>Usable evidence</main>')
    if (!hang) response.end()
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ browser: { autoUpdateFilters: false } }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/page`
    let launch = async () => electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    let chromeFor = async () => {
      await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
      return application!.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    }
    application = await launch()
    let chrome = await chromeFor()
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let pane = state.model.sessions[0].windows[0].panes[0]
    await chrome.evaluate(({ pane, url }) => (window as any).bmux.command({ method: 'navigate', args: { tab: pane, url } }), { pane: pane.id, url })
    await application.close(); application = undefined
    hang = true
    requests = 0
    application = await launch()
    chrome = await chromeFor()
    await expect.poll(() => requests).toBeGreaterThan(0)
    hang = false
    await chrome.evaluate(pane => (window as any).bmux.command({ method: 'reload', args: { tab: pane } }), pane.id)
    await expect.poll(() => requests).toBeGreaterThan(1)
    let value = await chrome.evaluate(pane => (window as any).bmux.command({ method: 'eval', args: { tab: pane, expression: 'document.querySelector("main")?.textContent' } }), pane.id)
    expect(value).toBe('Usable evidence')
    let updated = await chrome.evaluate(() => (window as any).bmux.state())
    expect(updated.model.sessions[0].windows[0].panes[0].url).toBe(url)
  } finally {
    await application?.close().catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
