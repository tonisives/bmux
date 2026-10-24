import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http2 from 'node:http2'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('retains an HTTP2 navigation error and reconnects when Reload is clicked', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-http2-recovery-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server: http2.Http2SecureServer | undefined
  let connections = new Set<http2.ServerHttp2Session>()
  let rejected: http2.Http2Session | undefined, recovered: http2.Http2Session | undefined
  let held = 0
  try {
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { cwd: directory })
    server = http2.createSecureServer({ key: await fs.readFile(path.join(directory, 'key.pem')), cert: await fs.readFile(path.join(directory, 'cert.pem')) })
    server.on('session', connection => {
      connections.add(connection)
      connection.on('error', () => undefined)
      connection.on('close', () => connections.delete(connection))
    })
    server.on('stream', (stream, headers) => {
      stream.on('error', () => undefined)
      if (headers[':path'] === '/hold') {
        held++
        stream.respond({ ':status': 200, 'content-type': 'text/html' })
        stream.write('<!doctype html><title>Streaming fixture</title><main>Streaming fixture</main>')
        return
      }
      if (headers[':path'] !== '/page') { stream.respond({ ':status': 204 }); stream.end(); return }
      rejected ??= stream.session
      if (stream.session === rejected) { stream.close(http2.constants.NGHTTP2_PROTOCOL_ERROR); return }
      recovered = stream.session
      stream.respond({ ':status': 200, 'content-type': 'text/html' })
      stream.end('<!doctype html><title>Recovered fixture</title><main>Recovered fixture</main>')
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    let origin = `https://localhost:${(server.address() as { port: number }).port}`
    await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown>) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let session = state.model.sessions[0], client = state.model.clients.find((item: any) => item.id === state.clientId)
    let profile = state.model.profiles[0]
    await application.evaluate(async ({ session }, { profile, origin }) => {
      let browser = session.fromPartition(`persist:${profile}`)
      browser.setCertificateVerifyProc((request, callback) => callback(request.hostname === 'localhost' ? 0 : -3))
      await browser.cookies.set({ url: origin, name: 'retained-fixture', value: 'present' })
    }, { profile: profile.id, origin })
    let open = async (pane: string, url: string) => {
      await chrome.locator(`[data-pane-id="${pane}"]`).getByRole('button', { name: 'Address', exact: true }).click()
      let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
      await address.fill(url); await address.press('Enter')
      await expect(address).toHaveCount(0)
    }
    await open(session.windows[0].panes[0].id, `${origin}/hold`)
    await expect.poll(() => held).toBe(1)
    let pane = await command('split-window', { pane: session.windows[0].panes[0].id, axis: 'horizontal' }) as any
    await command('select-pane', { client: client.id, pane: pane.id })
    await expect(chrome.locator(`[data-pane-id="${pane.id}"]`)).toBeVisible()
    await command('eval', { tab: pane.id, expression: 'document.title = "Recovery target"' })
    await application.evaluate(({ webContents }) => {
      ;(globalThis as any).http2FailureFinished = false
      webContents.getAllWebContents().find(contents => contents.getTitle() === 'Recovery target')!.once('did-finish-load', () => { (globalThis as any).http2FailureFinished = true })
    })
    await open(pane.id, `${origin}/page`)
    await expect.poll(() => application!.evaluate(() => (globalThis as any).http2FailureFinished)).toBe(true)
    let content = chrome.locator(`[data-pane-id="${pane.id}"] [data-pane-content]`)
    await expect(content).toContainText('ERR_HTTP2_PROTOCOL_ERROR')
    await expect.poll(async () => (await chrome.evaluate(() => (window as any).bmux.state())).loading[pane.id] ?? false).toBe(false)
    await content.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect.poll(() => recovered !== undefined).toBe(true)
    expect(recovered).not.toBe(rejected)
    await expect.poll(() => command('eval', { tab: pane.id, expression: 'document.querySelector("main")?.textContent' })).toBe('Recovered fixture')
    expect((await chrome.evaluate(() => (window as any).bmux.state())).crashes[pane.id]).toBeUndefined()
    expect(await application.evaluate(async ({ session }, { profile, origin }) => (await session.fromPartition(`persist:${profile}`).cookies.get({ url: origin, name: 'retained-fixture' })).length, { profile: profile.id, origin })).toBe(1)
    await expect.poll(() => application!.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url)), `${origin}/page`)).toBe(true)
  } finally {
    await closeTestApplication(application)
    for (let connection of connections) connection.destroy()
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
