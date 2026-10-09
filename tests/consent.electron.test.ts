import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { closeTestApplication } from './electron-fixture'

let directory: string, application: ElectronApplication, chrome: Page, server: http.Server, url: string
let nonceRequests = 0
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let client = async () => { let current = await state(); return current.model.clients.find((client: any) => client.id === current.clientId) }
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let open = async (target: string) => {
  await activate()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  let button = chrome.getByRole('button', { name: 'Address', exact: true })
  await expect(address.or(button)).toBeVisible()
  if (!await address.isVisible()) await button.click()
  await address.fill(target); await address.press('Enter')
}
let website = async (target: string) => {
  await expect.poll(() => application.context().pages().some(page => page.url() === target)).toBe(true)
  return application.context().pages().find(page => page.url() === target)!
}
let expectAttached = async (target: string) => {
  await expect.poll(() => application.evaluate(({ BaseWindow }, target) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.some(view => 'webContents' in view && (view as any).webContents.getURL() === target && view.getBounds().height > 200)), target)).toBe(true)
}

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-consent-'))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n  rules: ["/fixture-ad.js$script"]\n')
  server = http.createServer((request, response) => {
    let pathname = new URL(request.url!, 'http://fixture').pathname
    if (pathname === '/nonce') { nonceRequests++; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"entries":[{"nonce":"fixture-nonce"}]}'); return }
    if (pathname === '/fixture-ad.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('window.adLoaded = true'); return }
    if (pathname === '/home') { response.writeHead(302, { Location: request.headers.cookie?.includes('site_choice=') ? '/register' : '/consent' }); response.end(); return }
    // Model Instagram's observed storage gate after a successful save-info nonce request.
    let content = pathname === '/register' ? `<h1>Save your login info</h1><button id="save">Save info</button><p id="status" role="status"></p><script src="/fixture-ad.js"></script><script>
      window.siteStorage = () => document.cookie.includes('site_choice=') ? localStorage : null;
      document.querySelector('#save').onclick = async () => {
        document.querySelector('#save').disabled = true; document.querySelector('#status').textContent = 'Saving login info…';
        let result = await (await fetch('/nonce')).json(); let storage = window.siteStorage();
        if (!storage) return;
        storage.setItem('login_nonce', result.entries[0].nonce); document.querySelector('#status').textContent = 'Login info saved';
      };
    </script>` : pathname === '/consent' ? `<section role="dialog" aria-label="Cookie choice"><h1>Choose your cookies</h1><button>Allow all cookies</button><button>Decline optional cookies</button></section><script>
      for (let button of document.querySelectorAll('button')) button.onclick = () => { document.cookie = 'site_choice=' + (button.textContent.startsWith('Allow') ? 'all' : 'essential') + '; Path=/; SameSite=Lax'; location.href = '/register'; };
    </script>` : '<h1>Permission fixture</h1><label>Keep browsing<input id="text"></label>'
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><head><title>Consent fixture</title><style>body{background:white;color:black;font:20px sans-serif;padding:24px}button{font:inherit;padding:12px;margin:8px}input{display:block;margin:8px}</style></head><body>${content}</body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
})

test.afterAll(async () => {
  await closeTestApplication(application)
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('permission notice and Activity visit the requesting pane across sessions without answering', async () => {
  await open(`${url}/observer`)
  let observer = await client()
  let profile = await rpc('profile.create', { name: 'consent-requester', background: true }) as any
  let session = await rpc('new-session', { name: 'requests', profile: profile.id }) as any
  let window = await rpc('new-window', { session: session.id }) as any
  let pane = await rpc('split-window', { pane: window.panes[0].id, axis: 'horizontal', url: `${url}/requester` }) as any
  let source = await website(`${url}/requester`)
  await expect(source.locator('#text')).toBeVisible()
  await source.evaluate(() => { Notification.requestPermission().then(result => { (window as any).permissionResult = result }) })
  await expect.poll(async () => (await rpc('permission.list') as any[]).length).toBe(1)
  expect(await client()).toEqual(observer)
  let popup = chrome.getByLabel('Notifications').getByRole('status').filter({ hasText: 'requests notifications' })
  await expect(popup).toBeVisible()
  await expect(popup).toContainText(`requests:2 · ${pane.id}`)
  let visit = popup.getByRole('button', { name: 'Go to pane', exact: true })
  await expect(visit).toHaveAttribute('title', `requests:2 · ${pane.id}`)
  await chrome.screenshot({ path: path.resolve('artifacts/consent-go-to-pane.png') })
  await visit.click()
  let expectSource = async () => {
    await expect.poll(async () => { let current = await client(); return { id: current.id, sessionId: current.sessionId, windowId: current.windowId, paneId: current.paneId, zoomedPaneId: current.zoomedPaneId } }).toEqual({ id: observer.id, sessionId: session.id, windowId: window.id, paneId: pane.id, zoomedPaneId: null })
    await expectAttached(`${url}/requester`)
    await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/requester`)
    expect((await rpc('permission.list') as any[])[0].paneId).toBe(pane.id)
    expect(await source.evaluate(() => (window as any).permissionResult)).toBeUndefined()
  }
  await expectSource()
  await expect(popup).toBeVisible()
  await expect(visit).toHaveCount(0)
  await expect(popup).not.toContainText(pane.id)
  await source.locator('#text').fill('Request is still pending')
  await rpc('switch-client', { client: observer.id, session: observer.sessionId })
  await expectAttached(`${url}/observer`)
  await popup.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
  await chrome.getByRole('button', { name: 'Activity', exact: true }).click()
  let activity = chrome.getByRole('dialog', { name: 'Activity', exact: true })
  await activity.getByRole('button', { name: 'Go to pane', exact: true }).click()
  await expect(activity).toBeHidden()
  await expectSource()
  await expect(source.locator('#text')).toHaveValue('Request is still pending')
  await chrome.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(activity.getByRole('button', { name: 'Go to pane', exact: true })).toHaveCount(0)
  await activity.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect.poll(() => source.evaluate(() => (window as any).permissionResult)).toBe('denied')
  await activity.getByRole('button', { name: 'Close', exact: true }).click()
})

for (let adblock of [true, false]) test(`site cookie choice resolves the registration spinner with adblock ${adblock ? 'on' : 'off'}`, async () => {
  let profile = await rpc('profile.create', { name: `cookie-choice-${adblock}`, background: true }) as any
  let current = await client()
  let session = await rpc('new-session', { name: `cookie-choice-${adblock}`, profile: profile.id, client: current.id }) as any
  let pane = session.windows[0].panes[0]
  await rpc('browser.set', { tab: pane.id, setting: 'adblock', value: adblock, scope: 'pane' })
  let registerUrl = `${url}/register?adblock=${adblock}`
  await open(registerUrl)
  let page = await website(registerUrl)
  await expectAttached(registerUrl)
  await expect.poll(() => page.evaluate(() => Boolean((window as any).adLoaded))).toBe(!adblock)
  let before = nonceRequests
  await page.getByRole('button', { name: 'Save info', exact: true }).click()
  await expect.poll(() => nonceRequests).toBe(before + 1)
  await expect(page.getByRole('status')).toHaveText('Saving login info…')
  await expect(page.getByRole('button', { name: 'Save info', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => { localStorage.setItem('probe', 'ok'); return { storageAvailable: localStorage.getItem('probe') === 'ok', siteStorageAvailable: (window as any).siteStorage() !== null } })).toEqual({ storageAvailable: true, siteStorageAvailable: false })
  await open(`${url}/home`)
  await expect(page).toHaveURL(`${url}/consent`)
  await expectAttached(`${url}/consent`)
  let choice = page.getByRole('dialog', { name: 'Cookie choice', exact: true })
  await expect(choice).toBeVisible()
  expect(await rpc('permission.list')).toEqual([])
  expect((await client()).paneId).toBe(pane.id)
  await page.screenshot({ path: path.resolve(`artifacts/site-cookie-choice-adblock-${adblock}.png`) })
  await choice.getByRole('button', { name: adblock ? 'Decline optional cookies' : 'Allow all cookies', exact: true }).click()
  await expect(page).toHaveURL(`${url}/register`)
  await page.getByRole('button', { name: 'Save info', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Login info saved')
  expect(await page.evaluate(() => localStorage.getItem('login_nonce'))).toBe('fixture-nonce')
})
