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
  let used = Date.now() - 120000
  let pages = [{ id: 'pane-primary', title: 'Example page', lastActivityAt: used }, { id: 'pane-secondary', title: 'Second page', lastActivityAt: used, agentPurpose: 'Compare sources' }]
  let host = { id: 'fixture-host', service: 'Research computer', machine: { name: 'Personal Mac', platform: 'darwin', arch: 'arm64', version: '0.1.10', revision: 'fixture' }, generation: 'runtime-current', permission: 'control', owner: false as boolean | undefined, capabilities: { management: 1, sessionCreate: 1, profiles: 1, proxy: 1, pageCreate: 1 }, key: { kty: 'OKP', crv: 'Ed25519', x: 'a'.repeat(43) }, sessions: [{ id: 'session-research', name: 'Research', lastActivityAt: used, panes: pages, windows: [{ id: 'window-research', name: 'Workspace', automaticName: false, lastActivityAt: used, panes: pages }] }] }
  let legacy = { id: 'legacy-host', service: 'Research computer', machine: { name: 'Research Linux', platform: 'linux', arch: 'x64' }, generation: 'legacy-runtime', permission: 'watch', key: { kty: 'OKP', crv: 'Ed25519', x: 'b'.repeat(43) }, sessions: [{ id: 'session-archive', name: 'Archive', panes: [{ id: 'pane-archive', title: 'Saved page' }] }] }
  let views = [{ connection: 'other-view', host: host.id, generation: host.generation, pane: 'other-pane' }]
  let signedIn = false
  let attentionGeneration = host.generation
  let requests: string[] = [], signals: { type: string; pane?: string; session?: string }[] = []
  let server = http.createServer((request, response) => {
    void (async () => {
      let route = new URL(request.url ?? '/', 'http://localhost').pathname
      let json = (body: unknown) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)) }
      requests.push(route)
      if (route === '/api/me') {
        if (!signedIn) { response.writeHead(401); response.end(); return }
        json({ owner: 'fixture-owner', name: 'Browser operator' }); return
      }
      if (route === '/api/hosts') { json([host, legacy]); return }
      if (route === '/api/connect') { json({ ticket: 'fixture-ticket', iceServers: [] }); return }
      let attention = { id: 'opaque-attention', revision: 1, reason: 'challenge', status: 'pending', createdAt: new Date().toISOString(), host: host.id, generation: attentionGeneration, session: 'session-research', pane: 'pane-secondary', episode: 'episode-fixture', online: true, resolved: false }
      if (route === '/api/attention') { json({ items: [attention], nextCursor: null }); return }
      if (route === '/api/attention/opaque-attention') { json(attention); return }
      if (route === '/api/attention/opaque-attention/inbox') { json({ ok: true }); return }
      if (route === '/api/billing/status') { json({ enabled: true, relay: { active: true, maxStreams: 2, monthlyCents: 1000, currency: 'usd' } }); return }
      if (route === '/api/streams') { json(views); return }
      if (route === '/api/streams/disconnect') { views = []; json({ ok: true }); return }
      if (route === '/api/hosted-browser') { json({ entitled: true, state: 'running', revision: 1, target: { host: host.id, generation: host.generation, session: 'session-research', pane: 'pane-primary' } }); return }
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
    socket.send(JSON.stringify({ type: 'hosts', hosts: [host, legacy] }))
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
    let resize = async (width: number, height = 800) => {
      await application!.evaluate(({ BrowserWindow }, { id, width, height }) => { setImmediate(() => BrowserWindow.fromId(id)?.setContentSize(width, height)) }, { id: windowId, width, height })
      await expect.poll(() => page!.evaluate(() => innerWidth)).toBe(width)
      if (height < 500) await expect.poll(() => page!.evaluate(() => innerHeight)).toBe(height)
      else await expect.poll(() => page!.evaluate(() => innerHeight)).toBeGreaterThanOrEqual(500)
    }
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Privacy policy', exact: true })).toHaveAttribute('href', 'https://bmux.cc/privacy/')
    await expect(page.getByRole('link', { name: 'Support', exact: true })).toHaveAttribute('href', 'https://tonis.dev/#contact')
    await page.screenshot({ path: info.outputPath('companion-welcome.png') })
    await page.getByRole('button', { name: 'Try demo', exact: true }).click()
    await expect(page.getByText('Demo', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Field Notes', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Field Notes', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Open Price tracker', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm stock', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Resume demo agent', exact: true })).toHaveCount(0)
    await expect.poll(() => page!.evaluate(() => [...document.fonts].filter(font => font.family === 'ionicons').map(font => font.status))).toEqual(['loaded'])
    await page.screenshot({ path: info.outputPath('companion-demo-desktop.png') })
    await resize(960, 390)
    await expect(page.getByText('Demo', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open page', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open Shopping research', exact: true })).toBeInViewport({ ratio: 1 })
    await expect.poll(async () => (await page!.getByTestId('demo-browser-page').boundingBox())?.height ?? 0).toBeGreaterThan(150)
    await page.getByRole('button', { name: 'Open Price tracker', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Price tracker', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Open Field Notes', exact: true })).toHaveAttribute('aria-selected', 'false')
    await expect(page.getByText('Notebook watchlist', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-demo-landscape.png') })
    await page.getByRole('button', { name: 'Open Field Notes', exact: true }).click()
    await resize(390)
    await expect(page.getByRole('button', { name: 'Open Field Notes', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Field Notes', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Price tracker', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-demo-mobile.png') })
    await page.getByRole('button', { name: 'Price tracker', exact: true }).click()
    await page.getByRole('button', { name: 'Attention, 1 pending', exact: true }).click()
    await expect(page.getByText('Demo browser · Shopping research', { exact: true })).toBeVisible()
    await expect(page.getByText('Field Notes', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-demo-alert-mobile.png') })
    await page.getByRole('button', { name: 'Open request: Agent needs your help, Demo browser · Shopping research, Field Notes', exact: true }).click()
    await expect(page.getByText('Pocket notebook', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm stock', exact: true })).toBeDisabled()
    await expect(page.getByText('Watch · Demo pages', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Take control', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm stock', exact: true }).click()
    await page.getByRole('button', { name: 'Price tracker', exact: true }).click()
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Resume demo agent', exact: true }).click()
    await expect(page.getByText('Demo agent resumed', { exact: true })).toBeVisible()
    await expect(page.getByText('Watch · Demo pages', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Shopping research', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Attention, 0 pending', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Shopping research', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'History', exact: true }).click()
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-demo-history-mobile.png') })
    await resize(1280)
    await expect(page.getByRole('button', { name: 'Open Shopping research', exact: true })).toBeVisible()
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-demo-history-desktop.png') })
    await resize(390)
    await expect(page.getByRole('button', { name: 'Open Shopping research', exact: true })).toHaveCount(0)
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    expect(signals).toHaveLength(0)
    expect(requests).not.toContain('/api/connect')
    await page.getByRole('button', { name: 'Exit demo', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await resize(1280)
    signedIn = true
    await page.reload()
    let machine = page.getByRole('button', { name: 'Machine Personal Mac', exact: true })
    await expect(machine).toBeVisible()
    await expect(page.getByRole('button', { name: 'Machine Research Linux', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Second page', exact: true })).toBeVisible()
    let session = page.getByRole('button', { name: 'Open Research', exact: true })
    await expect(session.getByLabel(/^Last used /)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Collapse windows in Research', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('button', { name: 'Collapse windows in Research', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Expand windows in Research', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Open Workspace', exact: true })).toHaveCount(0)
    await session.press('j'); await expect(page.getByRole('button', { name: 'Machine Research Linux', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Machine Research Linux', exact: true }).press('k'); await expect(session).toBeFocused()
    await session.press('l')
    await page.getByRole('button', { name: 'Collapse pages in Workspace', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Second page', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).press('l')
    await page.getByRole('button', { name: 'Collapse machine Research Linux', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Archive', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Machine Research Linux', exact: true }).press('l')
    await expect(page.getByRole('button', { name: 'Open Saved page', exact: true })).toBeVisible()
    let search = page.getByRole('textbox', { name: 'Search sessions', exact: true })
    await search.fill('Saved page')
    await expect(session).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open Saved page', exact: true })).toBeVisible()
    await search.fill('')
    await machine.click()
    await expect(page.getByText('macOS · arm64', { exact: true })).toBeVisible()
    await expect(page.getByText('bmux 0.1.10 · fixture', { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Machine color #e5a450', exact: true }).click()
    await expect(page.getByRole('radio', { name: 'Machine color #e5a450', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: info.outputPath('companion-machine-details.png') })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    await machine.click()
    await expect(page.getByRole('radio', { name: 'Machine color #e5a450', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New session', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Included browser', exact: true })).toHaveCount(0)
    await expect(page.getByText('Included browser', { exact: true })).toHaveCount(0)
    let sessionRow = await page.getByRole('button', { name: 'Open Research', exact: true }).boundingBox()
    let connectionRow = await page.getByRole('button', { name: 'Connect a machine', exact: true }).boundingBox()
    expect(connectionRow!.y).toBeGreaterThan(sessionRow!.y + sessionRow!.height)
    await expect(page.getByText('Browser needs attention', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Needs help', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-connected-list.png') })
    await expect.poll(() => page!.evaluate(() => [...document.fonts].filter(font => font.family === 'ionicons').map(font => font.status))).toEqual(['loaded'])
    await page.getByRole('button', { name: 'Open page', exact: true }).click()
    await expect.poll(() => signals.filter(message => message.type === 'open')).toHaveLength(1)
    expect(signals.find(message => message.type === 'open')).toMatchObject({ session: 'session-research', pane: 'pane-secondary' })
    await expect(page.getByText('Watch', { exact: true })).toBeVisible()
    expect(signals.some(message => ['acquire', 'resume', 'resize'].includes(message.type))).toBe(false)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByText('Browser operator', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Profiles', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Privacy policy', exact: true })).toHaveAttribute('href', 'https://bmux.cc/privacy/')
    await expect(page.getByRole('link', { name: 'Support', exact: true })).toHaveAttribute('href', 'https://tonis.dev/#contact')
    await expect(page.getByText('1 / 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    expect(requests).not.toContain('/api/streams/disconnect')
    await expect(page.getByText('Disconnect this view?', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).last().click()
    await expect(page.getByText('No live views', { exact: true })).toBeVisible()
    expect(requests.filter(route => route === '/api/streams/disconnect')).toHaveLength(1)
    await page.getByRole('button', { name: 'Sessions', exact: true }).first().click()
    await page.getByRole('button', { name: 'Open Research', exact: true }).click()
    await expect.poll(() => signals.filter(message => message.type === 'open')).toHaveLength(2)
    expect(signals.filter(message => message.type === 'open')[1]).toMatchObject({ session: 'session-research', pane: 'pane-primary' })
    await expect(page.getByText('Watch', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Take control', exact: true })).toBeDisabled()
    expect(signals.some(message => ['acquire', 'resume', 'resize'].includes(message.type))).toBe(false)
    await resize(960, 390)
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toBeInViewport({ ratio: 1 })
    await expect.poll(async () => (await page!.getByLabel('Remote browser viewport', { exact: true }).boundingBox())?.height ?? 0).toBeGreaterThan(150)
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-landscape-watch.png') })
    await resize(390)
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toHaveCount(0)
    await expect(page.getByText('Watch', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('companion-mobile-watch.png') })
    await resize(1280)
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toBeVisible()
    for (let socket of sockets.clients) socket.terminate()
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect.poll(() => signals.filter(message => message.type === 'open')).toHaveLength(3)
    expect(signals.filter(message => message.type === 'open')[2]).toMatchObject({ session: 'session-research', pane: 'pane-primary' })
    await expect(page.getByText('Watch', { exact: true })).toBeVisible()
    attentionGeneration = 'runtime-stale'
    await page.getByRole('button', { name: 'Attention, 1 pending', exact: true }).click()
    await page.getByText('Browser needs attention', { exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('The requested browser is no longer available.')
    await expect(page.getByRole('button', { name: 'Open Research', exact: true })).toBeVisible()
    expect(signals.filter(message => message.type === 'open')).toHaveLength(3)
    await page.screenshot({ path: info.outputPath('companion-stale-attention.png') })
    for (let owner of [true, undefined]) {
      host.owner = owner
      await page.reload()
      await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Profiles', exact: true })).toBeVisible()
    }
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
