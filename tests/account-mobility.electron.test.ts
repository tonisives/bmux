import { test, expect, _electron as electron } from '@playwright/test'
import { build } from 'vite'
import { externalizeDepsPlugin } from 'electron-vite'
import { WebSocketServer, createWebSocketStream } from 'ws'
import fs from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pageVimPlugin } from '../page-vim-build'
import { closeTestApplication } from './electron-fixture'

test('account migration restores login storage once and keeps the retired source inactive after relaunch', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-mobility-electron-')), output = path.join(directory, 'build'), source = path.join(directory, 'source'), target = path.join(directory, 'target')
  await fs.mkdir(output); await fs.writeFile(path.join(output, 'package.json'), '{"type":"module"}')
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(output, 'node_modules'))
  for (let name of ['preload','renderer','native']) await fs.symlink(path.join(process.cwd(), 'out', name), path.join(output, name))
  for (let data of [source, target]) { await fs.mkdir(data); await fs.writeFile(path.join(data, 'config.yaml'), JSON.stringify({ keyboard: {}, browser: { autoUpdateFilters: false } })) }
  await build({ configFile: false, logLevel: 'error', plugins: [externalizeDepsPlugin(), pageVimPlugin()], build: { ssr: true, emptyOutDir: false, outDir: path.join(output, 'main'), rollupOptions: { input: 'tests/fixtures/account-mobility-main.ts', output: { format: 'es', entryFileNames: 'main.js' } } } })
  let requests = 0, sockets = new Set<net.Socket>()
  let proxy = http.createServer((request, response) => {
    requests++
    if (request.url?.endsWith('/ip')) { response.setHeader('Content-Type', 'application/json'); response.end('{"ip":"203.0.113.7"}'); return }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Migration fixture</title><h1>Migration fixture</h1>')
  })
  proxy.on('connect', (_request, socket) => { socket.end('HTTP/1.1 502 Fixture only\r\n\r\n') })
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  let port = (proxy.address() as net.AddressInfo).port, gateway = http.createServer(), ws = new WebSocketServer({ server: gateway })
  ws.on('connection', (socket, request) => {
    if (request.headers.authorization !== 'Bearer fixture') { socket.close(); return }
    let upstream = net.connect(port, '127.0.0.1'), stream = createWebSocketStream(socket)
    upstream.on('error', () => stream.destroy()); stream.on('error', () => upstream.destroy()); stream.on('close', () => upstream.destroy()); upstream.on('close', () => stream.destroy()); upstream.pipe(stream).pipe(upstream)
  })
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(gateway.address() as net.AddressInfo).port}`, url = `http://www.tiktok.com:${port}/`
  let launch = () => electron.launch({ args: [path.join(output, 'main/main.js')], env: { ...process.env, BMUX_DATA_DIR: source, BMUX_CONFIG: path.join(source, 'config.yaml'), BMUX_PROXY_TEST_URL: 'http://proxy.fixture/ip' } })
  let application = await launch()
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let provision = await application.evaluate(async (_electron, origin) => {
      let runtime = (globalThis as any).remoteLayoutRuntime
      runtime.accounts.proxies.configure({ origin, token: 'fixture', host: 'fixture', generation: 'fixture' })
      let command = { id: '10000000-0000-4000-8000-000000000001', account: '20000000-0000-4000-8000-000000000001', phase: 'provision', identity: null, seal: null, operation: { request: { route: 'us-west', width: 1200, height: 800 }, targetKey: runtime.accounts.mobility.publicKey(), platform: 'tiktok', persona: 'Fixture', label: 'Fixture' }, expires: Date.now() + 30000 }
      let receipt = await runtime.accounts.mobility.apply(command, () => true)
      if (!runtime.model.accountSeals[receipt.identity.paneId].userAgentMetadata) throw new Error('Client hints were not sealed')
      await runtime.accounts.mobility.apply(command, () => true)
      if (Object.values(runtime.model.accountSeals).length !== 1) throw new Error('Duplicate provision')
      await runtime.accounts.mobility.apply({ ...command, phase: 'activate' }, () => true)
      return receipt
    }, origin)
    await application.evaluate(async (_electron, { identity, url }) => {
      let runtime = (globalThis as any).remoteLayoutRuntime, lease = runtime.remote.acquire(identity.sessionId, 'fixture', false)
      try { await runtime.remote.command('fixture', lease.generation, { method: 'navigate', args: { pane: identity.paneId, url } }) } finally { runtime.remote.release(identity.sessionId, 'fixture') }
    }, { identity: provision.identity as any, url })
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await page.evaluate(async () => {
      document.cookie = 'login=fixture; path=/'
      localStorage.setItem('login', 'fixture')
      await new Promise<void>((resolve, reject) => { let request = indexedDB.open('login', 1); request.onupgradeneeded = () => request.result.createObjectStore('tokens'); request.onerror = () => reject(request.error); request.onsuccess = () => { let db = request.result, tx = db.transaction('tokens', 'readwrite'); tx.objectStore('tokens').put({ token: 'fixture', at: new Date(123), bytes: new Uint8Array([1,2,3]) }, 'login'); tx.oncomplete = () => { db.close(); resolve() } } })
    })
    let move = await application.evaluate(async (_electron, { target, origin, provision }) => {
      let source = (globalThis as any).remoteLayoutRuntime, destination = (globalThis as any).createMobilityRuntime(target)
      ;(globalThis as any).mobilityTarget = destination
      await destination.start(true)
      destination.accounts.proxies.configure({ origin, token: 'fixture', host: 'fixture', generation: 'fixture' })
      let command = { id: '30000000-0000-4000-8000-000000000001', account: '20000000-0000-4000-8000-000000000001', phase: 'export', identity: provision.identity, seal: provision.seal, operation: { request: {}, targetKey: destination.accounts.mobility.publicKey(), platform: 'tiktok', persona: 'Fixture', label: 'Fixture' }, expires: Date.now() + 30000 }
      let result = await source.accounts.mobility.apply(command, () => true)
      let imported = await destination.accounts.mobility.apply({ ...command, phase: 'import', capsule: result.capsule }, () => true)
      await destination.accounts.mobility.apply({ ...command, phase: 'import', capsule: result.capsule }, () => true)
      if (Object.values(destination.model.accountSeals).length !== 1) throw new Error('Duplicate import')
      return { command, imported }
    }, { target, origin, provision })
    await expect(application.evaluate(async (_electron, identity) => {
      let runtime = (globalThis as any).remoteLayoutRuntime, lease = runtime.remote.acquire(identity.sessionId, 'fixture', false)
      try { await runtime.remote.command('fixture', lease.generation, { method: 'navigate', args: { pane: identity.paneId, url: 'about:blank' } }) } finally { runtime.remote.release(identity.sessionId, 'fixture') }
    }, provision.identity as any)).rejects.toThrow('ACCOUNT_HOST_INACTIVE')
    expect((move.imported as any).identity.settingsHash).toBe((provision.identity as any).settingsHash)
    expect((move.imported as any).seal).toEqual(provision.seal)
    await application.evaluate(async (_electron, command) => (globalThis as any).mobilityTarget.accounts.mobility.apply({ ...command, phase: 'activate' }, () => true), move.command)
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    page = application.context().pages().find(page => page.url() === url)!
    expect(await page.evaluate(async () => ({ cookies: document.cookie, local: localStorage.getItem('login'), dimensions: [innerWidth, innerHeight], record: await new Promise<unknown>((resolve, reject) => { let open = indexedDB.open('login'); open.onerror = () => reject(open.error); open.onsuccess = () => { let db = open.result, request = db.transaction('tokens').objectStore('tokens').get('login'); request.onsuccess = () => { let value = request.result; db.close(); resolve({ token: value.token, at: value.at.getTime(), bytes: Array.from(value.bytes) }) } } }) }))).toEqual({ cookies: 'login=fixture', local: 'fixture', dimensions: [1200,800], record: { token: 'fixture', at: 123, bytes: [1,2,3] } })
    await closeTestApplication(application)
    let before = requests
    application = await launch()
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    await application.evaluate(async (_electron, command) => {
      let runtime = (globalThis as any).remoteLayoutRuntime
      await runtime.accounts.mobility.apply({ ...command, expires: Date.now() + 30000 }, () => true)
      if (!Object.values(runtime.model.accountRetired).includes(command.id)) throw new Error('Missing retirement')
    }, move.command)
    expect(requests).toBe(before)
    expect(application.context().pages().some(page => page.url() === url)).toBe(false)
  } finally {
    await closeTestApplication(application)
    for (let client of ws.clients) client.terminate()
    ws.close(); gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve()))
    for (let socket of sockets) socket.destroy()
    await new Promise<void>(resolve => proxy.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true })
  }
})
