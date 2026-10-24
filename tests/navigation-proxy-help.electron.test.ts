import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

test('failed proxied panes explain local routes, retain their connection and clear help on recovery', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-proxy-help-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let destination = http.createServer((request, response) => {
    if (request.url === '/fail') { request.socket.destroy(); return }
    response.setHeader('Content-Type', request.url === '/ip' ? 'application/json' : 'text/html')
    response.end(request.url === '/ip' ? JSON.stringify({ ip: '203.0.113.8' }) : '<!doctype html><title>Connection help fixture</title><main>Connection help fixture</main>')
  })
  let proxy = http.createServer((request, response) => {
    let upstream = http.get(request.url!, incoming => { response.writeHead(incoming.statusCode!, incoming.headers); incoming.pipe(response) })
    upstream.on('error', () => response.destroy())
  })
  proxy.on('connect', (_request, socket) => socket.destroy())
  try {
    await Promise.all([new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve)), new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))])
    let origin = `http://127.0.0.1:${(destination.address() as { port: number }).port}`
    await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `${origin}/ip` } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state()), profile = state.model.profiles[0], session = state.model.sessions[0], direct = session.windows[0].panes[0]
    await command('activate-client', { client: state.clientId })
    await command('profile.proxy.set', { profile: profile.id, protocol: 'http', host: '127.0.0.1', port: (proxy.address() as { port: number }).port, authenticated: false })
    let createdWindow = await command('new-window', { session: session.id, profile: profile.id, client: state.clientId })
    let pane = createdWindow.panes[0]
    await command('select-pane', { client: state.clientId, pane: pane.id })
    let content = chrome.locator(`[data-pane-id="${pane.id}"] [data-pane-content]`)
    let open = async (paneId: string, url: string) => {
      let pane = chrome.locator(`[data-pane-id="${paneId}"]`), address = pane.getByRole('textbox', { name: 'URL or search', exact: true })
      await expect(pane).toBeVisible()
      if (!await address.count()) await pane.getByRole('button', { name: 'Address', exact: true }).click()
      await address.fill(url); await address.press('Enter')
      await expect(address).toHaveCount(0)
    }
    await open(pane.id, `${origin}/healthy`)
    await expect.poll(() => application!.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some(view => 'webContents' in view && view.getVisible() && (view as Electron.WebContentsView).webContents.getURL() === url && view.getBounds().width > 300)), `${origin}/healthy`)).toBe(true)
    // Turning off the default leaves this already-open pane on its retained proxy.
    await command('profile.proxy.clear', { profile: profile.id })
    await open(pane.id, `${origin.replace('http:', 'https:')}/unreachable`)
    let note = content.getByRole('note', { name: 'Proxy connection help' })
    await expect(note).toContainText('127.0.0.1 points to a local or private address')
    await expect(note).toContainText('Use for new panes')
    await expect(content.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
    await chrome.screenshot({ path: info.outputPath('proxy-local-help.png') })
    await open(pane.id, 'https://unresolved.custom-domain.test/unreachable')
    await expect(note).toContainText('If unresolved.custom-domain.test is a local app')
    await expect(note).not.toContainText('points to a local or private address')
    await command('break-pane', { pane: pane.id, client: state.clientId, floating: true })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith(`#float=${pane.id}`))).toBe(true)
    let floating = application.context().pages().find(page => page.url().endsWith(`#float=${pane.id}`))!
    await expect(floating.getByRole('note', { name: 'Proxy connection help' })).toContainText('If unresolved.custom-domain.test is a local app')
    let address = floating.getByRole('textbox', { name: 'Address', exact: true })
    await address.fill(`${origin}/recovered`); await address.press('Enter')
    await expect.poll(() => command('eval', { pane: pane.id, expression: 'document.querySelector("main")?.textContent' })).toBe('Connection help fixture')
    expect((await command('state')).navigationProxyHints[pane.id]).toBeUndefined()
    await expect(floating.getByRole('note', { name: 'Proxy connection help' })).toHaveCount(0)
    await command('select-window', { client: state.clientId, window: session.windows[0].id })
    await command('select-pane', { client: state.clientId, pane: direct.id })
    await open(direct.id, `${origin}/fail`)
    let directContent = chrome.locator(`[data-pane-id="${direct.id}"] [data-pane-content]`)
    await expect(directContent).toContainText('ERR_EMPTY_RESPONSE')
    await expect(directContent.getByRole('note', { name: 'Proxy connection help' })).toHaveCount(0)
  } finally {
    await closeTestApplication(application)
    proxy.closeAllConnections(); destination.closeAllConnections()
    await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve())), new Promise<void>(resolve => destination.close(() => resolve()))])
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
