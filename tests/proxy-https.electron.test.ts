import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import tls from 'node:tls'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Server } from 'proxy-chain'

for (let protocol of ['http', 'https'] as const) test(`tests an HTTPS destination through an authenticated ${protocol} proxy`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-proxy-https-'))
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { cwd: directory })
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'proxy-key.pem', '-out', 'proxy-cert.pem', '-days', '1', '-subj', '/CN=proxy', '-addext', 'subjectAltName=IP:127.0.0.1'], { cwd: directory })
  await fs.writeFile(path.join(directory, 'trusted.pem'), Buffer.concat([await fs.readFile(path.join(directory, 'cert.pem')), await fs.readFile(path.join(directory, 'proxy-cert.pem'))]))
  let destination = https.createServer({ key: await fs.readFile(path.join(directory, 'key.pem')), cert: await fs.readFile(path.join(directory, 'cert.pem')) }, (_request, response) => { response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ip: '203.0.113.8' })) })
  await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve))
  let destinationPort = (destination.address() as { port: number }).port
  let proxy = new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => ({ requestAuthentication: request.username !== 'fixture-user' || request.password !== 'fixture-password' }) })
  await proxy.listen()
  let secureProxy = tls.createServer({ key: await fs.readFile(path.join(directory, 'proxy-key.pem')), cert: await fs.readFile(path.join(directory, 'proxy-cert.pem')) }, socket => {
    let upstream = net.connect(proxy.port, '127.0.0.1', () => { socket.pipe(upstream); upstream.pipe(socket) })
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy())
    socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy())
  })
  await new Promise<void>(resolve => secureProxy.listen(0, '127.0.0.1', resolve))
  let proxyPort = protocol === 'https' ? (secureProxy.address() as net.AddressInfo).port : proxy.port
  let proxyHost = '127.0.0.1'
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  let application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', NODE_EXTRA_CA_CERTS: path.join(directory, 'trusted.pem'), BMUX_PROXY_TEST_URL: `https://localhost:${destinationPort}/ip` } })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let profile = (await chrome.evaluate(() => (window as any).bmux.state())).model.profiles[0]
    let command = (method: string, args: Record<string, unknown>) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    await command('profile.proxy.set', { profile: profile.id, protocol, host: proxyHost, port: proxyPort, authenticated: true, username: 'fixture-user', password: 'fixture-password' })
    expect(await command('profile.proxy.test', { profile: profile.id })).toMatchObject({ ip: '203.0.113.8' })
    await expect(command('profile.proxy.test', { profile: profile.id, protocol, host: proxyHost, port: proxyPort, authenticated: true, username: 'fixture-user', password: 'wrong-password' })).rejects.toThrow('Proxy authentication failed')
    expect(await command('profile.proxy.test', { profile: profile.id })).toMatchObject({ ip: '203.0.113.8' })
    expect((await chrome.evaluate(() => (window as any).bmux.state())).model.profiles[0].proxy.port).toBe(proxyPort)
    if (protocol === 'https') await expect(command('profile.proxy.test', { profile: profile.id, protocol, host: 'localhost', port: proxyPort, authenticated: true })).rejects.toThrow('599')
  } finally {
    await application.close()
    await proxy.close(true)
    await new Promise<void>(resolve => secureProxy.close(() => resolve()))
    await new Promise<void>(resolve => destination.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
