import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { Server } from 'proxy-chain'

test('proxy defaults affect only new panes and preserve routes, cookies and credentials after restart', async () => {
  test.setTimeout(90000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-pane-proxy-'))
  let requests: string[][] = [[], []]
  let destination = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/ip' ? 'application/json' : 'text/html')
    response.end(request.url === '/ip' ? JSON.stringify({ ip: '203.0.113.8' }) : '<!doctype html><title>Proxy fixture</title><h1>Proxy fixture</h1>')
  })
  await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(destination.address() as { port: number }).port}`
  let proxies = requests.map((hits, index) => new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => {
    hits.push(request.request.url ?? '')
    return { requestAuthentication: request.username !== `user-${index}` || request.password !== `password-${index}` }
  } }))
  await Promise.all(proxies.map(proxy => proxy.listen()))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  let extensionDirectory = path.join(directory, 'fixture-extension')
  await fs.mkdir(extensionDirectory)
  await fs.writeFile(path.join(extensionDirectory, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Connection fixture', version: '1.0', content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }))
  await fs.writeFile(path.join(extensionDirectory, 'content.js'), "document.documentElement.dataset.connectionExtension = 'ready'")
  let application: ElectronApplication | undefined
  let launch = async () => electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `${origin}/ip` } })
  let chromeFor = async (app: ElectronApplication) => {
    await expect.poll(() => app.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    return app.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  }
  let command = (page: Page, method: string, args: Record<string, unknown> = {}) => page.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
  try {
    application = await launch()
    let chrome = await chromeFor(application), state = await command(chrome, 'state')
    let profile = state.model.profiles[0], session = state.model.sessions[0], original = session.windows[0].panes[0]
    await command(chrome, 'extension.load', { profile: profile.id, path: extensionDirectory })
    await command(chrome, 'navigate', { pane: original.id, url: `${origin}/original` })
    await command(chrome, 'eval', { pane: original.id, expression: "document.cookie = 'fixture_login=present; path=/'" })
    let set = (index: number) => command(chrome, 'profile.proxy.set', { profile: profile.id, protocol: 'http', host: '127.0.0.1', port: proxies[index].port, authenticated: true, username: `user-${index}`, password: `password-${index}` })
    let first = await set(0)
    let a = await command(chrome, 'new-window', { session: session.id, profile: profile.id, client: state.clientId })
    await command(chrome, 'navigate', { pane: a.panes[0].id, url: `${origin}/first` })
    expect(await command(chrome, 'eval', { pane: a.panes[0].id, expression: "document.cookie.includes('fixture_login=present')" })).toBe(true)
    await command(chrome, 'wait', { pane: a.panes[0].id, expression: "document.documentElement.dataset.connectionExtension === 'ready'" })
    expect(requests[0].some(url => url.endsWith('/first'))).toBe(true)
    let second = await set(1)
    expect(second.connectionId).not.toBe(first.connectionId)
    expect(second.connections.find((connection: { id: string }) => connection.id === first.connectionId).proxy.port).toBe(proxies[0].port)
    let b = await command(chrome, 'split-window', { pane: a.panes[0].id, profile: profile.id, client: state.clientId })
    await command(chrome, 'navigate', { pane: b.id, url: `${origin}/second` })
    expect(requests[0].filter(url => url.endsWith('/first'))).toHaveLength(1)
    await command(chrome, 'navigate', { pane: a.panes[0].id, url: `${origin}/first-again` })
    await command(chrome, 'navigate', { pane: original.id, url: `${origin}/original-again` })
    expect(requests[0].some(url => url.endsWith('/first-again'))).toBe(true)
    expect(requests[1].some(url => url.endsWith('/second'))).toBe(true)
    expect(requests[1].some(url => url.endsWith('/first-again'))).toBe(false)
    expect(requests.flat().some(url => url.endsWith('/original-again'))).toBe(false)
    await application.close(); application = undefined
    requests.forEach(hits => { hits.length = 0 })
    application = await launch(); chrome = await chromeFor(application)
    await command(chrome, 'navigate', { pane: a.panes[0].id, url: `${origin}/restored-first` })
    await command(chrome, 'navigate', { pane: b.id, url: `${origin}/restored-second` })
    expect(requests[0].some(url => url.endsWith('/restored-first'))).toBe(true)
    expect(requests[1].some(url => url.endsWith('/restored-second'))).toBe(true)
    await command(chrome, 'profile.proxy.clear', { profile: profile.id })
    await command(chrome, 'navigate', { pane: b.id, url: `${origin}/second-after-clear` })
    expect(requests[1].some(url => url.endsWith('/second-after-clear'))).toBe(true)
    let direct = await command(chrome, 'new-window', { session: session.id, profile: profile.id, client: state.clientId })
    await command(chrome, 'navigate', { pane: direct.panes[0].id, url: `${origin}/new-direct` })
    expect(requests.flat().some(url => url.endsWith('/new-direct'))).toBe(false)
  } finally {
    await application?.close()
    await Promise.all(proxies.map(proxy => proxy.close(true)))
    await new Promise<void>(resolve => destination.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
