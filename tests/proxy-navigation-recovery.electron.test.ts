import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('recovers failed tunnel panes on their retained connection without reloading healthy siblings', async () => {
  test.setTimeout(90000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-navigation-tunnel-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let available = true, probes = 0, healthyRequests = 0
  let sockets = new Set<Duplex>()
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1', '-subj', '/CN=localhost'], { cwd: directory })
  let destination = https.createServer({ key: await fs.readFile(path.join(directory, 'key.pem')), cert: await fs.readFile(path.join(directory, 'cert.pem')) }, (request, response) => {
    if (request.url === '/healthy') healthyRequests++
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><title>Recovered tunnel</title><main>${request.url}</main>`)
  })
  let proxy = http.createServer((_request, response) => {
    probes++
    response.setHeader('Content-Type', 'application/json')
    response.writeHead(available ? 200 : 503)
    response.end(JSON.stringify({ ip: '203.0.113.8' }))
  })
  proxy.on('connect', (_request, socket, head) => {
    if (!available) { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); return }
    let upstream = net.connect((destination.address() as net.AddressInfo).port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    for (let peer of [socket, upstream]) { sockets.add(peer); peer.on('close', () => sockets.delete(peer)) }
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy())
    socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy())
  })
  try {
    await Promise.all([new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve)), new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))])
    await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: 'http://probe.test/ip' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = () => command('state')
    let initial = await state(), profile = initial.model.profiles[0], session = initial.model.sessions[0]
    let saved = await command('profile.proxy.set', { profile: profile.id, protocol: 'http', host: '127.0.0.1', port: (proxy.address() as net.AddressInfo).port, authenticated: false })
    await application.evaluate(({ session }, connection: string) => { session.fromPartition(`persist:${connection}`).setCertificateVerifyProc((_request, callback) => callback(0)) }, saved.connectionId)
    let window = await command('new-window', { session: session.id, profile: profile.id, client: initial.clientId })
    let healthy = window.panes[0], first = await command('split-window', { pane: healthy.id, client: initial.clientId }), second = await command('split-window', { pane: first.id, client: initial.clientId })
    let origin = `https://localhost:${(destination.address() as net.AddressInfo).port}`
    await command('navigate', { pane: healthy.id, url: `${origin}/healthy` })
    expect(healthyRequests).toBe(1)
    // New hosts require new CONNECT tunnels instead of reusing the healthy socket.
    available = false
    await command('navigate', { pane: first.id, url: `https://first.localhost:${(destination.address() as net.AddressInfo).port}/first`, waitUntil: 'none' })
    await command('navigate', { pane: second.id, url: `https://second.localhost:${(destination.address() as net.AddressInfo).port}/second`, waitUntil: 'none' })
    for (let pane of [first, second]) await expect.poll(async () => (await state()).crashes[pane.id]).toContain('ERR_TUNNEL_CONNECTION_FAILED')
    let before = probes
    await expect.poll(() => probes, { timeout: 10000 }).toBeGreaterThan(before)
    expect((await state()).crashes[first.id]).toContain('ERR_TUNNEL_CONNECTION_FAILED')
    // A changed default must not move the failed panes off their original route.
    await command('profile.proxy.clear', { profile: profile.id })
    available = true
    for (let pane of [first, second]) {
      await expect.poll(async () => (await state()).crashes[pane.id], { timeout: 20000 }).toBeUndefined()
      await expect.poll(() => command('eval', { pane: pane.id, expression: 'document.querySelector("main")?.textContent' })).toBe(pane.id === first.id ? '/first' : '/second')
    }
    expect(healthyRequests).toBe(1)
    let restored = (await state()).model.sessions.flatMap((session: any) => session.windows.flatMap((window: any) => window.panes))
    for (let pane of [healthy, first, second]) expect(restored.find((item: any) => item.id === pane.id).connectionId).toBe(saved.connectionId)
  } finally {
    await closeTestApplication(application)
    for (let socket of sockets) socket.destroy()
    proxy.closeAllConnections(); destination.closeAllConnections()
    await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve())), new Promise<void>(resolve => destination.close(() => resolve()))])
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
