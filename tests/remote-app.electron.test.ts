import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { closeTestApplication } from './electron-fixture'

test('remote companion lists sessions, opens watch-only, and rejects stale attention without fallback', async ({}, info) => {
  let exported = path.resolve('remote-app/dist')
  test.skip(!await fs.stat(path.join(exported, 'index.html')).then(() => true, () => false), 'Requires the Metro web export from the Remote app workflow')
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-companion-test-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let page: Page | undefined
  let host = { id: 'fixture-host', service: 'Research computer', generation: 'runtime-current', permission: 'control', key: { kty: 'OKP', crv: 'Ed25519', x: 'a'.repeat(43) }, sessions: [{ id: 'session-research', name: 'Research', panes: [{ id: 'pane-primary', title: 'Example page' }, { id: 'pane-secondary', title: 'Second page' }] }] }
  let views = [{ connection: 'other-view', host: host.id, generation: host.generation, pane: 'other-pane' }]
  let requests: string[] = [], signals: { type: string; pane?: string; session?: string }[] = []
  let server = http.createServer((request, response) => {
    void (async () => {
      let route = new URL(request.url ?? '/', 'http://localhost').pathname
      let json = (body: unknown) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)) }
      requests.push(route)
      if (route === '/api/me') { json({ owner: 'fixture-owner', name: 'Browser operator' }); return }
      if (route === '/api/hosts') { json([host]); return }
      if (route === '/api/connect') { json({ ticket: 'fixture-ticket', iceServers: [] }); return }
      let attention = { id: 'opaque-attention', revision: 1, reason: 'help', status: 'pending', createdAt: new Date().toISOString(), host: host.id, generation: 'runtime-stale', session: 'session-research', pane: 'pane-secondary', episode: 'episode-fixture', online: true, resolved: false }
      if (route === '/api/attention') { json({ items: [attention], nextCursor: null }); return }
      if (route === '/api/attention/opaque-attention') { json(attention); return }
      if (route === '/api/billing/status') { json({ enabled: true, relay: { active: true, maxStreams: 2, monthlyCents: 1000, currency: 'usd' } }); return }
      if (route === '/api/streams') { json(views); return }
      if (route === '/api/streams/disconnect') { views = []; json({ ok: true }); return }
      let file = path.join(exported, decodeURIComponent(route))
      if (!file.startsWith(exported + path.sep)) { response.writeHead(404); response.end(); return }
      let content = await fs.readFile(file).catch(async error => {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error
        if (path.extname(route)) return undefined
        file = path.join(exported, 'index.html')
        return fs.readFile(file)
      })
      if (!content) { response.writeHead(404); response.end(); return }
      let mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }); response.end(content)
    })().catch(() => { response.writeHead(500); response.end() })
  })
  let sockets = new WebSocketServer({ server, path: '/connect' })
  sockets.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'hosts', hosts: [host] }))
    socket.on('message', value => {
      let message = JSON.parse(String(value))
      if (message.type === 'signal') signals.push(JSON.parse(message.envelope.payload))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  try {
    let config = path.join(directory, 'config.yaml')
    await fs.writeFile(config, 'browser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd(), '--background'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '1' } })
    let windowId = await application.evaluate(async ({ BrowserWindow }, origin) => {
      let window = new BrowserWindow({ show: true, width: 1280, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      await window.loadURL(origin)
      setImmediate(() => window.focus())
      return window.id
    }, origin)
    await expect.poll(() => application!.context().pages().some(page => page.url() === origin + '/')).toBe(true)
    page = application.context().pages().find(page => page.url() === origin + '/')!
    await expect(page.getByRole('button', { name: 'Research computer', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Second page', exact: true })).toBeVisible()
    await expect.poll(() => page!.evaluate(() => [...document.fonts].filter(font => font.family === 'ionicons').map(font => font.status))).toEqual(['loaded'])
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByText('Browser operator', { exact: true })).toBeVisible()
    await expect(page.getByText('1 / 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    expect(requests).not.toContain('/api/streams/disconnect')
    await expect(page.getByText('Disconnect this view?', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).last().click()
    await expect(page.getByText('No live views', { exact: true })).toBeVisible()
    expect(requests.filter(route => route === '/api/streams/disconnect')).toHaveLength(1)
    await page.getByRole('button', { name: 'Sessions', exact: true }).first().click()
    await page.getByRole('button', { name: 'Open Research', exact: true }).click()
    await expect.poll(() => signals.filter(message => message.type === 'open')).toHaveLength(1)
    expect(signals.find(message => message.type === 'open')).toMatchObject({ session: 'session-research', pane: 'pane-primary' })
    await expect(page.getByText('Watch', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Take control', exact: true })).toBeDisabled()
    expect(signals.some(message => ['acquire', 'resume', 'resize'].includes(message.type))).toBe(false)
    let resize = async (width: number) => {
      await application!.evaluate(({ BrowserWindow }, { id, width }) => { setImmediate(() => BrowserWindow.fromId(id)?.setContentSize(width, 800)) }, { id: windowId, width })
      await expect.poll(() => page!.evaluate(() => innerWidth)).toBe(width)
    }
    await resize(390)
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toHaveCount(0)
    await expect(page.getByText('Watch', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-mobile-watch.png') })
    await resize(1280)
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toBeVisible()
    for (let socket of sockets.clients) socket.terminate()
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect.poll(() => signals.filter(message => message.type === 'open')).toHaveLength(2)
    expect(signals.filter(message => message.type === 'open')[1]).toMatchObject({ session: 'session-research', pane: 'pane-primary' })
    await expect(page.getByText('Watch', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Attention, 1 pending', exact: true }).click()
    await page.getByText('Agent needs your help', { exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('The requested browser is no longer available.')
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toBeVisible()
    expect(signals.filter(message => message.type === 'open')).toHaveLength(2)
    await page.screenshot({ path: info.outputPath('companion-stale-attention.png') })
  } finally {
    if (page && info.status !== info.expectedStatus) {
      await page.screenshot({ path: info.outputPath('companion-failure.png') }).catch(() => {})
      let layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, elements: [...document.querySelectorAll('[aria-label="Open Research"]')].map(element => {
        let ancestors = [], current: Element | null = element
        while (current && ancestors.length < 8) {
          let rect = current.getBoundingClientRect(), style = getComputedStyle(current)
          ancestors.push({ tag: current.tagName, x: rect.x, y: rect.y, width: rect.width, height: rect.height, flex: style.flex, display: style.display, overflow: style.overflow })
          current = current.parentElement
        }
        return ancestors
      }) })).catch(() => ({}))
      await info.attach('companion-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' })
    }
    await closeTestApplication(application)
    for (let socket of sockets.clients) socket.terminate()
    sockets.close(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
