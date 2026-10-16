import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { stringify } from 'yaml'
import { Server as ProxyServer } from 'proxy-chain'

test('keeps unavailable restored panes blocked while new panes can use the system connection', async () => {
  test.setTimeout(60000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-proxy-startup-'))
  let pageRequests = 0, proxyRequests = 0
  let server = http.createServer((request, response) => {
    if (request.url === '/ip') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ip: '203.0.113.12', city: 'Stockholm', country: 'Sweden' })); return }
    pageRequests++
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Restored through proxy</title><h1>Restored through proxy</h1>')
  })
  let proxy = new ProxyServer({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => { proxyRequests++; return { requestAuthentication: request.username !== 'saved-user' || request.password !== 'saved-password' } } })
  let application: ElectronApplication | undefined
  try {
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ browser: { autoUpdateFilters: false } }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let origin = `http://127.0.0.1:${(server.address() as any).port}`
    proxy.on('requestFailed', () => undefined)
    await proxy.listen()
    let launch = async () => electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `${origin}/ip` } })
    let chromeFor = async (running: ElectronApplication) => {
      await expect.poll(() => running.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
      return running.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    }
    let command = (chrome: Page, method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let currentState = (chrome: Page) => chrome.evaluate(() => (window as any).bmux.state())

    application = await launch()
    let chrome = await chromeFor(application)
    let current = await currentState(chrome), profile = current.model.profiles[0], tab = current.model.sessions[0].windows[0].panes[0]
    await command(chrome, 'navigate', { tab: tab.id, url: `${origin}/page` })
    let saved = await command(chrome, 'profile.proxy.set', { profile: profile.id, protocol: 'http', host: '127.0.0.1', port: proxy.port, authenticated: true, username: 'saved-user', password: 'saved-password' })
    let connectionId = saved.connectionId
    let proxied = await command(chrome, 'new-window', { session: current.model.sessions[0].id, profile: profile.id, client: current.clientId })
    await command(chrome, 'navigate', { pane: proxied.panes[0].id, url: `${origin}/page` })
    await command(chrome, 'kill-window', { window: current.model.sessions[0].windows[0].id, confirm: true })
    await expect.poll(() => proxyRequests).toBeGreaterThan(0)
    await closeTestApplication(application); application = undefined
    pageRequests = 0

    application = await launch()
    chrome = await chromeFor(application)
    await expect.poll(async () => (await currentState(chrome)).profileProxyTests[connectionId]?.ip, { timeout: 15000 }).toBe('203.0.113.12')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/page`)).toBe(true)
    expect((await currentState(chrome)).profileProxyFailures[connectionId]).toBeUndefined()
    await closeTestApplication(application); application = undefined
    await proxy.close(true)
    pageRequests = 0

    application = await launch()
    chrome = await chromeFor(application)
    await expect.poll(async () => (await currentState(chrome)).profileProxyFailures[connectionId]?.error, { timeout: 15000 }).toBeTruthy()
    await expect.poll(() => pageRequests).toBe(0)
    expect(application.context().pages().some(page => page.url() === `${origin}/page`)).toBe(false)
    let failure = chrome.getByRole('status').filter({ hasText: `Proxy for ${profile.name} could not connect` })
    await expect(failure).toContainText('Pages using it are paused')
    let proxyButton = chrome.getByRole('button', { name: `Proxy for ${profile.name}, unavailable`, exact: true })
    await expect(proxyButton).toBeVisible()
    await proxyButton.click()
    await expect(chrome.getByRole('dialog', { name: 'Proxy', exact: true })).toBeVisible()
    await chrome.getByRole('dialog', { name: 'Proxy', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    let otherProfile = current.model.profiles.find((item: { id: string }) => item.id !== profile.id)!
    let directSession = await command(chrome, 'new-session', { name: 'direct profile', profile: otherProfile.id }) as { id: string }
    let directClient = await command(chrome, 'attach-session', { session: directSession.id }) as { id: string }
    let directChrome: Page | undefined
    await expect.poll(async () => {
      for (let candidate of application!.context().pages().filter(page => page.url().endsWith('/renderer/index.html'))) if ((await currentState(candidate)).clientId === directClient.id) directChrome = candidate
      return !!directChrome
    }).toBe(true)
    await expect(directChrome!.getByText(`Proxy for ${profile.name} could not connect`)).toHaveCount(0)
    await failure.getByRole('button', { name: 'Proxy settings', exact: true }).click()
    await expect(chrome.getByRole('dialog', { name: 'Proxy', exact: true })).toBeVisible()
    await chrome.getByRole('dialog', { name: 'Proxy', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await command(chrome, 'profile.proxy.clear', { profile: profile.id })
    expect((await currentState(chrome)).model.sessions[0].windows[0].panes[0].connectionId).toBe(connectionId)
    expect(application.context().pages().some(page => page.url() === `${origin}/page`)).toBe(false)
    let direct = await command(chrome, 'new-window', { session: current.model.sessions[0].id, profile: profile.id, client: current.clientId })
    await command(chrome, 'navigate', { pane: direct.panes[0].id, url: `${origin}/page` })
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/page`)).toBe(true)
    await expect.poll(() => pageRequests).toBeGreaterThan(0)
    await expect.poll(async () => (await currentState(chrome)).model.profiles[0].proxy).toBeUndefined()
  } finally {
    await closeTestApplication(application)
    await proxy.close(true).catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

for (let trigger of ['automatic', 'button', 'focus']) test(`recovers paused proxy panes through ${trigger} retries without restarting`, async () => {
  test.setTimeout(90000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-proxy-recovery-'))
  let unavailable = false, failedProbes = 0, pageRequests = 0
  let server = http.createServer((request, response) => {
    if (request.url === '/ip') {
      if (unavailable) { failedProbes++; response.writeHead(503); response.end(); return }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ip: '203.0.113.12' })); return
    }
    pageRequests++
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Recovered proxy</title><h1>Recovered proxy</h1>')
  })
  let proxy = new ProxyServer({ host: '127.0.0.1', port: 0 })
  let application: ElectronApplication | undefined
  let command = (chrome: Page, method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
  let currentState = (chrome: Page) => chrome.evaluate(() => (window as any).bmux.state())
  try {
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ browser: { autoUpdateFilters: false } }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    await proxy.listen()
    let origin = `http://127.0.0.1:${(server.address() as any).port}`
    let launch = async () => {
      application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `${origin}/ip` } })
      await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
      return application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    }
    let chrome = await launch()
    let state = await currentState(chrome), profile = state.model.profiles[0]
    let saved = await command(chrome, 'profile.proxy.set', { profile: profile.id, protocol: 'http', host: '127.0.0.1', port: proxy.port, authenticated: false })
    let proxied = await command(chrome, 'new-window', { session: state.model.sessions[0].id, profile: profile.id, client: state.clientId })
    await command(chrome, 'navigate', { pane: proxied.panes[0].id, url: `${origin}/page` })
    await command(chrome, 'kill-window', { window: state.model.sessions[0].windows[0].id, confirm: true })
    await closeTestApplication(application); application = undefined
    unavailable = true; pageRequests = 0
    chrome = await launch()
    let failure = chrome.getByRole('status').filter({ hasText: `Proxy for ${profile.name} could not connect` })
    await expect(failure).toBeVisible()
    await expect.poll(() => failedProbes, { timeout: 30000 }).toBeGreaterThanOrEqual(trigger === 'automatic' ? 2 : 4)
    await expect(failure.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
    expect(pageRequests).toBe(0)
    if (trigger === 'button') {
      // Existing panes retain their saved route after the default changes.
      await command(chrome, 'profile.proxy.clear', { profile: profile.id })
      unavailable = false
      await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    } else if (trigger === 'focus') {
      await application!.evaluate(({ BaseWindow }) => { for (let window of BaseWindow.getAllWindows()) window.blur() })
      unavailable = false
      await application!.evaluate(({ BaseWindow }) => { BaseWindow.getAllWindows().find(window => window.isVisible())!.focus() })
    } else unavailable = false
    await expect(failure).toHaveCount(0, { timeout: 20000 })
    await expect.poll(async () => (await currentState(chrome)).profileProxyTests[saved.connectionId]?.ip).toBe('203.0.113.12')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/page`)).toBe(true)
    let page = application!.context().pages().find(page => page.url() === `${origin}/page`)!
    await expect(page.getByRole('heading', { name: 'Recovered proxy' })).toBeVisible()
    expect((await currentState(chrome)).model.sessions[0].windows[0].panes[0].connectionId).toBe(saved.connectionId)
  } finally {
    await closeTestApplication(application)
    await proxy.close(true).catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
