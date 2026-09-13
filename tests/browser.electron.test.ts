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
import { observeNativeFocus, recordNativeFocus, sendNativeKeys } from './native-focus'

let exec = promisify(execFile)
let root = process.cwd()
let application: ElectronApplication
let directory: string
let url: string
let server: http.Server
let heldResponses = new Set<http.ServerResponse>()
let heldRequests = 0
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
let fixture = `<!doctype html><html><head><title>bmux fixture</title><style>body{margin:0;font:20px sans-serif;background:#e8eef8}header{padding:30px;background:#173353;color:white}section{height:2500px;padding:30px}footer{height:200px;background:#bd4135;color:white;padding:30px}</style></head><body><header>Fixture top</header><section><input id="text" placeholder="Type here"><button id="inc" onclick="window.count++;document.querySelector('#count').textContent=window.count">Increment</button><span id="count">0</span><a id="popup" href="/popup" target="_blank">Popup</a><a href="/download">Download</a></section><footer id="bottom">BOTTOM OF FULL PAGE</footer><script>window.count=0;window.identity=Math.random();window.ticks=0;setInterval(()=>window.ticks++,100);</script></body></html>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-electron-'))
  server = http.createServer((request, response) => {
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
  await application?.close().catch(() => undefined)
  await new Promise<void>(resolve => server?.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
})

test('profiles, clients, handoff, hidden automation, and restart', async () => {
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

  await cli('eval', { tab: botTab.id, expression: `window.open(${JSON.stringify(`${url}/popup`)}, '_blank'); true` })
  await expect.poll(async () => (await cli('tab.list', { pane: botPane.id })).length).toBe(2)
  let popup = (await cli('tab.list', { pane: botPane.id })).find((tab: { id: string }) => tab.id !== botTab.id)
  await cli('wait', { tab: popup.id, selector: '#text' })
  expect(await cli('eval', { tab: popup.id, expression: '({profile:localStorage.getItem("profile"),opener:!!window.opener})' })).toEqual({ profile: 'bot', opener: true })
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
  expect((await cli('list-sessions'))[0].windows).toHaveLength(2)
  await cli('wait', { tab: mainTab.id, selector: '#text' })
  await cli('wait', { tab: botTab.id, selector: '#text' })
  expect(await cli('eval', { tab: mainTab.id, expression: 'localStorage.getItem("profile")' })).toBe('personal')
  expect(await cli('eval', { tab: botTab.id, expression: 'localStorage.getItem("profile")' })).toBe('bot')
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
    await cli('click', { tab: upper.activeTabId, selector: '#popup' })
    await expect.poll(async () => (await cli('tab.list', { pane: upper.id })).length).toBe(2)
    let popup = (await cli('tab.list', { pane: upper.id })).find((tab: { active: boolean }) => tab.active)
    expect(popup.url).toBe(`${url}/popup`)
    await cli('back', { tab: popup.id })
    await expect.poll(async () => (await cli('tab.list', { pane: upper.id })).length).toBe(1)
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
  let source = session.windows[1].panes[0]
  await cli('move-pane', { pane: source.id, window: window.id })
  expect((await cli('list-panes', { window: window.id })).some((pane: { id: string }) => pane.id === source.id)).toBe(true)

  let client = await cli('attach-session', { session: session.id })
  await cli('select-window', { client: client.id, window: session.windows[1].id })
  await application.close()
  application = await electron.launch({ args: [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await application.evaluate(async ({ app }) => { await app.whenReady() })
  await expect.poll(async () => (await cli('list-clients')).length).toBe(1)
  expect((await cli('list-clients'))[0].windowId).toBe(session.windows[1].id)
  await cli('detach-client', { client: client.id })
  await cli('diagnostics')
  await new Promise(resolve => setTimeout(resolve, 2000))
  let metrics = await cli('diagnostics')
  let totalWorkingSetKB = metrics.processes.reduce((sum: number, process: { memory: { workingSetSize: number } }) => sum + process.memory.workingSetSize, 0)
  await fs.writeFile(path.join(root, 'artifacts/resource-sample.json'), JSON.stringify({ liveTabs: metrics.tabs, clients: metrics.visibleClients, workingSetMB: Math.round(totalWorkingSetKB / 1024), processes: metrics.processes }, null, 2))
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
  await expect(chrome.getByText('Profile: Imported work', { exact: true })).toBeVisible()
  await expect(chrome.getByText('Projects', { exact: true })).toBeVisible()
  await expect(chrome.getByRole('button', { name: 'Unsupported bookmarklet' })).toBeDisabled()
  await chrome.screenshot({ path: path.join(root, 'artifacts/bookmarks.png') })
  await chrome.getByRole('button', { name: 'Imported fixture', exact: true }).click()
  let pane = session.windows[0].panes[0]
  let tab = (await cli('tab.list', { pane: pane.id })).find((tab: { url: string }) => tab.url === `${url}/imported`)
  expect(tab.profileId).toBe(profileId)
  expect(tab.active).toBe(true)
  await cli('wait', { tab: tab.id, selector: '#text' })
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
  await expect(chrome.getByRole('button', { name: '1:from prompt*', exact: true })).toBeVisible()
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  await command.fill('open not-a-protocol://example')
  await command.press('Enter')
  await expect(chrome.getByRole('status')).toContainText('Only http')
  await command.press('Escape')
  await chrome.getByRole('button', { name: '0:127.0.0.1', exact: true }).click()
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
  await expect(status.getByRole('button', { name: '0:127.0.0.1*', exact: true })).toBeVisible()
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
  await address.fill(`${url}/unsaved`)
  await status.getByRole('button', { name: '1:other', exact: true }).click()
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(other.id)
  await expect(chrome.getByRole('textbox', { name: 'URL or search', exact: true })).toHaveCount(0)
  await status.getByRole('button', { name: '0:127.0.0.1', exact: true }).click()
  await expect(secondPane.getByRole('button', { name: 'Address', exact: true })).toHaveText(`${url}/edited-second-pane`)
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
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
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
  await shortcut(',')
  let rename = chrome.getByRole('textbox', { name: 'Rename window', exact: true })
  await expect(rename).toHaveValue('temporary')
  await rename.fill('cancelled'); await rename.press('Escape')
  expect((await cli('list-windows', { session: alpha.id }))[1].name).toBe('temporary')
  await shortcut(',')
  await rename.fill('research "notes"'); await rename.press('Enter')
  await expect(chrome.getByRole('button', { name: '1:research "notes"*', exact: true })).toBeVisible()
  await cli('new-window', { session: alpha.id, client: client.id, name: 'confirmation' })
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
  // Closing the last internal window leaves a usable empty window in the session.
  await shortcut('&', ['shift'])
  await expect.poll(async () => (await cli('list-windows', { session: alpha.id }))[0].id).not.toBe(first.id)
  expect((await cli('list-windows', { session: alpha.id }))[0].panes[0].profileId).toBe(first.panes[0].profileId)
  await shortcut('$', ['shift'])
  let sessionName = chrome.getByRole('textbox', { name: 'Rename session', exact: true })
  await sessionName.fill('keyboard-renamed'); await sessionName.press('Enter')
  await expect(chrome.getByRole('button', { name: 'Sessions', exact: true })).toHaveText('[keyboard-renamed]')
  await shortcut('s')
  let picker = chrome.getByRole('dialog', { name: 'Sessions', exact: true })
  await expect(picker.getByRole('button', { name: 'keyboard-renamed', exact: true })).toBeFocused()
  await chrome.keyboard.press('ArrowDown')
  await expect(picker.getByRole('button', { name: 'keyboard-beta', exact: true })).toBeFocused()
  await chrome.keyboard.press('ArrowUp')
  await expect(picker.getByRole('button', { name: 'keyboard-renamed', exact: true })).toBeFocused()
  await chrome.keyboard.press('End')
  await expect(picker.getByRole('button', { name: 'keyboard-gamma', exact: true })).toBeFocused()
  await chrome.keyboard.press('Enter')
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
  await fs.writeFile(config, 'accessibility: true\nkeyboard:\n  prefix: Ctrl+2\n  shortcuts:\n    "Cmd+[": previous-window\n    "Cmd+]": next-window\n    "Cmd+H": pane-left\n    "Cmd+J": pane-down\n    "Cmd+K": pane-up\n    "Cmd+L": pane-right\n    "Cmd+\\\\": split-right\n    "Cmd+Shift+\\\\": split-down\n')
  await expect.poll(async () => (await cli('state')).keyboard.prefix).toBe('Ctrl+2')
  await expect.poll(async () => (await cli('diagnostics')).accessibilityFeatures).toContain('nativeAPIs')
  await application.close(); await launch()
  expect(await application.evaluate(({ app }) => app.isAccessibilitySupportEnabled())).toBe(true)
  let session = await cli('new-session', { name: 'custom-shortcuts' })
  let second = await cli('new-window', { session: session.id })
  let client = await cli('attach-session', { session: session.id })
  let key = async (keyCode: string, modifiers: Electron.KeyboardInputEvent['modifiers'] = ['meta']) => {
    await cli('activate-client', { client: client.id })
    await cli('focus-page', { client: client.id })
    await sendNativeKeys(application, [{ keyCode, modifiers }])
  }
  await key(']')
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(second.id)
  await key('[')
  await expect.poll(async () => (await cli('list-clients'))[0].windowId).toBe(session.windows[0].id)
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
