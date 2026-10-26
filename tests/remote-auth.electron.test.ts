import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { WebSocketServer } from 'ws'
import { closeTestApplication } from './electron-fixture'
import { installDesktopWorkspaceFixture } from './desktop-workspace-fixture'
import { createMobileAuth } from '../remote/mobile-auth'

test.beforeAll(async () => {
  await promisify(execFile)(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'remote/vite.config.ts'], { timeout: 30000 })
})

test('remote web Account preserves Apple linking and the responsive session workspace', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-auth-web-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let providers = { appleEnabled: true, appleLinked: false }
  let signedIn = true, logoutFailed = false, logoutRequests = 0, connectRequests = 0
  let used = Date.now() - 120000
  let researchPages = [{ id: 'research-page', title: 'Example page', lastActivityAt: used }, { id: 'second-page', title: 'Comparison', lastActivityAt: used }, { id: 'notes-page', title: 'Notes', lastActivityAt: used }]
  let hosts = [{ id: 'fixture-host', service: 'Development machine', generation: 'fixture-runtime', permission: 'watch', machine: { name: 'Personal Mac', platform: 'darwin', arch: 'arm64', version: '0.1.10', revision: 'fixture' }, key: { kty: 'OKP', crv: 'Ed25519', x: 'a'.repeat(43) }, sessions: [
    { id: 'research', name: 'Research', lastActivityAt: used, panes: researchPages, windows: [
      { id: 'split-window', name: 'Workspace', automaticName: false, lastActivityAt: used, panes: researchPages.slice(0, 2) },
      { id: 'notes-window', name: 'Notes', automaticName: true, lastActivityAt: used, panes: researchPages.slice(2) },
    ] },
    { id: 'writing', name: 'Writing', panes: [{ id: 'writing-page', title: 'Draft' }] },
  ] }, { id: 'legacy-host', service: 'Development machine', generation: 'legacy-runtime', permission: 'watch', machine: { name: 'Research Linux', platform: 'linux', arch: 'x64', version: '0.1.9', revision: 'legacy' }, key: { kty: 'OKP', crv: 'Ed25519', x: 'b'.repeat(43) }, sessions: [{ id: 'legacy-session', name: 'Archive', panes: [{ id: 'legacy-page', title: 'Saved page' }] }] }]
  let signals: { type: string; pane?: string; session?: string }[] = []
  let server = http.createServer((request, response) => {
    void (async () => {
      let url = new URL(request.url!, 'http://localhost'), route = url.pathname
      if (route === '/expired-apple-link') {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(`<form method="post" action="/api/auth/apple/callback"><input name="state" value="${'a'.repeat(64)}"><input name="code" value="expired-code"></form><script>document.querySelector('form').submit()</script>`); return
      }
      if (route === '/api/auth/apple/callback') {
        let auth = createMobileAuth({ origin, googleClientId: 'fixture', pool: {}, revoked: () => {}, env: { BMUX_APPLE_CLIENT_ID: 'fixture', BMUX_APPLE_TEAM_ID: 'fixture', BMUX_APPLE_KEY_ID: 'fixture', BMUX_APPLE_PRIVATE_KEY: 'fixture' } } as unknown as Parameters<typeof createMobileAuth>[0])
        await auth.route(request, response, new URL(request.url!, origin), async () => ({})); return
      }
      if (route.startsWith('/api/')) {
        if (route === '/api/logout' && request.method === 'POST') {
          logoutRequests++
          if (logoutFailed) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Sign-out unavailable' })); return }
          signedIn = false
          for (let socket of sockets.clients) socket.close(1008, 'Signed out')
          response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: true })); return
        }
        if (!signedIn && route !== '/api/config') { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Sign in to continue' })); return }
        if (route === '/api/connect') connectRequests++
        if (route === '/api/services' && request.method === 'POST') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ service: 'self-hosted-fixture', key: 'c'.repeat(64) })); return }
        let result = route === '/api/auth/providers' ? providers
          : route === '/api/me' ? { owner: 'fixture-owner', entitlement: { canStream: true } }
          : route === '/api/connect' ? { ticket: 'fixture-ticket', iceServers: [] }
          : route === '/api/config' ? { googleClientId: 'fixture' }
          : route === '/api/billing/status' ? { enabled: false, relay: { active: false, monthlyCents: 1000, currency: 'usd', maxStreams: 2, cancelRequested: false, status: 'inactive' } }
          : route === '/api/billing/rates' ? { base: 'USD', date: '2026-10-25', source: 'fixture', rates: { USD: 1 } }
          : route === '/api/rentals/catalog' ? { enabled: false, quotes: [] } : []
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return
      }
      let file = route === '/' ? 'index.html' : route.slice(1)
      if (!/^(index\.html|assets\/[A-Za-z0-9._-]+)$/.test(file)) { response.writeHead(404); response.end(); return }
      let content = await fs.readFile(path.join('remote/dist', file))
      response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); response.end(content)
    })().catch(() => { response.writeHead(500); response.end() })
  })
  let sockets = new WebSocketServer({ server, path: '/connect' })
  sockets.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'hosts', hosts }))
    socket.on('message', value => { let message = JSON.parse(String(value)); if (message.type === 'signal') signals.push(JSON.parse(message.envelope.payload)) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    let config = path.join(directory, 'config.yaml')
    await fs.writeFile(config, 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
    await installDesktopWorkspaceFixture(application)
    await application.context().route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}}' }))
    await application.context().route('https://cdn.digthree.tonis.dev/bmux/website-ca1a3c8712d7/icon-512.png', async route => route.fulfill({ contentType: 'image/png', body: await fs.readFile('design/app-icon.png') }))
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${origin}/?view=account`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/?view=account`)).toBe(true)
    let page = application.context().pages().find(page => page.url() === `${origin}/?view=account`)!
    let icon = page.getByRole('button', { name: 'BMUX home', exact: true }).locator('img')
    await expect.poll(() => icon.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveAttribute('href', '/api/auth/providers/apple/link')
    await page.screenshot({ path: info.outputPath('apple-link-account.png') })
    providers = { appleEnabled: true, appleLinked: true }; await page.reload()
    await expect(page.getByText('Apple linked', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveCount(0)
    providers = { appleEnabled: false, appleLinked: false }; await page.reload()
    await expect(page.getByText('Account ID:', { exact: false })).toBeVisible()
    await expect(page.getByText('Apple linked', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    let windowId = await application.evaluate(({ BaseWindow }) => {
      let window = BaseWindow.getAllWindows().find(window => window.isVisible())!
      window.setMinimumSize(320, 240)
      return window.id
    })
    let content = chrome.locator('[data-content-pane-id]')
    let resize = async (width: number, height: number) => {
      await application!.evaluate(({ BaseWindow }, { windowId, width, height }) => {
        setImmediate(() => BaseWindow.fromId(windowId)?.setContentSize(width, height))
      }, { windowId, width, height })
      await expect.poll(() => chrome.evaluate(() => innerWidth)).toBe(width)
      // macOS limits tall test windows to the runner's available screen height.
      let native = await application!.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)!.getContentBounds(), windowId)
      await expect.poll(() => chrome.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: native.width, height: native.height })
      // The native page excludes the pane border, address field, and status bar.
      let bounds = (await content.boundingBox())!
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: Math.round(bounds.width), height: Math.round(bounds.height) })
    }
    await resize(1280, 800)
    let library = page.getByRole('complementary', { name: 'Sessions', exact: true })
    let preview = page.getByRole('region', { name: 'Session preview', exact: true })
    await expect(library).toBeVisible(); await expect(preview).toBeVisible()
    let row = library.getByRole('button', { name: 'Open Research', exact: true })
    let rowBounds = await row.boundingBox(), previewBounds = await preview.boundingBox()
    expect(rowBounds!.x + rowBounds!.width).toBeLessThan(previewBounds!.x)
    let appearance = await row.evaluate(element => { let style = getComputedStyle(element); return { radius: parseFloat(style.borderRadius), color: style.backgroundColor.match(/\d+/g)!.map(Number) } })
    expect(appearance.radius).toBeGreaterThan(0)
    expect(new Set(appearance.color).size).toBe(1)
    let personal = library.getByRole('button', { name: 'Machine Personal Mac', exact: true }), linux = library.getByRole('button', { name: 'Machine Research Linux', exact: true })
    let personalIcon = personal.getByRole('img', { name: 'macOS machine', exact: true })
    expect(await personalIcon.getAttribute('stroke')).not.toBe(await linux.getByRole('img', { name: 'Linux machine', exact: true }).getAttribute('stroke'))
    await expect(library.getByRole('group', { name: 'Sessions on Personal Mac', exact: true }).getByRole('button', { name: 'Open Research', exact: true })).toBeVisible()
    await expect(library.getByRole('group', { name: 'Windows in Research', exact: true }).getByRole('button', { name: 'Open Workspace', exact: true })).toBeVisible()
    await expect(library.getByRole('group', { name: 'Pages in Workspace', exact: true }).getByRole('button', { name: 'Open Comparison', exact: true })).toBeVisible()
    await expect(library.getByRole('button', { name: 'Open Saved page', exact: true })).toBeVisible()
    await expect(row.locator('time')).toHaveAttribute('title', /^Last used /)
    await library.getByRole('button', { name: 'Collapse windows in Research', exact: true }).click()
    await expect(library.getByRole('button', { name: 'Open Workspace', exact: true })).toHaveCount(0)
    await row.press('j'); await expect(library.getByRole('button', { name: 'Open Writing', exact: true })).toBeFocused()
    await library.getByRole('button', { name: 'Open Writing', exact: true }).press('k'); await expect(row).toBeFocused()
    await row.press('l')
    await library.getByRole('button', { name: 'Collapse pages in Workspace', exact: true }).click()
    await expect(library.getByRole('button', { name: 'Open Comparison', exact: true })).toHaveCount(0)
    await library.getByRole('button', { name: 'Open Workspace', exact: true }).press('l')
    await library.getByRole('button', { name: 'Collapse machine Research Linux', exact: true }).click()
    await expect(library.getByRole('button', { name: 'Open Archive', exact: true })).toHaveCount(0)
    await linux.press('l')
    await expect(library.getByRole('button', { name: 'Open Saved page', exact: true })).toBeVisible()
    await personal.click()
    let machine = page.getByRole('region', { name: 'Remote machine details', exact: true })
    await expect(machine).toContainText('macOS · arm64')
    await expect(machine).toContainText('0.1.10 · fixture')
    await machine.getByRole('radio', { name: 'Machine color #e5a450', exact: true }).click()
    await page.screenshot({ path: info.outputPath('remote-web-machine.png') })
    await machine.getByRole('button', { name: 'Back to preview', exact: true }).click()
    await expect(personal).toBeFocused()
    await expect(personalIcon).toHaveAttribute('stroke', '#e5a450')
    await page.screenshot({ path: info.outputPath('remote-web-unselected.png') })
    await library.getByRole('button', { name: 'Open Comparison', exact: true }).click()
    await expect.poll(() => signals.filter(message => message.type === 'open')).toHaveLength(1)
    expect(signals.find(message => message.type === 'open')).toMatchObject({ session: 'research', pane: 'second-page' })
    await expect(row).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('region', { name: 'Session viewer', exact: true })).toBeVisible()
    await expect(page.getByLabel('Remote browser')).toBeVisible()
    await resize(844, 390)
    await expect(library).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toBeHidden()
    let landscapeRow = await row.boundingBox(), landscapeViewer = await page.getByLabel('Remote browser').boundingBox()
    expect(landscapeRow!.x + landscapeRow!.width).toBeLessThan(landscapeViewer!.x)
    expect((await library.getByRole('button', { name: 'Open Comparison', exact: true }).locator('span').boundingBox())!.width).toBeGreaterThanOrEqual(60)
    expect(landscapeViewer!.height).toBeGreaterThan(150)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('remote-web-landscape.png') })
    await resize(390, 844)
    await expect(library).toBeHidden()
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(library).toBeVisible()
    await expect(page.getByLabel('Remote browser')).toHaveCount(0)
    await expect(row).not.toHaveAttribute('aria-current', 'true')
    await page.screenshot({ path: info.outputPath('remote-web-portrait.png') })
    await resize(1280, 800)
    await library.getByRole('button', { name: 'Add box', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Add box', level: 2, exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Self-hosted', exact: true }).check()
    await expect(page.getByRole('region', { name: 'Self-hosted box', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create host config', exact: true })).toBeEnabled()
    await expect(page.getByRole('combobox', { name: 'Estimates in', exact: true })).toHaveCount(0)
    await expect(page.getByText('Account ID:', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
    await expect(page.getByText('Billed in USD.', { exact: false })).toHaveCount(0)
    let chooser = (await page.getByRole('region', { name: 'Self-hosted box', exact: true }).boundingBox())!
    expect(chooser.width).toBeLessThanOrEqual(640)
    await page.getByRole('button', { name: 'Create host config', exact: true }).click()
    let download = page.getByRole('link', { name: 'Download config', exact: true })
    await expect(download).toHaveAttribute('href', /^blob:/)
    expect(await download.evaluate(async element => (await fetch((element as HTMLAnchorElement).href).then(response => response.json())).url)).toBe(origin)
    await page.screenshot({ path: info.outputPath('remote-web-add-box.png') })
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Account', level: 2, exact: true })).toBeVisible()
    await expect(page.getByText('Account ID:', { exact: false })).toBeVisible()
    logoutFailed = true
    let previousDeviceKey = await page.evaluate(() => localStorage.getItem('bmux-device-key'))
    expect(previousDeviceKey).not.toBeNull()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Sign-out unavailable')
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled()
    await expect(page.getByText('Account ID:', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('bmux-device-key'))).toBe(previousDeviceKey)
    logoutFailed = false
    let connectedBeforeLogout = connectRequests
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(`${origin}/`)
    await expect(page.getByRole('button', { name: 'Sign in with Google', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Sessions', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('bmux-known-account'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('bmux-device-key'))).toBeNull()
    await expect.poll(() => sockets.clients.size).toBe(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Sign in with Google', exact: true })).toBeEnabled()
    expect(connectRequests).toBe(connectedBeforeLogout)
    expect(logoutRequests).toBe(2)
    await page.screenshot({ path: info.outputPath('remote-web-signed-out.png') })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await address.fill(`${origin}/expired-apple-link`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/api/auth/apple/callback`)).toBe(true)
    let expired = application.context().pages().find(page => page.url() === `${origin}/api/auth/apple/callback`)!
    await expect(expired.getByRole('heading', { name: 'Apple sign-in expired', exact: true })).toBeVisible()
    await expect(expired.getByRole('link', { name: 'Link Apple', exact: true })).toHaveAttribute('href', '/api/auth/providers/apple/link')
    await expired.screenshot({ path: info.outputPath('expired-apple-link.png') })
  } finally {
    await closeTestApplication(application)
    for (let socket of sockets.clients) socket.terminate()
    await new Promise<void>(resolve => sockets.close(() => resolve()))
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
