import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { observeNativeFocus, recordNativeFocus, sendNativeKeys } from './native-focus'

let exec = promisify(execFile)
let root = process.cwd()
let application: ElectronApplication
let directory: string
let url: string
let server: http.Server
let heldResponses = new Set<http.ServerResponse>()
let heldRequests = 0
let pendingPages = new Set<http.ServerResponse>()
let cli = async (method: string, args: Record<string, unknown> = {}) => {
  console.log(`CLI ${method} ${args.tab ?? args.client ?? ''}`)
  let result = await exec(process.execPath, [path.join(root, 'bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 90000, maxBuffer: 16 * 1024 * 1024 }).catch(error => { throw new Error(`${method}: ${error.stdout || error.stderr || error.message}`) })
  let response = JSON.parse(result.stdout)
  if (!response.ok) throw new Error(response.error)
  return response.result
}
let launch = async () => {
  application = await electron.launch({ args: [root, '--background'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '1' } })
  application.process().stderr?.on('data', chunk => console.log('ELECTRON', String(chunk).slice(0, 1500)))
  await application.evaluate(async ({ app }) => { await app.whenReady() })
  await observeNativeFocus(application)
  // The public CLI auto-starts a server. During a slow restore that can launch the
  // installed build against this same fixture before the test app starts listening.
  let socket = path.join('/tmp', `bmux-${process.getuid?.() ?? 'user'}`, `${createHash('sha256').update(directory).digest('hex').slice(0, 16)}.sock`)
  let serverPid = () => new Promise<number>((resolve, reject) => {
    let connection = net.createConnection(socket), response = ''
    connection.setEncoding('utf8'); connection.setTimeout(1000)
    connection.on('connect', () => connection.write(JSON.stringify({ method: 'diagnostics' }) + '\n'))
    connection.on('data', chunk => { response += chunk })
    connection.on('timeout', () => connection.destroy(new Error('Test server did not respond')))
    connection.on('error', reject)
    connection.on('end', () => { try { resolve(JSON.parse(response).result.pid) } catch (error) { reject(error) } })
  })
  await expect.poll(() => serverPid().catch(() => null), { timeout: 20000 }).toBe(application.process().pid)
}
let frontmost = async () => (await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to get unix id of first application process whose frontmost is true'])).stdout.trim()
let fixture = `<!doctype html><html><head><title>bmux fixture</title><style>body{margin:0;font:20px sans-serif;background:#e8eef8}header{padding:30px;background:#173353;color:white}section{height:2500px;padding:30px}footer{height:200px;background:#bd4135;color:white;padding:30px}</style></head><body><header>Fixture top</header><section><input id="text" placeholder="Type here"><button id="inc" onclick="window.count++;document.querySelector('#count').textContent=window.count">Increment</button><span id="count">0</span><a id="popup" href="/popup" target="_blank" rel="noopener">Popup</a><a href="/download">Download</a></section><footer id="bottom">BOTTOM OF FULL PAGE</footer><script>window.count=0;window.identity=Math.random();window.ticks=0;setInterval(()=>window.ticks++,100);</script></body></html>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-electron-'))
  server = http.createServer((request, response) => {
    if (request.url === '/pending-tab') { pendingPages.add(response); response.on('close', () => pendingPages.delete(response)); return }
    if (request.url === '/tab-icon.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#588e73"/></svg>'); return }
    if (request.url?.startsWith('/slow')) { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Slow fixture</title><h1>Loading fixture</h1><script src="/held.js"></script>'); return }
    if (request.url === '/held.js') { heldRequests++; heldResponses.add(response); response.on('close', () => heldResponses.delete(response)); return }
    if (request.url === '/download') { response.writeHead(200, { 'Content-Disposition': 'attachment; filename="fixture.txt"', 'Content-Type': 'text/plain' }); response.end('download fixture'); return }
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(fixture)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await launch()
})
test.afterEach(async ({}, info) => {
  await recordNativeFocus(application, info)
  if (info.status !== info.expectedStatus) console.log('FOCUS_DIAGNOSTICS', { frontmostPid: await frontmost(), expectedPid: application.process().pid })
})
test.afterAll(async () => {
  for (let response of heldResponses) response.end()
  for (let response of pendingPages) response.end()
  await application?.close().catch(() => undefined)
  await new Promise<void>(resolve => server?.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
})

test('profiles, clients, handoff, hidden automation, and restart', async () => {
  expect(await application.evaluate(({ app }) => app.commandLine.getSwitchValue('force-webrtc-ip-handling-policy'))).toBe('disable_non_proxied_udp')
  let initial = await cli('state')
  expect(initial.model.clients).toHaveLength(0)
  let session = initial.model.sessions[0]
  let mainWindow = session.windows[0]
  let mainPane = mainWindow.panes[0]
  let mainTab = mainPane.tabs[0]
  await cli('navigate', { tab: mainTab.id, url })
  await cli('eval', { tab: mainTab.id, expression: 'localStorage.setItem("profile", "personal"); document.cookie="profile=personal;path=/"' })
  let botPane = await cli('split-window', { pane: mainPane.id, profile: 'bot', url })
  let botTab = botPane.tabs[0]
  await cli('wait', { tab: botTab.id, selector: '#text' })
  expect(await cli('eval', { tab: botTab.id, expression: '({storage:localStorage.getItem("profile"),cookie:document.cookie})' })).toEqual({ storage: null, cookie: '' })
  await cli('eval', { tab: botTab.id, expression: 'localStorage.setItem("profile", "bot"); document.cookie="profile=bot;path=/"' })
  let another = await cli('split-window', { pane: botPane.id, profile: 'default', url })
  await cli('wait', { tab: another.tabs[0].id, selector: '#text' })
  expect(await cli('eval', { tab: another.tabs[0].id, expression: 'localStorage.getItem("profile")' })).toBe('personal')

  let clientA = await cli('attach-session', { session: session.id })
  let clientB = await cli('attach-session', { session: session.id })
  let secondWindow = await cli('new-window', { session: session.id, name: 'other' })
  await cli('select-window', { client: clientB.id, window: secondWindow.id })
  let state = await cli('state')
  expect(state.model.clients.find((client: { id: string }) => client.id === clientA.id).windowId).toBe(mainWindow.id)
  expect(state.model.clients.find((client: { id: string }) => client.id === clientB.id).windowId).toBe(secondWindow.id)

  let secondTab = secondWindow.panes[0].activeTabId
  await cli('navigate', { tab: secondTab, url: `${url}/other-visible` })
  let visibleOwners = () => application.evaluate(({ BaseWindow }, urls) => urls.map(url => BaseWindow.getAllWindows().find(window => window.isVisible() && window.contentView.children.some((view: any) => view.webContents?.getURL() === url))?.id), [`${url}/`, `${url}/other-visible`])
  await expect.poll(async () => (await visibleOwners()).every(Boolean)).toBe(true)
  let owners = await visibleOwners()
  expect(owners[0]).not.toBe(owners[1])
  await application.evaluate(({ BrowserWindow }) => {
    let runtime = globalThis as any
    runtime.fixtureFocusWindow = new BrowserWindow({ width: 300, height: 200 })
    runtime.fixtureFocusWindow.focus()
  })
  try {
    await expect.poll(async () => (await cli('state')).focusedClientId).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 700))
    expect(await visibleOwners()).toEqual(owners)
  } finally {
    await application.evaluate(() => { let runtime = globalThis as any; runtime.fixtureFocusWindow.destroy(); delete runtime.fixtureFocusWindow })
  }

  await cli('select-window', { client: clientB.id, window: mainWindow.id })
  await cli('activate-client', { client: clientA.id })
  await cli('type', { tab: mainTab.id, selector: '#text', text: 'Retain this form' })
  await cli('click', { tab: mainTab.id, selector: '#inc' })
  let identity = await cli('eval', { tab: mainTab.id, expression: 'window.identity' })
  let targetBefore = await cli('cdp', { tab: mainTab.id, method: 'Target.getTargetInfo' })
  for (let client of [clientB, clientA, clientB]) {
    await cli('activate-client', { client: client.id })
    await expect.poll(async () => { await cli('activate-client', { client: client.id }); return (await cli('state')).focusedClientId }).toBe(client.id).catch(async error => { console.log(JSON.stringify(await cli('diagnostics'))); console.log('FRONTMOST', await frontmost()); throw error })
  }
  expect(await cli('eval', { tab: mainTab.id, expression: '({text:document.querySelector("#text").value,count:window.count,identity:window.identity})' })).toEqual({ text: 'Retain this form', count: 1, identity })
  expect((await cli('cdp', { tab: mainTab.id, method: 'Target.getTargetInfo' })).targetInfo.targetId).toBe(targetBefore.targetInfo.targetId)
  await expect.poll(async () => Boolean((await cli('state')).snapshots[mainTab.id]?.image)).toBe(true)

  let chromePages = application.context().pages().filter(page => page.url().endsWith('index.html'))
  expect(chromePages.length).toBe(2)
  let chrome = chromePages[1]
  await application.evaluate(({ BaseWindow }) => { for (let window of BaseWindow.getAllWindows()) if (window.isVisible()) window.setBounds({ x: 90, y: 90, width: 1280, height: 850 }) })
  let statusBar = chrome.getByRole('contentinfo', { name: 'Browser status' })
  await expect(statusBar).toBeVisible()
  await expect.poll(async () => (await statusBar.boundingBox())!.y - (await chrome.locator('main').boundingBox())!.y).toBeLessThan(0)
  await chrome.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(chrome.getByRole('dialog', { name: 'Help' })).toBeVisible()
  await chrome.getByRole('button', { name: 'Close', exact: true }).last().click()
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true })
  await cli('client.overlay', { client: clientB.id, visible: true })
  await chrome.waitForTimeout(200)
  await chrome.screenshot({ path: path.join(root, 'artifacts/client.png') })
  await cli('client.overlay', { client: clientB.id, visible: false })

  // Hide the app and ensure the next automation operations leave the OS focus unchanged.
  await application.evaluate(({ app }) => app.hide())
  await new Promise(resolve => setTimeout(resolve, 350))
  let before = await frontmost()
  await cli('navigate', { tab: botTab.id, url: `${url}/background` })
  await cli('type', { tab: botTab.id, selector: '#text', text: 'Background input' })
  expect((await cli('dom', { tab: botTab.id })).content).toContain('BOTTOM OF FULL PAGE')
  let screenshot = path.join(directory, 'full.png')
  await cli('screenshot', { tab: botTab.id, output: screenshot })
  let png = await fs.readFile(screenshot)
  expect(png.readUInt32BE(20)).toBeGreaterThan(2700)
  expect(await frontmost()).toBe(before)
  expect(await cli('eval', { tab: botTab.id, expression: 'document.querySelector("#text").value' })).toBe('Background input')

  let windowsBeforePopup = await cli('list-windows', { session: session.id })
  await cli('eval', { tab: botTab.id, expression: `window.open(${JSON.stringify(`${url}/popup`)}, '_blank'); true` })
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(windowsBeforePopup.length + 1)
  let popupWindow = (await cli('list-windows', { session: session.id })).find((window: { id: string }) => !windowsBeforePopup.some((existing: { id: string }) => existing.id === window.id))
  let popup = popupWindow.panes[0].tabs[0]
  await cli('wait', { tab: popup.id, selector: '#text' })
  expect(await cli('eval', { tab: popup.id, expression: '({profile:localStorage.getItem("profile"),opener:!!window.opener})' })).toEqual({ profile: 'bot', opener: true })
  expect(await cli('tab.list', { pane: botPane.id })).toHaveLength(1)
  expect(await frontmost()).toBe(before)

  await cli('save-layout', { window: mainWindow.id, name: 'development' })
  await cli('restore-layout', { window: secondWindow.id, name: 'development', confirm: true })
  let restored = await cli('list-panes', { window: secondWindow.id })
  expect(restored.map((pane: { profileId: string }) => pane.profileId)).toEqual(['profile_default', 'profile_bot', 'profile_default'])
  await cli('detach-client', { client: clientA.id })
  await cli('detach-client', { client: clientB.id })
  expect(await cli('list-clients')).toHaveLength(0)
  expect(await cli('eval', { tab: botTab.id, expression: 'localStorage.getItem("profile")' })).toBe('bot')

  await application.close()
  await launch()
  expect((await cli('list-sessions'))[0].windows).toHaveLength(3)
  await cli('wait', { tab: mainTab.id, selector: '#text' })
  await cli('wait', { tab: botTab.id, selector: '#text' })
  expect(await cli('eval', { tab: mainTab.id, expression: 'localStorage.getItem("profile")' })).toBe('personal')
  expect(await cli('eval', { tab: botTab.id, expression: 'localStorage.getItem("profile")' })).toBe('bot')
})

test('a renderer-closed popup does not crash background page polling', async () => {
  let reportedErrors: string[] = []
  let stderr = application.process().stderr
  let report = (chunk: Buffer) => reportedErrors.push(String(chunk))
  stderr?.on('data', report)
  await application.evaluate(() => {
    let runtime = globalThis as any
    runtime.fixtureUncaughtErrors = []
    runtime.fixtureUncaughtMonitor = (error: Error) => runtime.fixtureUncaughtErrors.push(error.stack ?? error.message)
    process.on('uncaughtExceptionMonitor', runtime.fixtureUncaughtMonitor)
  })
  try {
    let session = await cli('new-session', { name: 'renderer-close' })
    let opener = session.windows[0].panes[0].tabs[0]
    await cli('navigate', { tab: opener.id, url })
    let before = await cli('list-windows', { session: session.id })
    await cli('eval', { tab: opener.id, expression: `window.open(${JSON.stringify(`${url}/popup`)}, '_blank'); true` })
    await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(before.length + 1)
    let popupWindow = (await cli('list-windows', { session: session.id })).find((window: { id: string }) => !before.some((existing: { id: string }) => existing.id === window.id))
    let popup = popupWindow.panes[0].tabs[0]
    await cli('wait', { tab: popup.id, selector: '#text' })
    await cli('eval', { tab: popup.id, expression: 'setTimeout(() => window.close(), 0); true' })
    await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(before.length)
    await new Promise(resolve => setTimeout(resolve, 3000))
    expect(await application.evaluate(() => (globalThis as any).fixtureUncaughtErrors)).toEqual([])
    expect(reportedErrors.join('')).not.toContain('bmux:')
  } finally {
    stderr?.off('data', report)
    await application.evaluate(() => {
      let runtime = globalThis as any
      process.off('uncaughtExceptionMonitor', runtime.fixtureUncaughtMonitor)
      delete runtime.fixtureUncaughtMonitor
      delete runtime.fixtureUncaughtErrors
    })
  }
})

test('automatic window names follow the active pane and tab and stop after an explicit rename', async () => {
  let session = await cli('new-session', { name: 'automatic-window-names' })
  let window = session.windows[0], tab = window.panes[0].tabs[0]
  await cli('navigate', { tab: tab.id, url: `${url}/first` })
  await expect.poll(async () => (await cli('list-windows', { session: session.id }))[0].name).toBe('127.0.0.1')
  await cli('navigate', { tab: tab.id, url: `${url.replace('127.0.0.1', 'localhost')}/latest` })
  await expect.poll(async () => (await cli('list-windows', { session: session.id }))[0].name).toBe('localhost')
  let background = await cli('tab.create', { pane: window.panes[0].id, url: `${url}/background-name` })
  await cli('wait', { tab: background.id, selector: '#text' })
  expect((await cli('list-windows', { session: session.id }))[0].name).toBe('localhost')
  await cli('tab.select', { tab: background.id })
  expect((await cli('list-windows', { session: session.id }))[0].name).toBe('127.0.0.1')
  let lower = await cli('split-window', { pane: window.panes[0].id, axis: 'vertical', url: `${url.replace('127.0.0.1', 'localhost')}/lower-name` })
  await cli('wait', { tab: lower.activeTabId, selector: '#text' })
  let client = await cli('attach-session', { session: session.id })
  await cli('select-pane', { client: client.id, pane: lower.id })
  expect((await cli('list-windows', { session: session.id }))[0].name).toBe('localhost')
  await cli('select-pane', { client: client.id, pane: window.panes[0].id })
  expect((await cli('list-windows', { session: session.id }))[0].name).toBe('127.0.0.1')
  await cli('tab.close', { tab: background.id })
  expect((await cli('list-windows', { session: session.id }))[0].name).toBe('localhost')
  let destination = await cli('new-window', { session: session.id })
  await cli('move-pane', { pane: lower.id, window: destination.id })
  await cli('select-window', { client: client.id, window: destination.id })
  await cli('select-pane', { client: client.id, pane: lower.id })
  await cli('navigate', { tab: lower.activeTabId, url: `${url}/moved-name` })
  expect((await cli('list-windows', { session: session.id }))[1].name).toBe('127.0.0.1')
  expect((await cli('list-windows', { session: session.id }))[0].name).toBe('localhost')
  await cli('rename-window', { window: window.id, name: 'research' })
  await cli('navigate', { tab: tab.id, url: `${url}/manual-name` })
  expect((await cli('list-windows', { session: session.id }))[0]).toMatchObject({ name: 'research', automaticName: false })
  await cli('detach-client', { client: client.id })
})

test('Command+W closes an internal window or its session while the command and menu expose native window closing', async () => {
  let session = await cli('new-session', { name: 'window-closing' })
  let client = await cli('attach-session', { session: session.id })
  let clientsBefore = await cli('list-clients')
  try {
    await cli('activate-client', { client: client.id })
    await sendNativeKeys(application, [{ keyCode: 'n', modifiers: ['meta'] }])
    await expect.poll(async () => (await cli('list-clients')).length).toBe(clientsBefore.length + 1)
    let openedClientId = (await cli('list-clients')).find((item: { id: string }) => !clientsBefore.some((prior: { id: string }) => prior.id === item.id)).id
    let secondWindow = await cli('new-window', { session: session.id, client: openedClientId })
    await cli('activate-client', { client: openedClientId })
    await sendNativeKeys(application, [{ keyCode: 'w', modifiers: ['meta'] }])
    await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(1)
    expect((await cli('list-windows', { session: session.id })).some((window: { id: string }) => window.id === secondWindow.id)).toBe(false)
    expect((await cli('list-clients')).some((item: { id: string }) => item.id === openedClientId)).toBe(true)
    await cli('activate-client', { client: openedClientId })
    await sendNativeKeys(application, [{ keyCode: 'w', modifiers: ['meta'] }])
    await expect.poll(async () => (await cli('list-sessions')).some((item: { id: string }) => item.id === session.id)).toBe(false)
    expect((await cli('list-clients')).some((item: { id: string }) => item.id === openedClientId)).toBe(true)
    expect((await cli('list-clients')).some((item: { id: string; sessionId: string }) => item.id === openedClientId && item.sessionId === session.id)).toBe(false)
    await cli('detach-client', { client: openedClientId })
    await cli('activate-client', { client: client.id })
    await sendNativeKeys(application, [{ keyCode: 'n', modifiers: ['meta'] }])
    await expect.poll(async () => (await cli('list-clients')).length).toBe(clientsBefore.length + 1)
    openedClientId = (await cli('list-clients')).find((item: { id: string }) => !clientsBefore.some((prior: { id: string }) => prior.id === item.id)).id
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('close-system-window')?.label)).toBe('Close System Window')
    await cli('command-line', { client: openedClientId, line: 'close-system-window' })
    await expect.poll(async () => (await cli('list-clients')).length).toBe(clientsBefore.length)
    expect((await cli('list-clients')).some((item: { id: string }) => item.id === openedClientId)).toBe(false)
  } finally {
    for (let openClient of await cli('list-clients')) if (!clientsBefore.some((item: { id: string }) => item.id === openClient.id)) await cli('detach-client', { client: openClient.id })
    if ((await cli('list-clients')).some((item: { id: string }) => item.id === client.id)) await cli('detach-client', { client: client.id })
  }
})

test('links show their target, offer browser actions, and open popups in bmux windows', async () => {
  let session = await cli('new-session', { name: 'link-behavior' })
  let sourceWindow = session.windows[0]
  let tab = sourceWindow.panes[0].tabs[0]
  await cli('navigate', { tab: tab.id, url: `${url}/link-behavior` })
  let client = await cli('attach-session', { session: session.id })
  let createdWindow: { id: string } | undefined
  try {
    await cli('activate-client', { client: client.id })
    let website = application.context().pages().find(page => page.url() === `${url}/link-behavior`)!
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let preview = application.context().pages().find(page => page.url().endsWith('#link-preview'))!
    await website.locator('#popup').hover()
    await expect(preview.locator('#root > div')).toHaveText(`${url}/popup`)
    await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().endsWith('#link-preview') && (view as any).getVisible())))).toBe(true)
    let placement = await application.evaluate(({ BaseWindow }, target) => {
      for (let window of BaseWindow.getAllWindows()) {
        if (!window.isVisible()) continue
        let page = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === target)
        let preview = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().endsWith('#link-preview'))
        if (page && preview) return { page: page.getBounds(), preview: preview.getBounds(), visible: (preview as any).getVisible() }
      }
      return null
    }, `${url}/link-behavior`)
    expect(placement?.visible).toBe(true)
    expect(placement?.preview.x).toBe(placement?.page.x)
    expect(placement!.preview.y + placement!.preview.height).toBe(placement!.page.y + placement!.page.height)

    await application.evaluate(({ Menu }) => {
      let runtime = globalThis as any
      runtime.fixtureOriginalMenuPopup = Menu.prototype.popup
      runtime.fixtureMenuLabels = []
      Menu.prototype.popup = function (this: Electron.Menu) { runtime.fixtureMenuLabels = this.items.map((item: Electron.MenuItem) => item.label) } as typeof Menu.prototype.popup
    })
    try {
      await website.locator('#popup').evaluate(element => {
        let selection = globalThis.getSelection()
        let range = document.createRange()
        range.selectNodeContents(element)
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
      await website.locator('#popup').click({ button: 'right' })
      await expect.poll(() => application.evaluate(() => (globalThis as any).fixtureMenuLabels)).toEqual(expect.arrayContaining(['Open Link in New bmux Window', 'Open Link in Background bmux Window', 'Open Link in This Tab', 'Copy Link Address', 'Back', 'Forward', 'Reload']))
      await expect.poll(() => website.evaluate(() => globalThis.getSelection()?.toString())).toBe('')
    } finally {
      await application.evaluate(({ Menu }) => {
        let runtime = globalThis as any
        Menu.prototype.popup = runtime.fixtureOriginalMenuPopup
        delete runtime.fixtureOriginalMenuPopup
        delete runtime.fixtureMenuLabels
      })
    }

    let windowsBeforePopup = await cli('list-windows', { session: session.id })
    await website.locator('#popup').click()
    await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(windowsBeforePopup.length + 1)
    await expect(chrome.getByRole('textbox', { name: 'URL or search', exact: true })).toHaveCount(0)
    createdWindow = (await cli('list-windows', { session: session.id })).find((window: { id: string }) => !windowsBeforePopup.some((existing: { id: string }) => existing.id === window.id))
    let openedTab = (await cli('tab.list')).find((candidate: { windowId: string }) => candidate.windowId === createdWindow!.id)
    await cli('wait', { tab: openedTab.id, selector: '#text' })
    expect(openedTab).toMatchObject({ url: `${url}/popup`, openerTabId: tab.id })
    expect((await cli('list-clients')).find((candidate: { id: string }) => candidate.id === client.id).windowId).toBe(createdWindow!.id)
    expect(await cli('tab.list', { pane: sourceWindow.panes[0].id })).toHaveLength(1)
  } finally {
    if (createdWindow) await cli('kill-window', { window: createdWindow.id, confirm: true })
    await cli('detach-client', { client: client.id })
  }
})

test('address controls navigate, refresh, and open the per-tab history on hold', async () => {
  let session = await cli('new-session', { name: 'address-navigation' })
  let pane = session.windows[0].panes[0]
  let tabId = pane.activeTabId
  await cli('navigate', { tab: tabId, url: `${url}/address-one` })
  await cli('navigate', { tab: tabId, url: `${url}/address-two` })
  await cli('navigate', { tab: tabId, url: `${url}/address-three` })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let address = chrome.locator(`[data-pane-id="${pane.id}"]`).getByRole('group', { name: 'Pane address' })
  let back = address.getByRole('button', { name: 'Back', exact: true })
  let forward = address.getByRole('button', { name: 'Forward', exact: true })
  try {
    await expect(back).toBeEnabled()
    await expect(forward).toBeDisabled()
    await back.click()
    await expect.poll(() => cli('eval', { tab: tabId, expression: 'location.pathname' })).toBe('/address-two')
    await forward.click()
    await expect.poll(() => cli('eval', { tab: tabId, expression: 'location.pathname' })).toBe('/address-three')

    let box = await back.boundingBox()
    expect(box).toBeTruthy()
    await chrome.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await chrome.mouse.down()
    await expect(address.getByRole('menu', { name: 'Back history' })).toBeVisible({ timeout: 3000 })
    await chrome.mouse.up()
    let menu = address.getByRole('menu', { name: 'Back history' })
    await expect(menu.getByRole('menuitem').first()).toContainText('/address-two')
    await menu.getByRole('menuitem').filter({ hasText: '/address-one' }).click()
    await expect.poll(() => cli('eval', { tab: tabId, expression: 'location.pathname' })).toBe('/address-one')
    let stack = (await cli('state')).navigation[tabId]
    expect(stack.entries[stack.activeIndex - 1]?.url).toBe('about:blank')
    await expect(back).toBeDisabled()

    box = await forward.boundingBox()
    expect(box).toBeTruthy()
    await chrome.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await chrome.mouse.down()
    await expect(address.getByRole('menu', { name: 'Forward history' })).toBeVisible({ timeout: 3000 })
    await chrome.mouse.up()
    await address.getByRole('menu', { name: 'Forward history' }).getByRole('menuitem').filter({ hasText: '/address-three' }).click()
    await expect.poll(() => cli('eval', { tab: tabId, expression: 'location.pathname' })).toBe('/address-three')

    let identity = await cli('eval', { tab: tabId, expression: 'window.identity' })
    await address.getByRole('button', { name: 'Refresh' }).click()
    await expect.poll(async () => {
      let next = await cli('eval', { tab: tabId, expression: 'window.identity' }).catch(() => undefined)
      return typeof next === 'number' && next !== identity
    }).toBe(true)
  } finally {
    await cli('detach-client', { client: client.id })
  }
})

test('mouse history buttons target their pane and pane shortcuts keep native keyboard focus', async () => {
  let config = path.join(directory, 'config.yaml')
  let original = await fs.readFile(config, 'utf8')
  await fs.writeFile(config, 'keyboard:\n  shortcuts:\n    Cmd+J: pane-down\n    Cmd+K: pane-up\n')
  await expect.poll(async () => (await cli('state')).keyboard.shortcuts['Cmd+J']).toBe('pane-down')
  let session = await cli('new-session', { name: 'native-navigation' })
  let upper = session.windows[0].panes[0]
  await cli('navigate', { tab: upper.activeTabId, url: `${url}/history-one` })
  await cli('navigate', { tab: upper.activeTabId, url: `${url}/history-two` })
  await cli('navigate', { tab: upper.activeTabId, url: `${url}/history-three` })
  let lower = await cli('split-window', { pane: upper.id, axis: 'vertical', url: `${url}/lower-scroll` })
  await cli('wait', { tab: lower.activeTabId, selector: '#text' })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let otherClient: string | undefined
  try {
    await expect(chrome.locator('[data-browser-content]')).toHaveCount(2)
    await cli('focus-page', { client: client.id })
    let mouse = async (button: 'back' | 'forward', currentPath: string) => application.evaluate(async ({ webContents }, { button, target }) => {
      let contents = webContents.getAllWebContents().find(contents => contents.getURL() === target)!
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
      for (let type of ['mousePressed', 'mouseReleased']) await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: 100, y: 70, button, buttons: type === 'mousePressed' ? button === 'back' ? 8 : 16 : 0, clickCount: 1 })
    }, { button, target: `${url}/${currentPath}` })
    await cli('select-pane', { client: client.id, pane: lower.id })
    await mouse('back', 'history-three')
    await expect.poll(() => cli('eval', { tab: upper.activeTabId, expression: 'location.pathname' })).toBe('/history-two')
    expect(await cli('eval', { tab: lower.activeTabId, expression: 'location.pathname' })).toBe('/lower-scroll')
    await mouse('forward', 'history-two')
    await expect.poll(() => cli('eval', { tab: upper.activeTabId, expression: 'location.pathname' })).toBe('/history-three')
    let windowsBeforePopup = await cli('list-windows', { session: session.id })
    await cli('click', { tab: upper.activeTabId, selector: '#popup' })
    await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(windowsBeforePopup.length + 1)
    let popupWindow = (await cli('list-windows', { session: session.id })).find((window: { id: string }) => !windowsBeforePopup.some((existing: { id: string }) => existing.id === window.id))
    let popup = popupWindow.panes[0].tabs[0]
    expect(popup.url).toBe(`${url}/popup`)
    expect((await cli('list-clients')).find((item: { id: string }) => item.id === client.id).windowId).toBe(popupWindow.id)
    await cli('kill-window', { window: popupWindow.id, confirm: true })
    await cli('select-window', { client: client.id, window: session.windows[0].id })
    expect((await cli('tab.list', { pane: upper.id }))[0]).toMatchObject({ id: upper.activeTabId, active: true })
    await cli('select-pane', { client: client.id, pane: upper.id })
    let focusedUrl = () => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
    let key = async (keyCode: string, modifiers: Electron.KeyboardInputEvent['modifiers'] = []) => {
      await sendNativeKeys(application, [{ keyCode, modifiers }])
    }
    await expect.poll(focusedUrl).toBe(`${url}/history-three`)
    // Repeated activation must preserve the page's first responder and text caret.
    await cli('eval', { tab: upper.activeTabId, expression: 'document.querySelector("#text").focus()' })
    for (let attempt = 0; attempt < 3; attempt++) {
      await cli('activate-client', { client: client.id })
      expect(await focusedUrl()).toBe(`${url}/history-three`)
      expect(await cli('eval', { tab: upper.activeTabId, expression: 'document.hasFocus() && document.activeElement.id === "text"' })).toBe(true)
    }
    // Hand off the views to another native client, then refocus without a page click.
    let nativeId = (await cli('diagnostics')).windows.find((window: { id: string }) => window.id === client.id).nativeId
    otherClient = (await cli('attach-session', { session: session.id })).id
    await expect.poll(() => application.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)?.isFocused(), nativeId)).toBe(false)
    // Wait for attachment to finish before reversing it. Inspector evaluations
    // can otherwise refocus the old window inside the new window's show stack.
    let otherNativeId = (await cli('diagnostics')).windows.find((window: { id: string }) => window.id === otherClient).nativeId
    await expect.poll(() => application.evaluate(({ BaseWindow }, { id, url }) => {
      let window = BaseWindow.fromId(id)
      return window?.isFocused() && window.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url)
    }, { id: otherNativeId, url: `${url}/history-three` })).toBe(true)
    await application.evaluate(({ BaseWindow }, id) => new Promise<void>(resolve => setImmediate(() => { BaseWindow.fromId(id)!.focus(); resolve() })), nativeId)
    await expect.poll(focusedUrl).toBe(`${url}/history-three`)
    // No activate-client or focus-page calls between successive pane shortcuts.
    for (let attempt = 0; attempt < 8; attempt++) {
      await key('j', ['meta'])
      await expect.poll(focusedUrl, { intervals: [10, 20, 50] }).toBe(`${url}/lower-scroll`)
      await key('k', ['meta'])
      await expect.poll(focusedUrl, { intervals: [10, 20, 50] }).toBe(`${url}/history-three`)
    }
    await key('j', ['meta'])
    expect((await cli('list-clients')).find((item: { id: string }) => item.id === client.id).paneId).toBe(lower.id)
    await key('Down')
    await expect.poll(() => cli('eval', { tab: lower.activeTabId, expression: 'scrollY' })).toBeGreaterThan(0)
    expect(await cli('eval', { tab: upper.activeTabId, expression: 'scrollY' })).toBe(0)
  } finally {
    if (otherClient) await cli('detach-client', { client: otherClient })
    await cli('detach-client', { client: client.id })
    await fs.writeFile(config, original)
    await cli('settings.reload')
  }
})

test('permissions, downloads, pane cleanup, crash recovery, and native-client restore', async () => {
  let session = (await cli('list-sessions'))[0]
  let window = session.windows[0]
  let profile = await cli('profile.create', { name: 'recovery', background: true })
  let pane = await cli('split-window', { pane: window.panes[0].id, profile: profile.id, url: `${url}/recovery` })
  let tab = pane.tabs[0]
  await cli('wait', { tab: tab.id, selector: '#text' })
  await cli('eval', { tab: tab.id, expression: 'window.permissionResult="pending"; Notification.requestPermission().then(result=>window.permissionResult=result); true' })
  await expect.poll(async () => (await cli('permission.list')).length).toBe(1)
  let request = (await cli('permission.list'))[0]
  expect(request.profileId).toBe(profile.id)
  await cli('permission.respond', { id: request.id, allow: false })
  expect(await cli('eval', { tab: tab.id, expression: 'window.permissionResult' })).toBe('denied')

  await cli('click', { tab: tab.id, selector: 'a[href="/download"]' })
  await expect.poll(async () => (await cli('downloads')).find((download: { profileId: string }) => download.profileId === profile.id)?.state).toBe('completed')
  let download = (await cli('downloads')).find((download: { profileId: string }) => download.profileId === profile.id)
  expect(await fs.readFile(download.path, 'utf8')).toBe('download fixture')
  await fs.unlink(download.path)

  await application.evaluate(({ webContents }, url) => { let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url); if (!contents) throw new Error('Fixture not found'); contents.forcefullyCrashRenderer() }, `${url}/recovery`)
  await expect.poll(async () => Boolean((await cli('state')).crashes[tab.id])).toBe(true)
  await cli('reload', { tab: tab.id })
  await cli('wait', { tab: tab.id, selector: '#text' })
  expect((await cli('state')).crashes[tab.id]).toBeUndefined()

  let before = (await cli('diagnostics')).tabs
  await cli('kill-pane', { pane: pane.id })
  expect((await cli('diagnostics')).tabs).toBe(before - 1)
  let sourceWindow = await cli('new-window', { session: session.id, name: 'move source' })
  let source = await cli('split-window', { pane: sourceWindow.panes[0].id })
  await cli('move-pane', { pane: source.id, window: window.id })
  expect((await cli('list-panes', { window: window.id })).some((pane: { id: string }) => pane.id === source.id)).toBe(true)

  let client = await cli('attach-session', { session: session.id })
  await cli('select-window', { client: client.id, window: sourceWindow.id })
  await application.close()
  application = await electron.launch({ args: [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await application.evaluate(async ({ app }) => { await app.whenReady() })
  await expect.poll(async () => (await cli('list-clients')).length).toBe(1)
  expect((await cli('list-clients'))[0].windowId).toBe(sourceWindow.id)
  await cli('detach-client', { client: client.id })
  await cli('diagnostics')
  await new Promise(resolve => setTimeout(resolve, 2000))
  let metrics = await cli('diagnostics')
  let totalWorkingSetKB = metrics.processes.reduce((sum: number, process: { memory: { workingSetSize: number } }) => sum + process.memory.workingSetSize, 0)
  await fs.writeFile(path.join(root, 'artifacts/resource-sample.json'), JSON.stringify({ liveTabs: metrics.tabs, clients: metrics.visibleClients, workingSetMB: Math.round(totalWorkingSetKB / 1024), processes: metrics.processes }, null, 2))
})

test('removes a pane after an interrupted navigation and reports the recovery on restart', async () => {
  let session = await cli('new-session', { name: 'navigation crash recovery' })
  let retained = session.windows[0].panes[0]
  let crashed = await cli('split-window', { pane: retained.id, url: `${url}/crash-candidate` })
  await cli('wait', { tab: crashed.activeTabId, selector: '#text' })
  let client = await cli('attach-session', { session: session.id })
  await cli('select-pane', { client: client.id, pane: crashed.id })
  await application.close()
  await fs.writeFile(path.join(directory, 'navigation-crash.json'), JSON.stringify({ version: 2, paneId: crashed.id, tabId: crashed.activeTabId, url: 'https://chromewebstore.google.com/detail/example' }))
  application = await electron.launch({ args: [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await application.evaluate(async ({ app }) => { await app.whenReady() })
  await expect.poll(async () => (await cli('state')).startupNotice).toBe('Removed a pane after chromewebstore.google.com crashed bmux during navigation.')
  expect((await cli('list-panes', { window: session.windows[0].id })).map((pane: { id: string }) => pane.id)).toEqual([retained.id])
  expect((await cli('list-clients')).find((item: { id: string }) => item.id === client.id).paneId).toBe(retained.id)
  let chrome = application.context().pages().find(page => page.url().endsWith('index.html'))!
  await expect(chrome.getByText('Removed a pane after chromewebstore.google.com crashed bmux during navigation.', { exact: true })).toBeVisible()
  await cli('detach-client', { client: client.id })
  await application.close()
  await launch()
})

test('restores persisted pane navigations one at a time', async () => {
  let session = await cli('new-session', { name: 'serialized restore' })
  let first = session.windows[0].panes[0]
  let second = await cli('split-window', { pane: first.id })
  await application.close()
  let stateFile = path.join(directory, 'state.json')
  let persisted = JSON.parse(await fs.readFile(stateFile, 'utf8'))
  let saved = persisted.sessions.find((item: { id: string }) => item.id === session.id)
  saved.windows[0].panes.find((pane: { id: string }) => pane.id === first.id).tabs[0].url = `${url}/slow-serialized-restore`
  saved.windows[0].panes.find((pane: { id: string }) => pane.id === second.id).tabs[0].url = `${url}/serialized-restore-second`
  await fs.writeFile(stateFile, JSON.stringify(persisted, null, 2))
  let before = heldRequests
  await launch()
  await expect.poll(() => heldRequests).toBeGreaterThan(before)
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'navigation-crash.json'), 'utf8')).tabId).toBe(first.activeTabId)
  expect(await application.evaluate(({ webContents }, target) => webContents.getAllWebContents().some(contents => contents.getURL() === target), `${url}/serialized-restore-second`)).toBe(false)
  for (let response of heldResponses) response.end()
  await expect.poll(async () => application.evaluate(({ webContents }, target) => webContents.getAllWebContents().some(contents => contents.getURL() === target), `${url}/serialized-restore-second`)).toBe(true)
  await expect.poll(() => fs.access(path.join(directory, 'navigation-crash.json')).then(() => false, () => true)).toBe(true)
})

test('imports Brave bookmark folders, opens them in the correct profile, and persists them', async () => {
  let source = path.join(directory, 'brave-fixture')
  await fs.mkdir(path.join(source, 'Default'), { recursive: true })
  await fs.writeFile(path.join(source, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Imported work' } } } }))
  await fs.writeFile(path.join(source, 'Default', 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [{ type: 'folder', name: 'Projects', children: [{ type: 'url', name: 'Imported fixture', url: `${url}/imported` }, { type: 'url', name: 'Unsupported bookmarklet', url: 'javascript:alert(1)' }] }] } } }))
  let result = await cli('import-brave', { source })
  expect(result.bookmarks).toBe(2)
  let profileId = result.profiles[0].profileId
  expect((await cli('import-brave', { source })).profiles[0]).toMatchObject({ profileId, created: false })
  let session = (await cli('list-sessions')).find((session: { defaultProfileId: string }) => session.defaultProfileId === profileId)
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.windows().find(window => window.url().endsWith('/renderer/index.html'))!
  await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  await chrome.getByRole('combobox', { name: 'Command', exact: true }).fill('bookmarks')
  await chrome.getByRole('combobox', { name: 'Command', exact: true }).press('Enter')
  await expect(chrome.getByText('Projects', { exact: true })).toBeVisible()
  await expect(chrome.getByRole('button', { name: 'Unsupported bookmarklet' })).toBeDisabled()
  await chrome.screenshot({ path: path.join(root, 'artifacts/bookmarks.png') })
  await chrome.getByRole('textbox', { name: 'Search bookmarks' }).fill('Imported fixture')
  await expect(chrome.getByRole('button', { name: 'Imported fixture', exact: true })).toBeVisible()
  await expect(chrome.getByRole('button', { name: 'Unsupported bookmarklet' })).toHaveCount(0)
  await expect(chrome.getByText('Profile: Imported work', { exact: true })).toHaveCount(0)
  await chrome.getByRole('button', { name: 'Imported fixture', exact: true }).click()
  let pane = session.windows[0].panes[0]
  let tab = (await cli('tab.list', { pane: pane.id })).find((tab: { url: string }) => tab.url === `${url}/imported`)
  expect(tab.profileId).toBe(profileId)
  expect(tab.active).toBe(true)
  await cli('wait', { tab: tab.id, selector: '#text' })
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill('Imported fixture')
  let bookmarkSuggestion = chrome.getByRole('option').filter({ hasText: 'Imported fixture' })
  await expect(bookmarkSuggestion).toHaveAttribute('data-kind', 'bookmark')
  await expect(bookmarkSuggestion.locator('svg')).toBeVisible()
  await expect(bookmarkSuggestion).not.toContainText('Bookmark')
  await address.press('ArrowDown')
  await address.press('Enter')
  await expect(address).toHaveCount(0)
  expect(await cli('eval', { tab: tab.id, expression: 'localStorage.getItem("profile")' })).toBeNull()
  await cli('detach-client', { client: client.id })
  await application.close()
  await launch()
  let profile = (await cli('profile.list')).find((profile: { id: string }) => profile.id === profileId)
  expect(profile.bookmarks[0].children[0].children).toHaveLength(2)
  expect((await fs.readdir(directory)).some(name => name.startsWith('state.before-brave-'))).toBe(true)
})

test('URL entry after import attaches the live page; native shortcuts and commands work', async () => {
  let session = await cli('new-session', { name: 'UI regression' })
  let pane = session.windows[0].panes[0], tab = pane.tabs[0]
  await cli('import-brave', { source: path.join(directory, 'brave-fixture') })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().find(page => page.url().endsWith('index.html'))!
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(`${url}/entered-in-ui`)
  await address.press('Enter')
  await expect(address).toHaveCount(0)
  await expect.poll(async () => (await cli('tab.list', { pane: pane.id }))[0].url).toBe(`${url}/entered-in-ui`)
  await expect.poll(async () => { await cli('activate-client', { client: client.id }); return application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url)), `${url}/entered-in-ui`) }).toBe(true)
  // Deliver keys to the actual page WebContents, not to the React document.
  await application.evaluate(({ webContents }, url) => {
    let page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    page.focus()
    page.sendInputEvent({ type: 'keyDown', keyCode: 'l', modifiers: ['meta'] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'l', modifiers: ['meta'] })
  }, `${url}/entered-in-ui`)
  await expect(address).toBeFocused()
  await address.fill(`${url}/second-ui-navigation`)
  await address.press('Enter')
  await expect(address).toHaveCount(0)
  await expect.poll(async () => (await cli('tab.list', { pane: pane.id }))[0].url).toBe(`${url}/second-ui-navigation`)
  await cli('activate-client', { client: client.id })
  await cli('focus-page', { client: client.id })
  await application.evaluate(({ webContents }, url) => {
    let page = webContents.getFocusedWebContents()!
    for (let event of [{ keyCode: 'b', modifiers: ['control'] }, { keyCode: 'Shift', modifiers: ['shift'] }, { keyCode: '?', modifiers: ['shift'] }] satisfies Omit<Electron.KeyboardInputEvent, 'type'>[]) {
      page.sendInputEvent({ type: 'keyDown', ...event }); page.sendInputEvent({ type: 'keyUp', ...event })
    }
  }, `${url}/second-ui-navigation`)
  await expect(chrome.getByRole('dialog', { name: 'Help' })).toBeVisible()
  await chrome.keyboard.press('Escape')
  await expect(chrome.getByRole('dialog')).toHaveCount(0)
  await application.evaluate(({ webContents }) => {
    let chrome = webContents.getAllWebContents().find(page => page.getURL().endsWith('/renderer/index.html'))!
    chrome.focus()
    for (let event of [{ keyCode: 'b', modifiers: ['control'] }, { keyCode: 'Shift', modifiers: ['shift'] }, { keyCode: ':', modifiers: ['shift'] }] satisfies Omit<Electron.KeyboardInputEvent, 'type'>[]) {
      chrome.sendInputEvent({ type: 'keyDown', ...event }); chrome.sendInputEvent({ type: 'keyUp', ...event })
    }
  })
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true })
  await expect(command).toBeFocused()
  await command.fill('new-window -n "from prompt"')
  await command.press('Enter')
  await expect(command).toHaveCount(0)
  await expect(chrome.getByRole('button', { name: '2:from prompt*', exact: true })).toBeVisible()
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  await command.fill('open not-a-protocol://example')
  await command.press('Enter')
  await expect(chrome.getByRole('status')).toContainText('Only http')
  await command.press('Escape')
  await chrome.getByRole('button', { name: '1:127.0.0.1', exact: true }).click()
  await cli('client.overlay', { client: client.id, visible: true })
  await chrome.waitForTimeout(200)
  await chrome.screenshot({ path: path.join(root, 'artifacts/minimal-ui.png') })
  await cli('client.overlay', { client: client.id, visible: false })
  await cli('detach-client', { client: client.id })
})

test('pane address bars navigate independently and leave window switching available', async () => {
  let session = await cli('new-session', { name: 'pane-addresses' })
  let window = session.windows[0], first = window.panes[0]
  let second = await cli('split-window', { pane: first.id, url: `${url}/second-pane` })
  let third = await cli('split-window', { pane: second.id, axis: 'vertical', url: `${url}/third-pane` })
  await cli('navigate', { tab: first.activeTabId, url: `${url}/first-pane` })
  let other = await cli('new-window', { session: session.id, name: 'other' })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let status = chrome.getByRole('contentinfo', { name: 'Browser status' })
  let secondPane = chrome.locator(`[data-pane-id="${second.id}"]`)
  let address = secondPane.getByRole('textbox', { name: 'URL or search', exact: true })
  await expect(chrome.getByRole('group', { name: 'Pane address', exact: true })).toHaveCount(3)
  await expect(status.getByRole('button', { name: 'Address', exact: true })).toHaveCount(0)
  // Clicking an inactive pane must select it without handing typing focus to its page.
  await secondPane.getByRole('button', { name: 'Address', exact: true }).click()
  await expect(address).toBeFocused()
  await expect(address).toHaveValue(`${url}/second-pane`)
  await expect(status.getByRole('button', { name: '1:127.0.0.1*', exact: true })).toBeVisible()
  await address.fill(`${url}/edited-second-pane`); await address.press('Enter')
  await expect(address).toHaveCount(0)
  await cli('wait', { tab: second.activeTabId, selector: '#text' })
  expect((await cli('list-panes', { window: window.id })).map((pane: { tabs: { url: string }[] }) => pane.tabs[0].url)).toEqual([`${url}/first-pane`, `${url}/edited-second-pane`, `${url}/third-pane`])
  await cli('select-pane', { client: client.id, pane: third.id })
  await expect.poll(async () => chrome.locator(`[data-pane-id="${third.id}"]`).getAttribute('data-focused-pane')).toBe('true')
  let activeBorder = await chrome.locator(`[data-pane-id="${third.id}"]`).evaluate(element => {
    let pane = element.getBoundingClientRect(), address = element.querySelector('[aria-label="Pane address"]')!.getBoundingClientRect(), style = getComputedStyle(element)
    return { color: style.borderTopColor, widths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], addressOffset: address.y - pane.y }
  })
  expect(activeBorder).toEqual({ color: 'rgb(131, 145, 123)', widths: ['1px', '1px', '1px', '1px'], addressOffset: 1 })
  await cli('toggle-pane-zoom', { client: client.id })
  await expect(chrome.locator('[data-pane-id]')).toHaveCount(1)
  await expect(chrome.locator(`[data-pane-id="${third.id}"]`).getByRole('group', { name: 'Pane address' })).toBeVisible()
  expect((await cli('list-clients'))[0].zoomedPaneId).toBe(third.id)
  await cli('toggle-pane-zoom', { client: client.id })
  await expect(chrome.locator('[data-pane-id]')).toHaveCount(3)
  expect((await cli('list-clients'))[0].zoomedPaneId).toBeNull()
  await cli('select-pane', { client: client.id, pane: second.id })
  // Every native page must fit below its own address row in both split directions.
  await cli('activate-client', { client: client.id })
  for (let pane of [first, second, third]) {
    let container = chrome.locator(`[data-pane-id="${pane.id}"]`)
    let bar = await container.getByRole('group', { name: 'Pane address' }).boundingBox()
    let content = await container.locator('[data-browser-content]').boundingBox()
    expect(content!.y).toBe(bar!.y + bar!.height)
    let target = pane.id === second.id ? `${url}/edited-second-pane` : pane.id === first.id ? `${url}/first-pane` : `${url}/third-pane`
    await expect.poll(() => application.evaluate(({ BaseWindow }, target) => {
      let view = BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === target)
      return view?.getBounds()
    }, target)).toEqual({ x: Math.round(content!.x), y: Math.round(content!.y), width: Math.round(content!.width), height: Math.round(content!.height) })
  }
  await cli('focus-page', { client: client.id })
  await application.evaluate(({ webContents }) => {
    let page = webContents.getFocusedWebContents()!
    page.sendInputEvent({ type: 'keyDown', keyCode: 'l', modifiers: ['meta'] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'l', modifiers: ['meta'] })
  })
  await expect(address).toBeFocused()
  await address.fill('not-a-protocol://example'); await address.press('Enter')
  await expect(secondPane.getByRole('status')).toContainText('Only http')
  await address.press('Escape')
  await expect(secondPane.getByRole('button', { name: 'Address', exact: true })).toHaveText(`${url}/edited-second-pane`)
  await secondPane.getByRole('button', { name: 'Address', exact: true }).click()
  await expect(chrome.getByRole('listbox', { name: 'Address suggestions' })).toHaveCount(0)
  await address.fill('one two three')
  await application.evaluate(({ webContents }) => {
    let chrome = webContents.getFocusedWebContents()!
    chrome.sendInputEvent({ type: 'keyDown', keyCode: 'w', modifiers: ['control'] })
    chrome.sendInputEvent({ type: 'keyDown', keyCode: 'w', modifiers: ['control', 'isautorepeat'] })
    chrome.sendInputEvent({ type: 'keyUp', keyCode: 'w', modifiers: ['control'] })
  })
  await expect(address).toHaveValue('one ')
  let contentBeforeSuggestions = await secondPane.locator('[data-browser-content]').boundingBox()
  await address.fill('edited-second-pane')
  let suggestions = chrome.getByRole('listbox', { name: 'Address suggestions' })
  await expect(suggestions).toBeVisible()
  await expect(secondPane.getByRole('img', { name: 'Page preview' })).toBeVisible()
  let suggestionBounds = await suggestions.boundingBox()
  let contentWithSuggestions = await secondPane.locator('[data-browser-content]').boundingBox()
  expect(contentWithSuggestions!.y).toBe(contentBeforeSuggestions!.y)
  expect(suggestionBounds!.y).toBe(contentWithSuggestions!.y)
  expect(suggestionBounds!.x).toBe(0)
  expect(suggestionBounds!.width).toBe(await chrome.evaluate(() => window.innerWidth))
  expect(suggestionBounds!.height).toBeLessThan(contentWithSuggestions!.height / 2)
  await expect(suggestions.getByRole('option').first()).toHaveAttribute('aria-selected', 'false')
  await address.press('ArrowDown')
  await expect(suggestions.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await expect(address).toBeFocused()
  await expect(address).toHaveValue(`${url}/edited-second-pane`)
  await expect.poll(() => address.evaluate(element => { let input = element as HTMLInputElement; return { start: input.selectionStart, end: input.selectionEnd } })).toEqual({ start: 0, end: `${url}/edited-second-pane`.length })
  await address.press('ArrowUp')
  await expect(address).toHaveValue('edited-second-pane')
  await address.press('ArrowDown')
  await address.press('Enter')
  await expect(address).toHaveCount(0)
  await secondPane.getByRole('button', { name: 'Address', exact: true }).click()
  await address.fill('http')
  await expect.poll(() => address.evaluate(element => { let input = element as HTMLInputElement; return { value: input.value, start: input.selectionStart, end: input.selectionEnd } })).toEqual({ value: `${url}/edited-second-pane`, start: 4, end: `${url}/edited-second-pane`.length })
  await address.press('ArrowRight')
  await expect(address).toHaveValue(`${url}/edited-second-pane`)
  await address.press('Backspace')
  await expect(address).toHaveValue(`${url}/edited-second-pan`)
  await application.evaluate(({ webContents }) => {
    let chrome = webContents.getFocusedWebContents()!
    chrome.sendInputEvent({ type: 'keyDown', keyCode: 'l', modifiers: ['meta'] })
    chrome.sendInputEvent({ type: 'keyUp', keyCode: 'l', modifiers: ['meta'] })
  })
  await expect.poll(() => address.evaluate(element => { let input = element as HTMLInputElement; return { start: input.selectionStart, end: input.selectionEnd, length: input.value.length } })).toEqual({ start: 0, end: `${url}/edited-second-pan`.length, length: `${url}/edited-second-pan`.length })
  await address.press('Enter')
  await expect(address).toHaveCount(0)
  await expect.poll(async () => (await cli('tab.list', { pane: second.id })).find((tab: { id: string }) => tab.id === second.activeTabId)?.url).toBe(`${url}/edited-second-pan`)
  await secondPane.getByRole('button', { name: 'Address', exact: true }).click()
  await address.fill(`${url}/unsaved`)
  await status.getByRole('button', { name: '2:other', exact: true }).click()
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(other.id)
  await expect(chrome.getByRole('textbox', { name: 'URL or search', exact: true })).toHaveCount(0)
  await status.getByRole('button', { name: '1:127.0.0.1', exact: true }).click()
  await expect(secondPane.getByRole('button', { name: 'Address', exact: true })).toHaveText(`${url}/edited-second-pan`)
  await cli('detach-client', { client: client.id })
})

test('Command+L shows and replaces the URL during pending navigations', async () => {
  let session = await cli('new-session', { name: 'pending-address' })
  let tab = session.windows[0].panes[0].tabs[0]
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  let openAddress = async () => {
    await cli('activate-client', { client: client.id })
    await cli('focus-page', { client: client.id })
    await sendNativeKeys(application, [{ keyCode: 'l', modifiers: ['meta'] }])
  }

  await cli('navigate', { tab: tab.id, url: `${url}/pending-tab`, waitUntil: 'none' })
  await expect.poll(async () => (await cli('state')).pendingUrls[tab.id]).toBe(`${url}/pending-tab`)
  await expect(chrome.getByRole('button', { name: 'Address', exact: true })).toHaveText(`${url}/pending-tab`)
  await openAddress()
  await expect(address).toHaveValue(`${url}/pending-tab`)
  await address.fill(`${url}/replaced`); await address.press('Enter')
  await expect.poll(async () => (await cli('tab.list', { pane: session.windows[0].panes[0].id }))[0].url).toBe(`${url}/replaced`)

  await cli('eval', { tab: tab.id, expression: 'location.href = "/pending-tab"; true' })
  await expect.poll(async () => (await cli('state')).pendingUrls[tab.id]).toBe(`${url}/pending-tab`)
  await openAddress()
  await expect(address).toHaveValue(`${url}/pending-tab`)
  await address.press('Escape')
  await cli('stop', { tab: tab.id })
  await cli('detach-client', { client: client.id })
})

test('stalled loads cannot block shortcuts, independent windows, or live keyboard settings', async () => {
  let session = await cli('new-session', { name: 'slow-loading' })
  let first = session.windows[0], tab = first.panes[0].tabs[0]
  let second = await cli('new-window', { session: session.id, name: 'second' })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(`${url}/slow`); await address.press('Enter')
  await expect(address).toHaveCount(0, { timeout: 1500 })
  await expect(chrome.getByRole('button', { name: 'Address', exact: true })).toHaveText(`${url}/slow`)
  await expect.poll(async () => Boolean((await cli('state')).loading[tab.id])).toBe(true)
  let nativeKeys = async (events: Omit<Electron.KeyboardInputEvent, 'type'>[]) => {
    await cli('activate-client', { client: client.id })
    await cli('focus-page', { client: client.id })
    await sendNativeKeys(application, events)
  }
  await cli('focus-page', { client: client.id })
  await nativeKeys([{ keyCode: 'b', modifiers: ['control'] }, { keyCode: 'c' }])
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).length, { timeout: 1500 }).toBe(3)
  expect((await cli('diagnostics')).windows.find((window: { id: string }) => window.id === client.id).focused).toBe(true)
  let third = (await cli('list-windows', { session: session.id }))[2]
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(third.id)
  await expect.poll(async () => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children.filter(view => 'webContents' in view).map(view => (view as Electron.WebContentsView).webContents.getURL())).some(url => url.endsWith('/slow'))), { timeout: 1500 }).toBe(false)
  await expect(address).toBeFocused()
  await address.fill(`${url}/independent`); await address.press('Enter')
  await cli('wait', { tab: third.panes[0].activeTabId, selector: '#text' })
  let windows = await cli('list-windows', { session: session.id })
  expect(windows.map((window: { panes: { tabs: { url: string }[] }[] }) => window.panes[0].tabs[0].url)).toEqual([`${url}/slow`, 'about:blank', `${url}/independent`])
  let start = Date.now()
  await cli('select-window', { client: client.id, window: first.id })
  expect(Date.now() - start).toBeLessThan(1500)
  await cli('activate-client', { client: client.id })
  await expect.poll(async () => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children.filter(view => 'webContents' in view).map(view => (view as Electron.WebContentsView).webContents.getURL())).some(url => url.endsWith('/slow')))).toBe(true)
  await cli('focus-page', { client: client.id })
  let requests = heldRequests
  await nativeKeys([{ keyCode: 'r', modifiers: ['meta'] }])
  await expect.poll(() => heldRequests).toBeGreaterThan(requests)
  await nativeKeys([{ keyCode: 'b', modifiers: ['control'] }, { keyCode: '?', modifiers: ['shift'] }])
  await expect(chrome.getByRole('dialog', { name: 'Help' })).toBeVisible()
  await chrome.keyboard.press('Escape')
  await cli('stop', { tab: tab.id })
  await expect.poll(async () => Boolean((await cli('state')).loading[tab.id])).toBe(false)
  // A load started through the agent API also must not block human controls.
  let pending = cli('navigate', { tab: tab.id, url: `${url}/slow?agent=1` }).catch(() => undefined)
  await expect.poll(async () => Boolean((await cli('state')).loading[tab.id])).toBe(true)
  await cli('select-window', { client: client.id, window: second.id })
  await cli('stop', { tab: tab.id }); await pending
  let config = path.join(directory, 'config.yaml')
  let statusBar = chrome.getByRole('contentinfo', { name: 'Browser status' })
  await fs.writeFile(config, 'statusBar: bottom\nkeyboard:\n  prefix: Ctrl+X\n  shortcuts:\n    Cmd+R: null\n')
  await expect.poll(async () => (await cli('state')).keyboard.prefix).toBe('Ctrl+X')
  await expect.poll(async () => (await statusBar.boundingBox())!.y).toBeGreaterThan((await chrome.locator('main').boundingBox())!.y)
  expect((await cli('state')).statusBar).toBe('bottom')
  expect((await cli('state')).keyboard.shortcuts['Cmd+R']).toBeUndefined()
  await application.evaluate(({ webContents }) => webContents.getAllWebContents().find(page => page.getURL().endsWith('/renderer/index.html'))!.focus())
  await nativeKeys([{ keyCode: 'x', modifiers: ['control'] }, { keyCode: '?', modifiers: ['shift'] }])
  await expect(chrome.getByRole('dialog', { name: 'Help' })).toBeVisible()
  await expect(chrome.getByText('Ctrl+X then ?', { exact: true })).toBeVisible()
  await chrome.keyboard.press('Escape')
  await nativeKeys([{ keyCode: ',', modifiers: ['meta'] }])
  await expect(chrome.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await fs.writeFile(config, 'keyboard: [broken')
  await expect.poll(async () => Boolean((await cli('state')).configError)).toBe(true)
  expect((await cli('state')).keyboard.prefix).toBe('Ctrl+X')
  await fs.writeFile(config, 'statusBar: top\nkeyboard: {}\n')
  await expect.poll(async () => (await cli('state')).configError).toBeNull()
  await expect.poll(async () => (await statusBar.boundingBox())!.y - (await chrome.locator('main').boundingBox())!.y).toBeLessThan(0)
  await cli('detach-client', { client: client.id })
  for (let response of heldResponses) response.end()
})


test('configured Vim page keys scroll, reload, and open find outside text fields', async () => {
  let config = path.join(directory, 'config.yaml'), previous = await fs.readFile(config, 'utf8')
  await fs.writeFile(config, 'accessibility: true\nkeyboard:\n  shortcuts:\n    Shift+H: { action: back, when: pane-not-editing }\n    Shift+L: { action: forward, when: pane-not-editing }\n    j: { action: scroll-down, when: pane-not-editing }\n    k: { action: scroll-up, when: pane-not-editing }\n    d: { action: scroll-half-down, when: pane-not-editing }\n    u: { action: scroll-half-up, when: pane-not-editing }\n    Shift+G: { action: scroll-bottom, when: pane-not-editing }\n    r: { action: reload, when: pane-not-editing }\n    Shift+R: { action: hard-reload, when: pane-not-editing }\n    /: { action: find, when: pane-not-editing }\n  sequences:\n    gg: { action: scroll-top, when: pane-not-editing }\n')
  await cli('settings.reload')
  let session = await cli('new-session', { name: 'vim-page-keys' })
  let tab = session.windows[0].panes[0].activeTabId
  let client = await cli('attach-session', { session: session.id })
  await cli('navigate', { tab, url: `${url}/vim-page-keys` })
  let page = application.context().pages().find(page => page.url() === `${url}/vim-page-keys`)!
  await page.locator('#inc').click()
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let press = async (keyCode: string, modifiers: Electron.KeyboardInputEvent['modifiers'] = []) => {
    await cli('activate-client', { client: client.id })
    await cli('focus-page', { client: client.id })
    await sendNativeKeys(application, [{ keyCode, modifiers }])
  }
  let scroll = () => cli('eval', { tab, expression: 'scrollY' }) as Promise<number>
  await page.evaluate(() => {
    let wrapper = document.createElement('div')
    wrapper.id = 'page-focus-wrapper'
    wrapper.tabIndex = -1
    wrapper.innerHTML = '<p id="wrapper-content">Page content</p>'
    document.body.prepend(wrapper)
  })
  await page.locator('#wrapper-content').click()
  await expect(page.locator('#page-focus-wrapper')).toBeFocused()
  await page.mouse.wheel(0, 200)
  let wheelPosition = await scroll()
  await press('j')
  await expect.poll(scroll).toBeGreaterThan(wheelPosition)
  await page.evaluate(() => scrollTo(0, 0))
  await press('j')
  await expect.poll(scroll).toBeGreaterThan(0)
  await press('k')
  await expect.poll(scroll).toBe(0)
  await press('d')
  await expect.poll(scroll).toBeGreaterThan(200)
  await press('u')
  await expect.poll(scroll).toBeLessThan(200)
  await press('g'); await press('g')
  await expect.poll(scroll).toBe(0)
  await press('g', ['shift'])
  await expect.poll(async () => (await cli('eval', { tab, expression: 'scrollY + innerHeight >= document.documentElement.scrollHeight - 2' }))).toBe(true)
  await press('g'); await press('g')
  await expect.poll(scroll).toBe(0)
  let identity = await cli('eval', { tab, expression: 'window.identity' })
  await press('r')
  await expect.poll(() => cli('eval', { tab, expression: 'window.identity' })).not.toBe(identity)
  identity = await cli('eval', { tab, expression: 'window.identity' })
  await press('r', ['shift'])
  await expect.poll(() => cli('eval', { tab, expression: 'window.identity' })).not.toBe(identity)
  await press('/')
  await expect(chrome.getByRole('textbox', { name: 'Find in page' })).toBeFocused()
  await chrome.keyboard.press('Escape')
  await cli('focus-page', { client: client.id })
  let loadedIdentity = await cli('eval', { tab, expression: 'window.identity' })
  let keys = ['H', 'L', 'j', 'k', 'd', 'u', 'G', 'r', 'R', '/', 'g', 'g']
  let input = page.locator('#text')
  await input.click()
  for (let key of keys) await input.press(key)
  await expect(input).toHaveValue(keys.join(''))
  expect(await scroll()).toBe(0)
  expect(page.url()).toBe(`${url}/vim-page-keys`)
  expect(await cli('eval', { tab, expression: 'window.identity' })).toBe(loadedIdentity)
  await expect(chrome.getByRole('textbox', { name: 'Find in page' })).toHaveCount(0)
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill('')
  for (let key of keys) await address.press(key)
  await expect(address).toHaveValue(keys.join(''))
  expect(page.url()).toBe(`${url}/vim-page-keys`)
  expect(await cli('eval', { tab, expression: 'window.identity' })).toBe(loadedIdentity)
  await address.press('Escape')
  await cli('detach-client', { client: client.id })
  await fs.writeFile(config, previous)
  await cli('settings.reload')
})

test('native click mode activates with Option taps and performs each click action', async () => {
  let config = path.join(directory, 'config.yaml'), previous = await fs.readFile(config, 'utf8')
  await fs.writeFile(config, 'clickMode:\n  enabled: true\n  doubleTapModifier: Option\nkeyboard: {}\n')
  await cli('settings.reload')
  let session = await cli('new-session', { name: 'click-mode' })
  let tab = session.windows[0].panes[0].activeTabId
  let client = await cli('attach-session', { session: session.id })
  await cli('navigate', { tab, url: `${url}/click-mode` })
  let page = application.context().pages().find(page => page.url() === `${url}/click-mode`)!
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await page.evaluate(() => {
    let fixture = document.createElement('div')
    fixture.style.cssText = 'position:fixed;left:420px;top:90px;width:500px;z-index:2'
    fixture.innerHTML = Array.from({ length: 30 }, (_, index) => `<button data-extra="${index}">Extra ${index}</button>`).join('')
    document.body.append(fixture)
    ;(window as any).rightClicks = 0; (window as any).commandClicks = 0; (window as any).doubleClicks = 0
    let button = document.querySelector('#inc')!
    button.addEventListener('contextmenu', event => { event.preventDefault(); (window as any).rightClicks++ })
    button.addEventListener('click', event => { if ((event as MouseEvent).metaKey) (window as any).commandClicks++ })
    button.addEventListener('dblclick', () => { (window as any).doubleClicks++ })
  })
  let activate = async () => {
    await cli('activate-client', { client: client.id }); await cli('focus-page', { client: client.id })
    expect((await cli('click-mode', { client: client.id })).active).toBe(true)
    await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(1)
    await expect(chrome.locator('[data-bmux-click-mode]')).toHaveCount(0)
  }
  let keys = async (...keyCodes: string[]) => sendNativeKeys(application, keyCodes.map(keyCode => ({ keyCode })))
  try {
    await cli('activate-client', { client: client.id }); await cli('focus-page', { client: client.id })
    await sendNativeKeys(application, [{ keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: 'Alt', modifiers: ['alt'] }])
    await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(1)
    await keys('a', '1', 'Backspace', 'a', 's')
    await expect.poll(() => cli('eval', { tab, expression: 'window.count' })).toBe(1)
    await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(0)

    await activate(); await keys('r', 'a', 's')
    await expect.poll(() => cli('eval', { tab, expression: 'window.rightClicks' })).toBe(1)

    await activate(); await keys('c', 'a', 's')
    await expect.poll(() => cli('eval', { tab, expression: 'window.commandClicks' })).toBe(1)

    await activate(); await keys('d', 'a', 's')
    await expect.poll(() => cli('eval', { tab, expression: 'window.doubleClicks' })).toBe(1)

    await page.evaluate(() => {
      document.body.replaceChildren()
      let host = document.createElement('div'), shadow = host.attachShadow({ mode: 'open' }), button = document.createElement('button')
      button.textContent = 'Shadow action'; button.addEventListener('click', () => { (window as any).shadowClicks = ((window as any).shadowClicks || 0) + 1 })
      shadow.append(button); document.body.append(host)
    })
    await activate(); await keys('a')
    await expect.poll(() => cli('eval', { tab, expression: 'window.shadowClicks' })).toBe(1)

    let frameUrl = `${url.replace('127.0.0.1', 'localhost')}/click-frame`
    await page.evaluate(frameUrl => {
      let frame = document.createElement('iframe'); frame.src = frameUrl; frame.style.cssText = 'width:800px;height:500px;border:0'
      document.body.replaceChildren(frame)
    }, frameUrl)
    await expect.poll(() => page.frames().some(frame => frame.url() === frameUrl)).toBe(true)
    let child = page.frames().find(frame => frame.url() === frameUrl)!
    await child.locator('#inc').waitFor()
    await activate(); await keys('s')
    await expect.poll(() => child.evaluate(() => (window as any).count)).toBe(1)

    await activate(); await keys('Escape')
    await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(0)

    await fs.writeFile(config, 'clickMode:\n  enabled: false\nkeyboard: {}\n')
    await expect.poll(async () => (await cli('state')).clickMode.enabled).toBe(false)
    expect((await cli('click-mode', { client: client.id })).active).toBe(false)
    await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(0)
  } finally {
    await page.evaluate(() => document.body.replaceChildren()).catch(() => undefined)
    await cli('detach-client', { client: client.id })
    await fs.writeFile(config, previous)
    await cli('settings.reload')
  }
})

test('reopen closed internal windows and pane tabs', async () => {
  let session = await cli('new-session', { name: 'reopen-shortcut' })
  let client = await cli('attach-session', { session: session.id })
  let first = session.windows[0]
  let pane = first.panes[0]
  let second = await cli('new-window', { session: session.id, client: client.id, url })
  await cli('wait', { tab: second.panes[0].activeTabId, selector: '#text' })
  await cli('activate-client', { client: client.id })
  await cli('focus-page', { client: client.id })
  await sendNativeKeys(application, [{ keyCode: 'w', modifiers: ['meta'] }])
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(1)
  await sendNativeKeys(application, [{ keyCode: 't', modifiers: ['meta', 'shift'] }])
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([first.id, second.id])
  expect((await cli('list-clients'))[0].windowId).toBe(second.id)
  await cli('wait', { tab: second.panes[0].activeTabId, selector: '#text' })
  let extra = await cli('tab.create', { pane: pane.id, url, client: client.id })
  await cli('wait', { tab: extra.id, selector: '#text' })
  await cli('tab.close', { tab: extra.id })
  expect((await cli('tab.list', { pane: pane.id })).map((tab: { id: string }) => tab.id)).not.toContain(extra.id)
  await cli('reopen-closed-tab', { client: client.id })
  expect((await cli('tab.list', { pane: pane.id })).map((tab: { id: string }) => tab.id)).toContain(extra.id)
  await cli('wait', { tab: extra.id, selector: '#text' })
  let onlyTab = second.panes[0].tabs[0]
  await cli('tab.close', { tab: onlyTab.id })
  expect((await cli('tab.list', { pane: second.panes[0].id })).map((tab: { url: string }) => tab.url)).toEqual(['about:blank'])
  await cli('reopen-closed-tab', { client: client.id })
  expect((await cli('tab.list', { pane: second.panes[0].id })).map((tab: { id: string }) => tab.id)).toEqual([onlyTab.id])
  await cli('wait', { tab: onlyTab.id, selector: '#text' })
})

test('window management shortcuts and keyboard session selection', async () => {
  let alpha = await cli('new-session', { name: 'keyboard-alpha' })
  let beta = await cli('new-session', { name: 'keyboard-beta' })
  let gamma = await cli('new-session', { name: 'keyboard-gamma' })
  let client = await cli('attach-session', { session: alpha.id })
  let first = alpha.windows[0]
  await cli('navigate', { tab: first.panes[0].activeTabId, url })
  let temporary = await cli('new-window', { session: alpha.id, client: client.id, name: 'temporary' })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let shortcut = async (keyCode: string, modifiers: Electron.KeyboardInputEvent['modifiers'] = [], prefix = true) => {
    await cli('activate-client', { client: client.id })
    await cli('focus-page', { client: client.id })
    let events: Omit<Electron.KeyboardInputEvent, 'type'>[] = [{ keyCode, modifiers }]
    if (prefix) events.unshift({ keyCode: 'b', modifiers: ['control'] })
    await sendNativeKeys(application, events)
  }
  await shortcut('t', ['meta'], false)
  await expect.poll(async () => (await cli('list-windows', { session: alpha.id })).length).toBe(3)
  let windowsAfterCmdT = await cli('list-windows', { session: alpha.id })
  let createdByCmdT = windowsAfterCmdT.find((window: { id: string }) => ![first.id, temporary.id].includes(window.id))
  expect(createdByCmdT).toBeTruthy()
  expect((await cli('list-clients'))[0].windowId).toBe(createdByCmdT.id)
  expect(await cli('eval', { tab: first.panes[0].activeTabId, expression: 'document.title' })).toBe('bmux fixture')
  await cli('kill-window', { window: createdByCmdT.id, confirm: true })
  await cli('select-window', { client: client.id, window: temporary.id })
  await shortcut('1')
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(first.id)
  await shortcut('2', ['meta'], false)
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(temporary.id)
  await shortcut(',')
  let rename = chrome.getByRole('textbox', { name: 'Rename window', exact: true })
  await expect(rename).toHaveValue('temporary')
  await rename.fill('cancelled'); await rename.press('Escape')
  expect((await cli('list-windows', { session: alpha.id }))[1].name).toBe('temporary')
  await shortcut(',')
  await rename.fill('research "notes"'); await rename.press('Enter')
  await expect(chrome.getByRole('button', { name: '2:research "notes"*', exact: true })).toBeVisible()
  let confirmationWindow = await cli('new-window', { session: alpha.id, client: client.id, name: 'confirmation' })
  await cli('split-window', { pane: confirmationWindow.panes[0].id, client: client.id })
  await shortcut('&', ['shift'])
  let confirm = chrome.getByRole('textbox', { name: 'Close window confirmation' })
  await expect(confirm).toBeFocused()
  await confirm.press('n')
  expect((await cli('list-windows', { session: alpha.id })).length).toBe(3)
  await shortcut('&', ['shift'])
  await confirm.press('y')
  await expect.poll(async () => (await cli('list-windows', { session: alpha.id })).length).toBe(2)
  await cli('select-window', { client: client.id, window: temporary.id })
  await shortcut('&', ['shift'])
  await expect.poll(async () => (await cli('list-windows', { session: alpha.id })).map((window: { id: string }) => window.id)).toEqual([first.id])
  expect(await cli('eval', { tab: first.panes[0].activeTabId, expression: 'document.title' })).toBe('bmux fixture')
  // Closing the last internal window removes its session and selects the next one.
  await shortcut('&', ['shift'])
  await expect.poll(async () => (await cli('list-sessions')).some((session: { id: string }) => session.id === alpha.id)).toBe(false)
  await expect.poll(async () => (await cli('list-clients'))[0].sessionId).toBe(beta.id)
  await shortcut('$', ['shift'])
  let sessionName = chrome.getByRole('textbox', { name: 'Rename session', exact: true })
  await sessionName.fill('keyboard-renamed'); await sessionName.press('Enter')
  await expect(chrome.getByRole('button', { name: 'Sessions', exact: true })).toHaveText('[keyboard-renamed]')
  let picker = chrome.getByRole('dialog', { name: 'Sessions', exact: true })
  await shortcut('w', ['meta', 'control', 'alt', 'shift'], false)
  await expect(picker).toBeVisible()
  await chrome.keyboard.press('Escape')
  await shortcut('s')
  await expect(picker.getByRole('button', { name: 'keyboard-renamed', exact: true })).toBeFocused()
  await chrome.keyboard.press('ArrowDown')
  await expect(picker.getByRole('button', { name: 'keyboard-gamma', exact: true })).toBeFocused()
  await chrome.keyboard.press('ArrowUp')
  await expect(picker.getByRole('button', { name: 'keyboard-renamed', exact: true })).toBeFocused()
  await chrome.keyboard.press('End')
  await expect(picker.getByRole('button', { name: 'new session', exact: true })).toBeFocused()
  await chrome.keyboard.press('Enter')
  await expect(picker.getByRole('textbox', { name: 'Session name', exact: true })).toBeFocused()
  await chrome.keyboard.press('Escape')
  await picker.getByRole('button', { name: 'keyboard-gamma', exact: true }).click()
  await expect(picker).toHaveCount(0)
  expect((await cli('list-clients'))[0].sessionId).toBe(gamma.id)
  await shortcut('s'); await chrome.keyboard.press('ArrowUp'); await chrome.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  expect((await cli('list-clients'))[0].sessionId).toBe(gamma.id)
  await shortcut('(', ['shift'])
  await expect.poll(async () => (await cli('list-clients'))[0].sessionId).toBe(beta.id)
  await shortcut(')', ['shift'])
  await expect.poll(async () => (await cli('list-clients'))[0].sessionId).toBe(gamma.id)
  await shortcut('w', ['meta', 'shift'], false)
  await expect.poll(async () => (await cli('list-clients')).length).toBe(0)
  expect((await cli('list-sessions')).some((session: { id: string }) => session.id === gamma.id)).toBe(true)
})


test('accessibility preferences and custom window and pane shortcuts reload and survive restart', async () => {
  let config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'accessibility: true\nkeyboard:\n  prefix: Ctrl+2\n  shortcuts:\n    "Cmd+[": previous-window\n    "Cmd+]": next-window\n    Cmd+ShiftRight: move-window-right\n    Cmd+ShiftLeft: move-window-left\n    "Cmd+H": pane-left\n    "Cmd+J": pane-down\n    "Cmd+K": pane-up\n    "Cmd+L": pane-right\n    "Cmd+\\\\": split-right\n    "Cmd+Shift+\\\\": split-down\n')
  await expect.poll(async () => (await cli('state')).keyboard.prefix).toBe('Ctrl+2')
  await expect.poll(async () => (await cli('diagnostics')).accessibilityFeatures).toContain('nativeAPIs')
  await application.close(); await launch()
  expect(await application.evaluate(({ app }) => app.isAccessibilitySupportEnabled())).toBe(true)
  let session = await cli('new-session', { name: 'custom-shortcuts' })
  let second = await cli('new-window', { session: session.id })
  let third = await cli('new-window', { session: session.id })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let key = async (keyCode: string, modifiers: Electron.KeyboardInputEvent['modifiers'] = ['meta']) => {
    await cli('activate-client', { client: client.id })
    await cli('focus-page', { client: client.id })
    await sendNativeKeys(application, [{ keyCode, modifiers }])
  }
  let modifierKey = async (code: 'ShiftLeft' | 'ShiftRight', cancel = false, statusBar = false) => {
    await cli('activate-client', { client: client.id })
    if (statusBar) await chrome.locator(`[data-window-id="${third.id}"] button`).focus()
    else await cli('focus-page', { client: client.id })
    await application.evaluate(({ webContents }, { code, cancel }) => {
      let contents = webContents.getFocusedWebContents()!
      let emit = (input: Record<string, unknown>) => (contents as any).emit('before-input-event', { preventDefault: () => undefined }, input)
      emit({ type: 'keyDown', key: 'Shift', code, meta: true, control: false, alt: false, shift: true })
      if (cancel) emit({ type: 'keyDown', key: 'x', code: 'KeyX', meta: true, control: false, alt: false, shift: true })
      emit({ type: 'keyUp', key: 'Shift', code, meta: true, control: false, alt: false, shift: false })
    }, { code, cancel })
  }
  await cli('select-window', { client: client.id, window: third.id })
  await modifierKey('ShiftRight', false, true)
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([third.id, session.windows[0].id, second.id])
  await modifierKey('ShiftRight', false, true)
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([session.windows[0].id, third.id, second.id])
  await modifierKey('ShiftRight', false, true)
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([session.windows[0].id, second.id, third.id])
  await modifierKey('ShiftRight', true, true)
  expect((await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([session.windows[0].id, second.id, third.id])
  await modifierKey('ShiftLeft', false, true)
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([session.windows[0].id, third.id, second.id])
  await modifierKey('ShiftLeft', false, true)
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([third.id, session.windows[0].id, second.id])
  await modifierKey('ShiftLeft', false, true)
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([session.windows[0].id, second.id, third.id])
  await cli('select-window', { client: client.id, window: session.windows[0].id })
  let historyTabs = [session.windows[0].panes[0].activeTabId, second.panes[0].activeTabId]
  for (let tab of historyTabs) {
    await cli('navigate', { tab, url: `${url}/shortcut-history-one` })
    await cli('navigate', { tab, url: `${url}/shortcut-history-two` })
    await cli('navigate', { tab, url: `${url}/shortcut-history-three` })
    await cli('back', { tab })
    await expect.poll(() => cli('eval', { tab, expression: 'location.pathname' })).toBe('/shortcut-history-two')
  }
  await key(']')
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(second.id)
  await key('[')
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(session.windows[0].id)
  for (let tab of historyTabs) expect(await cli('eval', { tab, expression: 'location.pathname' })).toBe('/shortcut-history-two')
  let firstPane = session.windows[0].panes[0].id
  await key('\\')
  await expect.poll(async () => (await cli('list-panes', { window: session.windows[0].id })).length).toBe(2)
  let rightPane = (await cli('list-panes', { window: session.windows[0].id }))[1].id
  expect((await cli('list-clients'))[0].paneId).toBe(rightPane)
  await key('\\', ['meta', 'shift'])
  await expect.poll(async () => (await cli('list-panes', { window: session.windows[0].id })).length).toBe(3)
  let lowerPane = (await cli('list-panes', { window: session.windows[0].id }))[2].id
  await key('k'); expect((await cli('list-clients'))[0].paneId).toBe(rightPane)
  await key('h'); expect((await cli('list-clients'))[0].paneId).toBe(firstPane)
  await key('l'); expect((await cli('list-clients'))[0].paneId).toBe(rightPane)
  await key('j'); expect((await cli('list-clients'))[0].paneId).toBe(lowerPane)
  await fs.writeFile(config, 'accessibility: broken\nkeyboard: {}\n')
  await expect.poll(async () => Boolean((await cli('state')).configError)).toBe(true)
  expect(await application.evaluate(({ app }) => app.isAccessibilitySupportEnabled())).toBe(true)
  await fs.writeFile(config, 'accessibility: false\nkeyboard: {}\n')
  await expect.poll(async () => (await cli('state')).accessibility).toBe(false)
  await cli('detach-client', { client: client.id })
})


test('permission corner popup leaves the native page interactive and reopens for new requests', async () => {
  let profile = await cli('profile.create', { name: 'permission-popup', background: true })
  let session = await cli('new-session', { name: 'permission-popup', profile: profile.id })
  let tab = session.windows[0].panes[0].tabs[0]
  await cli('navigate', { tab: tab.id, url: `${url}/permission-popup` })
  await cli('wait', { tab: tab.id, selector: '#text' })
  await cli('eval', { tab: tab.id, expression: 'Notification.requestPermission(); true' })
  await expect.poll(async () => (await cli('permission.list')).length).toBe(1)
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.windows().find(window => window.url().endsWith('/renderer/index.html'))!
  let permissionPage = application.context().pages().find(page => page.url().endsWith('#permissions'))!
  let popup = permissionPage.getByRole('dialog', { name: 'Permissions', exact: true })
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('notifications')
  let placement = await application.evaluate(({ BaseWindow }, fixtureUrl) => {
    let window = BaseWindow.getAllWindows().find(window => window.isFocused())!
    let views = window.contentView.children as Electron.WebContentsView[]
    let popup = views.find(view => view.webContents.getURL().endsWith('#permissions'))!
    return { popup: popup.getBounds(), width: window.getContentBounds().width, pageAttached: views.some(view => view.webContents.getURL() === fixtureUrl) }
  }, `${url}/permission-popup`)
  expect(placement.pageAttached).toBe(true)
  expect(placement.popup.width).toBe(340)
  expect(placement.popup.x + placement.popup.width).toBe(placement.width - 12)
  expect(placement.popup.y).toBe(68)
  await permissionPage.screenshot({ path: path.join(root, 'artifacts/permission-popup.png') })
  let website = application.context().pages().find(page => page.url() === `${url}/permission-popup`)!
  await website.locator('#text').click()
  await website.locator('#text').fill('Keep browsing')
  await website.locator('#inc').click()
  await expect(website.locator('#count')).toHaveText('1')
  await expect(popup).toBeVisible()
  await popup.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(popup).toBeHidden()
  await chrome.getByRole('button', { name: 'Activity', exact: true }).click()
  let activity = chrome.getByRole('dialog', { name: 'Activity', exact: true })
  await activity.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect.poll(async () => (await cli('permission.list')).length).toBe(0)
  await activity.getByRole('button', { name: 'Close', exact: true }).click()
  await cli('focus-page', { client: client.id })
  await cli('eval', { tab: tab.id, expression: 'navigator.geolocation.getCurrentPosition(()=>{},()=>{}); true' })
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('geolocation')
  expect(await application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}/permission-popup`)
  await expect(website.locator('#text')).toHaveValue('Keep browsing')
  await popup.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(popup).toBeHidden()
  await expect.poll(async () => (await cli('permission.list')).length).toBe(0)
  await cli('detach-client', { client: client.id })
})

test('address suggestions complete URLs and keep history scoped to the pane profile', async () => {
  let session = await cli('new-session', { name: 'History suggestions' })
  let pane = session.windows[0].panes[0]
  let client = await cli('attach-session', { session: session.id })
  await cli('activate-client', { client: client.id })
  await cli('navigate', { tab: pane.activeTabId, url: `${url}/history-suggestion` })
  let chrome = application.context().pages().find(page => page.url().endsWith('index.html'))!
  let created = await cli('split-window', { pane: pane.id, client: client.id })
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await expect(address).toBeFocused()
  await expect(chrome.getByRole('listbox', { name: 'Address suggestions' })).toHaveCount(0)
  await address.fill('127')
  await expect(address).toHaveValue(url.replace(/^http:\/\//, '') + '/history-suggestion')
  await expect.poll(() => address.evaluate(input => ({ start: (input as HTMLInputElement).selectionStart, end: (input as HTMLInputElement).selectionEnd }))).toEqual({ start: 3, end: url.replace(/^http:\/\//, '').length + '/history-suggestion'.length })
  await address.press('Backspace')
  await expect(address).toHaveValue('127')
  await address.fill('history-suggestion')
  await expect(chrome.getByRole('option').filter({ hasText: `${url}/history-suggestion` })).toBeVisible()
  await cli('focus-page', { client: client.id })
  await application.evaluate(({ webContents }) => {
    let page = webContents.getFocusedWebContents()!
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  })
  await expect(address).toHaveCount(0)
  await chrome.locator(`[data-pane-id="${created.id}"]`).getByRole('button', { name: 'Address', exact: true }).click()
  await expect(address).toHaveValue('')
  await expect(chrome.getByRole('listbox', { name: 'Address suggestions' })).toHaveCount(0)
  await address.fill('history-suggestion')
  await expect(chrome.getByRole('option').filter({ hasText: `${url}/history-suggestion` })).toHaveCount(1)
  await address.press('ArrowDown')
  await address.press('Enter')
  await expect(address).toHaveCount(0)
  await expect.poll(async () => (await cli('tab.list', { pane: created.id }))[0].url).toBe(`${url}/history-suggestion`)
  await expect.poll(async () => {
    let saved = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'))
    return saved.profiles.find((profile: { id: string }) => profile.id === pane.profileId)?.history?.some((entry: { url: string }) => entry.url === `${url}/history-suggestion`) ?? false
  }).toBe(true)
  let isolated = await cli('split-window', { pane: created.id, profile: 'bot', client: client.id })
  await expect(address).toBeFocused()
  await address.fill('history-suggestion')
  await expect(chrome.getByRole('option').filter({ hasText: `${url}/history-suggestion` })).toHaveCount(0)
  await address.fill(`${url}/typed-history-url`)
  await address.press('Enter')
  await expect.poll(async () => (await cli('tab.list', { pane: isolated.id }))[0].url).toBe(`${url}/typed-history-url`)
  await cli('detach-client', { client: client.id })
})

test('status window list uses available room and hides its native scrollbar', async () => {
  let session = await cli('new-session', { name: 'status-window-list' })
  let client = await cli('attach-session', { session: session.id })
  for (let index = 1; index <= 3; index++) await cli('new-window', { session: session.id, client: client.id, name: `descriptive-window-${index}` })
  let chrome = application.context().pages().filter(page => page.url().endsWith('index.html')).at(-1)!
  let status = chrome.getByRole('contentinfo', { name: 'Browser status' })
  let list = status.locator('[data-window-list]')
  await expect(status.getByRole('button', { name: '4:descriptive-window-3*', exact: true })).toBeVisible()
  let roomy = await list.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
  expect(roomy.scrollWidth).toBe(roomy.clientWidth)
  await application.evaluate(({ BaseWindow }, clientId) => {
    let window = BaseWindow.getAllWindows().find(window => window.getTitle().includes(clientId)) ?? BaseWindow.getFocusedWindow()
    window?.setBounds({ x: 90, y: 90, width: 480, height: 700 })
  }, client.id)
  await expect.poll(() => list.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await expect.poll(() => list.evaluate(element => {
    let active = element.querySelector('[data-active="true"]')!.getBoundingClientRect(), bounds = element.getBoundingClientRect()
    return { scrollbar: (element as HTMLElement).offsetHeight - element.clientHeight, activeVisible: active.left >= bounds.left && active.right <= bounds.right }
  })).toEqual({ scrollbar: 0, activeVisible: true })
  await cli('detach-client', { client: client.id })
})

test('status windows can be dragged into a new order without switching the active window', async () => {
  let session = await cli('new-session', { name: 'drag-windows' })
  let first = session.windows[0]
  let second = await cli('new-window', { session: session.id, name: 'second' })
  let third = await cli('new-window', { session: session.id, name: 'third' })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().filter(page => page.url().endsWith('index.html')).at(-1)!
  let tab = (id: string) => chrome.locator(`[data-window-id="${id}"] button[draggable="true"]`)
  let list = chrome.locator('[data-window-list]')
  let order = () => list.locator('[data-window-id]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.windowId))
  await expect.poll(order).toEqual([first.id, second.id, third.id])
  await tab(second.id).dragTo(tab(first.id), { targetPosition: { x: 2, y: 8 } })
  await expect.poll(order).toEqual([second.id, first.id, third.id])
  expect((await cli('list-clients')).find((item: { id: string }) => item.id === client.id).windowId).toBe(first.id)
  let thirdBounds = (await tab(third.id).boundingBox())!
  await tab(second.id).dragTo(tab(third.id), { targetPosition: { x: thirdBounds.width - 2, y: 8 } })
  await expect.poll(order).toEqual([first.id, third.id, second.id])
  expect((await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([first.id, third.id, second.id])
  await tab(third.id).click()
  await expect.poll(async () => (await cli('list-clients')).find((item: { id: string }) => item.id === client.id).windowId).toBe(third.id)
  await cli('detach-client', { client: client.id })
})

test('status tabs show loading and favicon, with optional close control', async () => {
  let session = await cli('new-session', { name: 'status-tab-controls' })
  let client = await cli('attach-session', { session: session.id })
  let chrome = application.context().pages().filter(page => page.url().endsWith('index.html')).at(-1)!
  let tab = chrome.locator(`[data-window-id="${session.windows[0].id}"]`)
  await expect(tab.locator('button[aria-label^="Close "]')).toHaveCount(0)
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search' })
  await address.fill(`${url}/pending-tab`)
  await address.press('Enter')
  await expect.poll(() => pendingPages.size).toBe(1)
  await expect(tab.locator('[data-tab-loading]')).toBeVisible()
  await expect(tab.locator('img')).toHaveCount(0)
  for (let response of pendingPages) {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><html><head><title>Tab icon</title><link rel="icon" href="/tab-icon.svg" type="image/svg+xml"></head><body>Ready</body></html>')
  }
  await expect(tab.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
  await expect(tab.locator('[data-tab-loading]')).toHaveCount(0)
  await fs.writeFile(path.join(directory, 'config.yaml'), 'showTabCloseButtons: true\nkeyboard: {}\n')
  await expect.poll(async () => (await cli('state')).showTabCloseButtons).toBe(true)
  await expect(tab.locator('button[aria-label^="Close "]')).toBeVisible()
  let keep = await cli('new-window', { session: session.id, client: client.id, name: 'keep' })
  await tab.locator('button[aria-label^="Close "]').click()
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).map((window: { id: string }) => window.id)).toEqual([keep.id])
  await cli('detach-client', { client: client.id })
})

test('external web links open new internal windows without replacing the current page or history', async () => {
  let session = await cli('new-session', { name: 'external-web-links' })
  let client = await cli('attach-session', { session: session.id })
  let original = session.windows[0]
  let originalTab = original.panes[0].activeTabId
  await cli('navigate', { tab: originalTab, url: `${url}/original-first` })
  await cli('navigate', { tab: originalTab, url: `${url}/original-second` })
  let before = await cli('list-windows', { session: session.id })
  await application.evaluate(({ app }) => {
    app.emit('open-url', { preventDefault() {} }, 'javascript:alert(1)')
    app.emit('open-url', { preventDefault() {} }, 'file:///etc/passwd')
  })
  expect((await cli('list-windows', { session: session.id })).length).toBe(before.length)
  await application.evaluate(({ app }, link) => {
    app.emit('open-url', { preventDefault() {} }, link)
  }, `${url}/external-link`)
  await expect.poll(async () => (await cli('list-windows', { session: session.id })).length).toBe(before.length + 1)
  let after = await cli('list-windows', { session: session.id })
  let created = after.find((window: { id: string }) => !before.some((existing: { id: string }) => existing.id === window.id))
  expect(created.panes[0].tabs[0].url).toBe(`${url}/external-link`)
  expect((await cli('list-clients')).find((item: { id: string }) => item.id === client.id).windowId).toBe(created.id)
  expect(after.find((window: { id: string }) => window.id === original.id).panes[0].tabs.map((tab: { id: string }) => tab.id)).toEqual([originalTab])
  expect(await cli('eval', { tab: originalTab, expression: 'location.pathname' })).toBe('/original-second')
  await cli('back', { tab: originalTab })
  await expect.poll(() => cli('eval', { tab: originalTab, expression: 'location.pathname' })).toBe('/original-first')
})

test('external HTML files open in new selected internal windows', async () => {
  let file = path.join(directory, 'external file.html')
  await fs.writeFile(file, '<!doctype html><title>External file</title><h1>External file</h1>')
  let client = (await cli('list-clients'))[0] ?? await cli('attach-session', { session: (await cli('list-sessions'))[0].id })
  let before = await cli('list-windows', { session: client.sessionId })
  await application.evaluate(({ app }, filePath) => {
    app.emit('open-file', { preventDefault() {} }, filePath)
  }, file)
  await expect.poll(async () => (await cli('list-windows', { session: client.sessionId })).length).toBe(before.length + 1)
  let created = (await cli('list-windows', { session: client.sessionId })).find((window: { id: string }) => !before.some((existing: { id: string }) => existing.id === window.id))
  expect(created.panes[0].tabs[0].url).toBe(pathToFileURL(file).href)
  expect((await cli('list-clients')).find((item: { id: string }) => item.id === client.id).windowId).toBe(created.id)
})
