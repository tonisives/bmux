import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Server } from 'proxy-chain'

test('a failed proxy never falls back to direct HTTP or HTTPS for an already loaded pane', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-proxy-failure-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let requests: string[] = [], secureConnections = 0
  let destination = http.createServer((request, response) => {
    requests.push(request.url ?? '')
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Content-Type', request.url === '/ip' ? 'application/json' : 'text/html')
    response.end(request.url === '/ip' ? JSON.stringify({ ip: '203.0.113.8' }) : '<!doctype html><title>Proxy failure fixture</title><main>Proxy failure fixture</main>')
  })
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1', '-subj', '/CN=localhost'], { cwd: directory })
  let secure = https.createServer({ key: await fs.readFile(path.join(directory, 'key.pem')), cert: await fs.readFile(path.join(directory, 'cert.pem')) }, (_request, response) => response.end('Direct HTTPS destination'))
  secure.on('connection', () => { secureConnections++ })
  let proxy = new Server({ host: '127.0.0.1', port: 0 })
  try {
    await Promise.all([new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve)), new Promise<void>(resolve => secure.listen(0, '127.0.0.1', resolve)), proxy.listen()])
    let origin = `http://127.0.0.1:${(destination.address() as { port: number }).port}`
    let secureOrigin = `https://127.0.0.1:${(secure.address() as { port: number }).port}`
    await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd(), '--ignore-certificate-errors'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `${origin}/ip` } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await command('state'), profile = state.model.profiles[0], session = state.model.sessions[0]
    await command('profile.proxy.set', { profile: profile.id, protocol: 'http', host: '127.0.0.1', port: proxy.port, authenticated: false })
    let createdWindow = await command('new-window', { session: session.id, profile: profile.id, client: state.clientId }), pane = createdWindow.panes[0]
    await command('navigate', { pane: pane.id, url: `${origin}/healthy` })
    await command('wait', { pane: pane.id, expression: "document.querySelector('main')?.textContent === 'Proxy failure fixture'" })
    expect(requests).toContain('/healthy')
    await proxy.close(true)
    // The browser has already verified this connection. Subsequent requests must
    // still use its failed relay, including Chromium's usual loopback bypass.
    expect(await command('eval', { pane: pane.id, expression: `fetch('${origin}/blocked-fetch').then(() => 'loaded', () => 'failed')` })).toBe('failed')
    let open = async (url: string) => {
      let area = chrome.locator(`[data-pane-id="${pane.id}"]`)
      let address = area.getByRole('textbox', { name: 'URL or search', exact: true })
      if (!await address.count()) await area.getByRole('button', { name: 'Address', exact: true }).click()
      await address.fill(url); await address.press('Enter')
      await expect(address).toHaveCount(0)
      await expect.poll(async () => {
        let current = await command('state')
        return !!current.crashes[pane.id] && !current.loading[pane.id]
      }).toBe(true)
    }
    await open(`${origin}/blocked-http`)
    expect(requests).not.toContain('/blocked-fetch')
    expect(requests).not.toContain('/blocked-http')
    await open(`${secureOrigin}/blocked-https`)
    expect(secureConnections).toBe(0)
    expect((await command('state')).model.sessions.flatMap((item: any) => item.windows.flatMap((window: any) => window.panes)).find((item: any) => item.id === pane.id).connectionId).toBe(pane.connectionId)
  } finally {
    await closeTestApplication(application)
    await proxy.close(true).catch(() => undefined)
    destination.closeAllConnections(); secure.closeAllConnections()
    await Promise.all([new Promise<void>(resolve => destination.close(() => resolve())), new Promise<void>(resolve => secure.close(() => resolve()))])
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
