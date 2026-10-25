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
  let hosts = [{ id: 'fixture-host', service: 'Development machine', generation: 'fixture-runtime', permission: 'watch', key: { kty: 'OKP', crv: 'Ed25519', x: 'a'.repeat(43) }, sessions: [
    { id: 'research', name: 'Research', panes: [{ id: 'research-page', title: 'Example page' }] },
    { id: 'writing', name: 'Writing', panes: [{ id: 'writing-page', title: 'Draft' }] },
  ] }]
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
        let result = route === '/api/auth/providers' ? providers
          : route === '/api/me' ? { owner: 'fixture-owner' }
          : route === '/api/connect' ? { ticket: 'fixture-ticket', iceServers: [] }
          : route === '/api/config' ? { googleClientId: 'fixture' }
          : route === '/api/billing/status' ? { enabled: false, relay: { active: false, monthlyCents: 1000, currency: 'usd', maxStreams: 2, cancelRequested: false, status: 'inactive' } }
          : route === '/api/billing/rates' ? { base: 'USD', date: '2026-10-25', source: 'fixture', rates: { USD: 1 } } : []
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return
      }
      let file = route === '/' ? 'index.html' : route.slice(1)
      if (!/^(index\.html|assets\/[A-Za-z0-9._-]+)$/.test(file)) { response.writeHead(404); response.end(); return }
      let content = await fs.readFile(path.join('remote/dist', file))
      response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); response.end(content)
    })().catch(() => { response.writeHead(500); response.end() })
  })
  let sockets = new WebSocketServer({ server, path: '/connect' })
  sockets.on('connection', socket => socket.send(JSON.stringify({ type: 'hosts', hosts })))
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
    await info.attach('apple-link-account', { body: await page.screenshot(), contentType: 'image/png' })
    providers = { appleEnabled: true, appleLinked: true }; await page.reload()
    await expect(page.getByText('Apple linked', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveCount(0)
    providers = { appleEnabled: false, appleLinked: false }; await page.reload()
    await expect(page.getByText('Account ID:', { exact: false })).toBeVisible()
    await expect(page.getByText('Apple linked', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    let windowId = await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.isVisible())!.id)
    let resize = async (width: number, height: number) => {
      await application!.evaluate(({ BaseWindow }, { windowId, width, height }) => {
        setImmediate(() => BaseWindow.fromId(windowId)?.setContentSize(width, height))
      }, { windowId, width, height })
      await expect.poll(() => page.evaluate(height => ({ width: innerWidth, height: innerHeight > 0 && innerHeight <= height }), height)).toEqual({ width, height: true })
    }
    await resize(1280, 800)
    let library = page.getByRole('complementary', { name: 'Sessions', exact: true })
    let preview = page.getByRole('region', { name: 'Session preview', exact: true })
    await expect(library).toBeVisible(); await expect(preview).toBeVisible()
    let row = library.getByRole('button', { name: /Research.*Development machine/ })
    let rowBounds = await row.boundingBox(), previewBounds = await preview.boundingBox()
    expect(rowBounds!.x + rowBounds!.width).toBeLessThan(previewBounds!.x)
    let appearance = await row.evaluate(element => { let style = getComputedStyle(element); return { radius: parseFloat(style.borderRadius), color: style.backgroundColor.match(/\d+/g)!.map(Number) } })
    expect(appearance.radius).toBeGreaterThan(0)
    expect(new Set(appearance.color).size).toBe(1)
    await info.attach('remote-web-unselected', { body: await page.screenshot(), contentType: 'image/png' })
    await row.click()
    await expect(row).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('region', { name: 'Session viewer', exact: true })).toBeVisible()
    await expect(page.getByLabel('Remote browser')).toBeVisible()
    await resize(844, 390)
    await expect(library).toBeVisible()
    let landscapeRow = await row.boundingBox(), landscapeViewer = await page.getByLabel('Remote browser').boundingBox()
    expect(landscapeRow!.x + landscapeRow!.width).toBeLessThan(landscapeViewer!.x)
    expect(landscapeViewer!.height).toBeGreaterThan(150)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await info.attach('remote-web-landscape', { body: await page.screenshot(), contentType: 'image/png' })
    await resize(390, 844)
    await expect(library).toBeHidden()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(library).toBeVisible()
    await expect(page.getByLabel('Remote browser')).toHaveCount(0)
    await expect(row).not.toHaveAttribute('aria-current', 'true')
    await info.attach('remote-web-portrait', { body: await page.screenshot(), contentType: 'image/png' })
    await resize(1280, 800)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await address.fill(`${origin}/expired-apple-link`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/api/auth/apple/callback`)).toBe(true)
    let expired = application.context().pages().find(page => page.url() === `${origin}/api/auth/apple/callback`)!
    await expect(expired.getByRole('heading', { name: 'Apple sign-in expired', exact: true })).toBeVisible()
    await expect(expired.getByRole('link', { name: 'Link Apple', exact: true })).toHaveAttribute('href', '/api/auth/providers/apple/link')
    await info.attach('expired-apple-link', { body: await expired.screenshot(), contentType: 'image/png' })
  } finally {
    await closeTestApplication(application)
    for (let socket of sockets.clients) socket.terminate()
    await new Promise<void>(resolve => sockets.close(() => resolve()))
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
