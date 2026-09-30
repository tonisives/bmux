import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import { X509Certificate } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { initialModel } from '../src/main/model'

let application: ElectronApplication, chrome: Page, directory: string, rootFingerprint: string
let servers: (http.Server | https.Server)[] = [], urls: Record<string, string> = {}
let execute = promisify(execFile)
let model = initialModel(), pane = model.sessions[0].windows[0].panes[0], tab = pane
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let security = async (id = tab.id) => (await state()).security[id]
let open = async (url: string, paneId = pane.id) => {
  await chrome.locator(`[data-pane-id="${paneId}"]`).getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(url); await address.press('Enter')
}
let listen = async (server: http.Server | https.Server, secure = false) => {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `${secure ? 'https' : 'http'}://localhost:${(server.address() as any).port}`
}

test.beforeAll(async () => {
  test.setTimeout(120000)
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-security-'))
  let openssl = async (...args: string[]) => { await execute('openssl', args, { cwd: directory }) }
  await openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '2', '-subj', `/CN=bmux fixture ${path.basename(directory)}`)
  let root = await fs.readFile(path.join(directory, 'root.pem'))
  rootFingerprint = new X509Certificate(root).fingerprint.replaceAll(':', '')
  // This suite runs only on the disposable Tart/CI desktop. Trust its short-lived
  // fixture CA so the valid case exercises Chromium's real certificate verifier.
  await execute('sudo', ['-n', 'security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', path.join(directory, 'root.pem')])
  let respond: http.RequestListener = (request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: urls.http }); response.end(); return }
    if (request.url === '/slow') { setTimeout(() => { response.end('<h1>Slow fixture</h1>') }, 1200); return }
    response.setHeader('Content-Type', 'text/html')
    if (request.url === '/nested') { response.end(`<h1>Nested fixture</h1><iframe src="${urls.valid.replace('localhost', 'frame.bmux.test')}/mixed"></iframe>`); return }
    if (request.url === '/mixed') { response.end(`<h1>Mixed fixture</h1><script src="http://mixed.bmux.test:${new URL(urls.http).port}/mixed.js"></script>`); return }
    response.end('<!doctype html><title>Connection fixture</title><h1>Connection fixture</h1>')
  }
  urls.http = await listen(http.createServer(respond))
  for (let kind of ['valid', 'expired', 'mismatch', 'self-signed']) {
    await openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${kind}.key`, '-out', `${kind}.csr`, '-subj', `/CN=${kind === 'mismatch' ? 'wrong.test' : 'localhost'}`)
    await fs.writeFile(path.join(directory, `${kind}.ext`), `subjectAltName=DNS:${kind === 'mismatch' ? 'wrong.test' : 'localhost,DNS:frame.bmux.test'}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`)
    if (kind === 'expired') {
      await fs.writeFile(path.join(directory, 'index.txt'), '')
      await fs.writeFile(path.join(directory, 'serial'), '1000\n')
      await fs.writeFile(path.join(directory, 'ca.cnf'), '[ca]\ndefault_ca=fixture\n[fixture]\ndatabase=index.txt\nserial=serial\nnew_certs_dir=.\ncertificate=root.pem\nprivate_key=root.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n')
      await openssl('ca', '-batch', '-config', 'ca.cnf', '-in', 'expired.csr', '-out', 'expired.pem', '-startdate', '20200101000000Z', '-enddate', '20200102000000Z', '-extfile', 'expired.ext')
    } else await openssl('x509', '-req', '-in', `${kind}.csr`, ...(kind === 'self-signed' ? ['-signkey', `${kind}.key`] : ['-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial']), '-out', `${kind}.pem`, '-days', kind === 'expired' ? '-1' : '1', '-extfile', `${kind}.ext`)
    urls[kind] = await listen(https.createServer({ key: await fs.readFile(path.join(directory, `${kind}.key`)), cert: await fs.readFile(path.join(directory, `${kind}.pem`)) }, respond), true)
  }
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
  application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.bmux.test 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
})
test.afterAll(async () => {
  await closeTestApplication(application)
  for (let server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  // GitHub Actions discards its desktop after this job; local Tart keeps its keychain.
  if (rootFingerprint && !process.env.CI) await execute('sudo', ['-n', 'security', 'delete-certificate', '-t', '-Z', rootFingerprint, '/Library/Keychains/System.keychain'], { timeout: 10000 })
  if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('clears cookies and site storage from the lock panel without affecting other sites or profiles', async () => {
  await open(urls.http)
  await expect.poll(async () => (await security())?.status).toBe('http')
  let page = application.context().pages().find(page => page.url() === `${urls.http}/`)!
  await expect(page.locator('h1')).toHaveText('Connection fixture')
  let otherUrl = urls.http.replace('localhost', '127.0.0.1')
  await application.evaluate(async ({ session }, { url, otherUrl }) => {
    let browser = session.fromPartition('persist:profile_default')
    await browser.cookies.set({ url: `${url}/account`, name: 'fixture', value: 'clear', path: '/account', httpOnly: true })
    await browser.cookies.set({ url: otherUrl, name: 'fixture', value: 'keep' })
    await session.fromPartition('site-data-other-profile').cookies.set({ url, name: 'fixture', value: 'keep' })
  }, { url: urls.http, otherUrl })
  await page.evaluate(async () => {
    localStorage.setItem('fixture', 'clear')
    await new Promise<void>((resolve, reject) => {
      let request = indexedDB.open('fixture')
      request.onupgradeneeded = () => request.result.createObjectStore('fixture')
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })
    await (await caches.open('fixture')).put('/fixture', new Response('clear'))
  })
  let other = await rpc('split-window', { pane: pane.id, axis: 'horizontal', url: otherUrl }) as any
  await expect.poll(() => application.context().pages().some(candidate => candidate.url() === `${otherUrl}/`)).toBe(true)
  let otherPage = application.context().pages().find(candidate => candidate.url() === `${otherUrl}/`)!
  await expect(otherPage.locator('h1')).toHaveText('Connection fixture')
  await otherPage.evaluate(() => localStorage.setItem('fixture', 'keep'))
  await chrome.locator(`[data-pane-id="${pane.id}"]`).getByRole('button', { name: 'Site information: Connection is not encrypted' }).click()
  let panel = chrome.getByRole('dialog', { name: 'Site information', exact: true })
  await panel.getByRole('button', { name: 'Clear cookies and site data', exact: true }).click()
  await expect(panel).toContainText('Cookies and site data cleared.')
  await expect.poll(async () => (await state()).loading[tab.id] ?? false).toBe(false)
  await expect(page.locator('h1')).toHaveText('Connection fixture')
  expect(await page.evaluate(async () => ({ local: localStorage.getItem('fixture'), databases: await indexedDB.databases(), caches: await caches.keys() }))).toEqual({ local: null, databases: [], caches: [] })
  let cookies = await application.evaluate(async ({ session }, { url, otherUrl }) => ({
    cleared: await session.fromPartition('persist:profile_default').cookies.get({ url: `${url}/account` }),
    other: await session.fromPartition('persist:profile_default').cookies.get({ url: otherUrl }),
    profile: await session.fromPartition('site-data-other-profile').cookies.get({ url }),
  }), { url: urls.http, otherUrl })
  expect(cookies.cleared).toHaveLength(0)
  expect(cookies.other).toHaveLength(1)
  expect(cookies.profile).toHaveLength(1)
  expect(await otherPage.evaluate(() => localStorage.getItem('fixture'))).toBe('keep')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await rpc('kill-pane', { pane: other.id })
  await open('about:blank')
  await chrome.locator(`[data-pane-id="${pane.id}"]`).getByRole('button', { name: 'Site information: Local or internal page' }).click()
  await expect(panel.getByRole('button', { name: 'Clear cookies and site data', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
})

test('shows verified TLS details, rejects invalid certificates, and follows redirects and panes', async () => {
  test.setTimeout(120000)
  await open(urls.valid)
  await expect.poll(async () => (await security())?.status).toBe('secure')
  let page = application.context().pages().find(page => page.url() === `${urls.valid}/`)!
  await expect(page.locator('h1')).toHaveText('Connection fixture')
  await chrome.getByRole('button', { name: 'Site information: Connection is secure', exact: true }).click()
  let panel = chrome.getByRole('dialog', { name: 'Site information', exact: true })
  await expect(panel).toContainText('localhost')
  await expect(panel).toContainText('Valid until')
  await expect(panel).toContainText('It does not establish that a website is trustworthy.')
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
  await chrome.screenshot({ path: path.resolve('artifacts/site-information.png') })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await open(`${urls.valid}/mixed`)
  await expect.poll(async () => (await security())?.status).toBe('mixed')
  await open(`${urls.valid}/nested`)
  await expect.poll(async () => (await security())?.status, { timeout: 10000 }).toBe('mixed')
  await open(`${urls.valid}/slow`)
  await expect.poll(async () => (await security())?.status).toBe('loading')
  expect((await security()).certificate).toBeUndefined()
  for (let kind of ['expired', 'mismatch', 'self-signed']) {
    await open(urls[kind])
    await expect.poll(async () => (await security())?.status).toBe('certificate-error')
    expect((await security()).url).toBe(`${urls[kind]}/`)
    await chrome.getByRole('button', { name: 'Site information: Certificate error', exact: true }).click()
    await expect(panel).toContainText('This connection was blocked')
    await expect(panel).not.toContainText('Connection is secure')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    expect(application.context().pages().some(candidate => candidate.url() === `${urls[kind]}/`)).toBe(false)
  }
  await open(`${urls.valid}/redirect`)
  await expect.poll(async () => (await security())?.status).toBe('http')
  expect((await security()).certificate).toBeUndefined()
  await rpc('split-window', { pane: pane.id, axis: 'horizontal', url: urls.valid })
  let second = (await state()).model.sessions[0].windows[0].panes.find((item: any) => item.id !== pane.id)
  await expect.poll(async () => (await security(second.id))?.status).toBe('secure')
  await chrome.locator(`[data-pane-id="${pane.id}"]`).getByRole('button', { name: 'Site information: Connection is not encrypted' }).click()
  await expect(panel).toContainText(urls.http)
  await expect(panel).not.toContainText('Valid until')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await chrome.locator(`[data-pane-id="${second.id}"]`).getByRole('button', { name: 'Site information: Connection is secure' }).click()
  await expect(panel).toContainText(urls.valid)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await open('about:blank', second.id)
  await expect.poll(async () => (await security(second.id))?.status).toBe('local')
  expect((await security(second.id)).certificate).toBeUndefined()
  await open(urls.valid, second.id)
  await expect.poll(async () => (await security(second.id))?.status).toBe('secure')
  await rpc('break-pane', { pane: second.id, floating: true })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith(`#float=${second.id}`))).toBe(true)
  let floating = application.context().pages().find(page => page.url().endsWith(`#float=${second.id}`))!
  await floating.getByRole('button', { name: 'Site information: Connection is secure' }).click()
  await expect(panel).toContainText(urls.valid)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true })
  await command.fill('site-info'); await command.press('Enter')
  await expect(panel).toContainText(urls.valid)
})
