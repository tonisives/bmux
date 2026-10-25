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

test.beforeAll(async () => {
  await promisify(execFile)(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'remote/vite.config.ts'], { timeout: 30000 })
})

test('remote web Account exposes Apple linking and the linked provider status', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-auth-web-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let providers = { appleEnabled: true, appleLinked: false }
  let server = http.createServer((request, response) => {
    void (async () => {
      let url = new URL(request.url!, 'http://localhost'), route = url.pathname
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
  sockets.on('connection', socket => socket.send(JSON.stringify({ type: 'hosts', hosts: [] })))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    let config = path.join(directory, 'config.yaml')
    await fs.writeFile(config, 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
    await installDesktopWorkspaceFixture(application)
    await application.context().route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}}' }))
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${origin}/?view=account`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/?view=account`)).toBe(true)
    let page = application.context().pages().find(page => page.url() === `${origin}/?view=account`)!
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveAttribute('href', '/api/auth/providers/apple/link')
    await info.attach('apple-link-account', { body: await page.screenshot(), contentType: 'image/png' })
    providers = { appleEnabled: true, appleLinked: true }; await page.reload()
    await expect(page.getByText('Apple linked', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveCount(0)
    providers = { appleEnabled: false, appleLinked: false }; await page.reload()
    await expect(page.getByText('Account ID:', { exact: false })).toBeVisible()
    await expect(page.getByText('Apple linked', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Link Apple', exact: true })).toHaveCount(0)
  } finally {
    await closeTestApplication(application)
    for (let socket of sockets.clients) socket.terminate()
    await new Promise<void>(resolve => sockets.close(() => resolve()))
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
