import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
  let result = await exec(process.execPath, [path.join(root, 'bin/brmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BROWMUX_DATA_DIR: directory }, timeout: 90000, maxBuffer: 16 * 1024 * 1024 }).catch(error => { throw new Error(`${method}: ${error.stdout || error.stderr || error.message}`) })
  let response = JSON.parse(result.stdout)
  if (!response.ok) throw new Error(response.error)
  return response.result
}
let launch = async () => {
  application = await electron.launch({ args: [root, '--background'], env: { ...process.env, BROWMUX_DATA_DIR: directory, BROWMUX_BACKGROUND: '1' } })
  application.process().stderr?.on('data', chunk => console.log('ELECTRON', String(chunk).slice(0, 1500)))
  await application.evaluate(async ({ app }) => { await app.whenReady() })
  await expect.poll(async () => {
    try { return (await cli('status')).model.version } catch (error) { console.log(String(error)); return 0 }
  }, { timeout: 20000 }).toBe(1)
}
let frontmost = async () => (await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to get unix id of first application process whose frontmost is true'])).stdout.trim()
let fixture = `<!doctype html><html><head><title>Browmux fixture</title><style>body{margin:0;font:20px sans-serif;background:#e8eef8}header{padding:30px;background:#173353;color:white}section{height:2500px;padding:30px}footer{height:200px;background:#bd4135;color:white;padding:30px}</style></head><body><header>Fixture top</header><section><input id="text" placeholder="Type here"><button id="inc" onclick="window.count++;document.querySelector('#count').textContent=window.count">Increment</button><span id="count">0</span><a id="popup" href="/popup" target="_blank">Popup</a><a href="/download">Download</a></section><footer id="bottom">BOTTOM OF FULL PAGE</footer><script>window.count=0;window.identity=Math.random();window.ticks=0;setInterval(()=>window.ticks++,100);</script></body></html>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'browmux-electron-'))
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
  if (info.status !== info.expectedStatus) console.log('FOCUS_DIAGNOSTICS', { frontmostPid: await frontmost(), expectedPid: application.process().pid, windows: await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(window => ({ id: window.id, focused: window.isFocused(), visible: window.isVisible() }))) })
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

  await cli('select-window', { client: clientB.id, window: mainWindow.id })
  await cli('activate-client', { client: clientA.id })
  await cli('type', { tab: mainTab.id, selector: '#text', text: 'Retain this form' })
  await cli('click', { tab: mainTab.id, selector: '#inc' })
  let identity = await cli('eval', { tab: mainTab.id, expression: 'window.identity' })
  let targetBefore = await cli('cdp', { tab: mainTab.id, method: 'Target.getTargetInfo' })
  for (let client of [clientB, clientA, clientB]) {
    await cli('activate-client', { client: client.id })
    await expect.poll(async () => (await cli('state')).focusedClientId).toBe(client.id).catch(async error => { console.log(JSON.stringify(await cli('diagnostics'))); console.log('FRONTMOST', await frontmost()); throw error })
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
  await expect.poll(async () => (await statusBar.boundingBox())!.y).toBeLessThan((await chrome.locator('main').boundingBox())!.y)
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
  application = await electron.launch({ args: [root], env: { ...process.env, BROWMUX_DATA_DIR: directory, BROWMUX_BACKGROUND: '0' } })
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
  let chrome = application.windows().find(window => window.url().includes('/renderer/index.html'))!
  await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  await chrome.getByRole('textbox', { name: 'Command', exact: true }).fill('bookmarks')
  await chrome.getByRole('textbox', { name: 'Command', exact: true }).press('Enter')
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
  let command = chrome.getByRole('textbox', { name: 'Command', exact: true })
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
  await chrome.getByRole('button', { name: '0:main', exact: true }).click()
  await cli('client.overlay', { client: client.id, visible: true })
  await chrome.waitForTimeout(200)
  await chrome.screenshot({ path: path.join(root, 'artifacts/minimal-ui.png') })
  await cli('client.overlay', { client: client.id, visible: false })
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
    await expect.poll(() => application.evaluate(({ webContents }) => Boolean(webContents.getFocusedWebContents()))).toBe(true)
    for (let event of events) {
      await application.evaluate(({ webContents }, event) => {
        let contents = webContents.getFocusedWebContents()!
        contents.sendInputEvent({ type: 'keyDown', ...event })
        contents.sendInputEvent({ type: 'keyUp', ...event })
      }, event)
      await chrome.waitForTimeout(30)
    }
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
  await expect.poll(async () => (await statusBar.boundingBox())!.y).toBeLessThan((await chrome.locator('main').boundingBox())!.y)
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
  await cli('new-window', { session: alpha.id, client: client.id, name: 'temporary' })
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let shortcut = async (keyCode: string, modifiers: Electron.KeyboardInputEvent['modifiers'] = [], prefix = true) => {
    await cli('activate-client', { client: client.id })
    await cli('focus-page', { client: client.id })
    let events: Omit<Electron.KeyboardInputEvent, 'type'>[] = [{ keyCode, modifiers }]
    if (prefix) events.unshift({ keyCode: 'b', modifiers: ['control'] })
    for (let event of events) {
      await application.evaluate(({ webContents }, event) => {
        let contents = webContents.getFocusedWebContents()!
        contents.sendInputEvent({ type: 'keyDown', ...event })
        contents.sendInputEvent({ type: 'keyUp', ...event })
      }, event)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  await shortcut(',')
  let rename = chrome.getByRole('textbox', { name: 'Rename window', exact: true })
  await expect(rename).toHaveValue('temporary')
  await rename.fill('cancelled'); await rename.press('Escape')
  expect((await cli('list-windows', { session: alpha.id }))[1].name).toBe('temporary')
  await shortcut(',')
  await rename.fill('research "notes"'); await rename.press('Enter')
  await expect(chrome.getByRole('button', { name: '1:research "notes"*', exact: true })).toBeVisible()
  await shortcut('&', ['shift'])
  let confirm = chrome.getByRole('textbox', { name: 'Close window confirmation' })
  await expect(confirm).toBeFocused()
  await confirm.press('n')
  expect((await cli('list-windows', { session: alpha.id })).length).toBe(2)
  await shortcut('&', ['shift'])
  await confirm.press('y')
  await expect.poll(async () => (await cli('list-windows', { session: alpha.id })).map((window: { id: string }) => window.id)).toEqual([first.id])
  expect(await cli('eval', { tab: first.panes[0].activeTabId, expression: 'document.title' })).toBe('Browmux fixture')
  // Closing the last internal window leaves a usable empty window in the session.
  await shortcut('&', ['shift']); await confirm.press('y')
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
    await application.evaluate(({ webContents }, { keyCode, modifiers }) => {
      let contents = webContents.getFocusedWebContents()!
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { keyCode, modifiers })
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
