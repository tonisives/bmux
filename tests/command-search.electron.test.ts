import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import { observeNativeFocus, recordNativeFocus } from './native-focus'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { stringify } from 'yaml'
import { Server as ProxyServer } from 'proxy-chain'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let directory: string, application: ElectronApplication, chrome: Page, page: Page, url: string, server: http.Server, proxy: ProxyServer, proxyRequests = 0
let identityRequests = new Map<string, http.IncomingHttpHeaders>()
let holdProxyTest = false, pendingProxyTest: (() => void) | undefined
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let prompt = () => chrome.getByRole('combobox', { name: 'Command', exact: true })
let open = async () => { await activate(); await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click(); await expect(prompt()).toBeFocused() }
let openProfilePanel = async (profile: string) => test.step(`Open ${profile} profile details`, async () => {
  await activate()
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  // A command can finish before React accepts the restored window/pane selection.
  await expect(chrome.locator(`[data-pane-id="${client.paneId}"]`)).toHaveAttribute('data-focused-pane', 'true')
  let panel = chrome.getByRole('dialog', { name: 'Profile', exact: true })
  let details = panel.getByRole('region', { name: `${profile} profile details`, exact: true })
  if (!await details.isVisible()) {
    if (await panel.isVisible()) {
      await panel.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(panel).toHaveCount(0)
    }
    let pane = chrome.locator(`[data-pane-id="${client.paneId}"]`)
    // A blank pane can finish initializing between locating and clicking the
    // button. Match either label and follow the UI that the click actually opens.
    let button = pane.getByRole('button', { name: `Profile: ${profile}`, exact: true })
      .or(pane.getByRole('button', { name: `Choose pane profile: ${profile}`, exact: true }))
    await button.click()
    let picker = pane.getByRole('combobox', { name: 'Pane profile', exact: true })
    await expect(details.or(picker).first()).toBeVisible()
    if (!await details.isVisible()) {
      // The picker autofocuses its select after mounting. Let that focus change
      // finish before sending the next mouse gesture to a different control.
      await expect(picker).toBeFocused()
      await pane.getByRole('button', { name: 'Profile settings', exact: true }).click()
    }
  }
  await expect(details).toBeVisible()
  return panel
})
let nativeVisible = () => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some(view => 'webContents' in view && (view as any).webContents.getURL() === url && view.getBounds().height > 300)), url)
let closeShortcut = async (key: string) => {
  await activate()
  await rpc('focus-page', { client: (await state()).clientId })
  await application.evaluate(async ({ webContents }, key) => {
    for (let event of [{ keyCode: 'x', modifiers: ['control'] }, { keyCode: key, modifiers: key === 'Q' ? ['shift'] : [] }]) {
      let contents = webContents.getFocusedWebContents()!
      contents.sendInputEvent({ type: 'keyDown', ...event } as Electron.KeyboardInputEvent)
      contents.sendInputEvent({ type: 'keyUp', ...event } as Electron.KeyboardInputEvent)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }, key)
}

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-command-search-'))
  await fs.mkdir(path.join(directory, 'plugins/fixture'), { recursive: true })
  await fs.writeFile(path.join(directory, 'plugins/fixture/plugin.yaml'), stringify({ schema_version: 1, id: 'fixture', name: 'Fixture plugin', version: '1', actions: [{ id: 'greet', title: 'Fixture greeting', command: ['node', '-e', 'process.exit(0)'], capabilities: [] }] }))
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: { prefix: 'Ctrl+X', shortcuts: { 'Cmd+Alt+D': 'browser-tools', 'Cmd+Alt+P': 'plugin:fixture/greet' }, prefixBindings: { q: 'close-pane', Q: 'close-window' } }, browser: { autoUpdateFilters: false }, plugins: { fixture: { enabled: true }, 'bmux.nordvpn': { enabled: true } } }))
  server = http.createServer((request, response) => {
    if (request.url?.includes('/safe-area-trusted')) {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "require-trusted-types-for 'script'; trusted-types 'none'" })
      response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#888"><title>Trusted mobile app fixture</title><style>
        html,body{margin:0;background:#eee;color:#111}body{padding:0}header,footer{position:fixed;left:0;width:100%;height:48px;background:white;transition:top .225s,bottom .225s}header{top:0;z-index:2}header input{width:90%;height:32px;background:#ddd}#filters{position:fixed;top:48px;left:0;width:100%;height:48px;background:white;z-index:2;transition:all .225s}footer{bottom:0;z-index:2}main{padding-top:96px;height:2200px;background:white}#sticky{position:sticky;top:0;margin-top:180px;height:40px;background:white}#nested{position:fixed;top:0;left:0;height:10px;width:20px}
      </style><header><input aria-label="Search"><span id="nested">Logo</span></header><div id="filters">Filters</div><main><div id="sticky">Sticky section</div><p>Scrolling content</p></main><footer>Navigation</footer>`)
      return
    }
    if (request.url?.includes('/safe-area')) {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1${request.url.includes('cover') ? ', viewport-fit=cover' : ''}"><meta name="theme-color" content="#234567"><title>Safe area fixture</title><style>html,body{margin:0;background:#234567;color:white}main{height:1800px;background:linear-gradient(#234567,#abcdef)}#end{height:20px}${request.url.includes('cover') && !request.url.includes('fixed') ? 'body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}' : ''}</style><main>First line below the camera</main><div id="end">Last line above home indicator</div>`)
      return
    }
    let deviceIndex = request.url?.indexOf('/device-') ?? -1
    if (request.url && deviceIndex >= 0) {
      identityRequests.set(request.url.slice(deviceIndex), request.headers)
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Device fixture</title><style>html{background:#234567}</style><h1>Device fixture</h1><a href="/device-popup" target="_blank">Open device popup</a>')
      return
    }
    if (request.url === '/ip') {
      let respond = () => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ip: '203.0.113.9', city: 'Amsterdam', region: 'North Holland', country: 'Netherlands' })) }
      if (holdProxyTest) pendingProxyTest = respond
      else respond()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Command search fixture</title><style>body{background:#e8eef8;color:#173353;font:24px sans-serif;padding:32px}</style><h1>Command search fixture</h1><p>A visible native page behind the command finder.</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}/fixture`
  proxy = new ProxyServer({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => { proxyRequests++; return { requestAuthentication: request.username !== 'fixture-user' || request.password !== 'fixture-password' } } })
  proxy.on('requestFailed', () => undefined); await proxy.listen()
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `http://127.0.0.1:${(server.address() as any).port}/ip` } })
  await observeNativeFocus(application)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await activate(); await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true }); await address.fill(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
  page = application.context().pages().find(page => page.url() === url)!
  await expect(page.locator('h1')).toBeVisible()
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
})
test.beforeEach(async () => {
  if (process.env.BMUX_TEST_TRACE === '1') await application.context().tracing.start({ screenshots: true, snapshots: true })
  await chrome.keyboard.press('Escape'); await chrome.keyboard.press('Escape')
  let current = await state(); await rpc('select-window', { client: current.clientId, window: current.model.sessions[0].windows[0].id }); await activate()
})
test.afterEach(async ({}, info) => {
  await recordNativeFocus(application, info)
  if (process.env.BMUX_TEST_TRACE !== '1') return
  let trace = info.status === info.expectedStatus ? undefined : info.outputPath('trace.zip')
  await application.context().tracing.stop({ path: trace })
  if (trace) await info.attach('trace', { path: trace, contentType: 'application/zip' })
})
test.afterAll(async () => { await closeTestApplication(application); await proxy?.close(true); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })

test('command finder accepts fuzzy selection and restores the native page', async () => {
  await expect.poll(nativeVisible).toBe(true)
  await open()
  await expect(chrome.getByRole('listbox', { name: 'Commands', exact: true })).toBeVisible()
  await prompt().fill('brtls')
  let selected = chrome.getByRole('option', { selected: true })
  await expect(selected).toContainText('browser-tools'); await expect(selected).toContainText('Cmd+Alt+D')
  await chrome.screenshot({ path: path.resolve('artifacts/command-finder.png') })
  await prompt().press('Enter')
  await expect(chrome.getByRole('dialog', { name: 'Browser tools', exact: true })).toBeVisible()
  await chrome.getByRole('button', { name: 'Close', exact: true }).click(); await activate()
  await expect.poll(nativeVisible).toBe(true)
  await expect(page.locator('h1')).toHaveText('Command search fixture')
  let config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'statusBar: bottom\n' + await fs.readFile(config, 'utf8'))
  await expect.poll(async () => (await state()).statusBar).toBe('bottom')
  await open(); await prompt().fill('brtls')
  let finder = chrome.getByRole('region', { name: 'Command finder', exact: true }), status = chrome.getByRole('contentinfo', { name: 'Browser status' })
  await expect.poll(async () => { let bounds = (await finder.boundingBox())!; return bounds.y + bounds.height - (await status.boundingBox())!.y }).toBeLessThanOrEqual(1)
  await chrome.screenshot({ path: path.resolve('artifacts/command-finder-bottom.png') })
  await prompt().press('Escape'); await expect.poll(nativeVisible).toBe(true)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
})

test('primary platform shortcut opens find in the current page', async () => {
  await activate(); await rpc('focus-page', { client: (await state()).clientId })
  await application.evaluate(({ webContents }) => {
    let contents = webContents.getFocusedWebContents()!
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'f', modifiers: ['meta'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'f', modifiers: ['meta'] })
  })
  let find = chrome.getByRole('textbox', { name: 'Find in page', exact: true })
  await expect(find).toBeFocused()
  await find.fill('visible native page')
  await expect(chrome.getByRole('status', { name: 'Find results', exact: true })).toHaveText('1 / 1', { timeout: 1000 })
  await find.press('Escape')
  await expect(find).toHaveCount(0)
  await expect.poll(nativeVisible).toBe(true)
})

test('command arguments, completion, history, and keyboard result selection work together', async () => {
  await open(); await prompt().fill('new-window -n "two words"'); await prompt().press('Enter')
  await expect(chrome.getByRole('button', { name: '2:two words*', exact: true })).toBeVisible()
  await open(); await prompt().press('Control+r'); await expect(prompt()).toHaveValue('new-window -n "two words"')
  await prompt().press('Control+s'); await expect(prompt()).toHaveValue('')
  await prompt().fill('movep -t unfinished'); await prompt().press('Escape')
  await open(); await prompt().press('Control+r'); await expect(prompt()).toHaveValue('movep -t unfinished')
  await prompt().fill('new-session'); await prompt().press('Tab'); await expect(prompt()).toHaveValue('new-session')
  await prompt().press('Control+s'); await expect(prompt()).toHaveValue('new-session')
  await prompt().press('Control+r'); await prompt().press('Control+s'); await expect(prompt()).toHaveValue('new-session')
  expect((await state()).model.sessions).toHaveLength(1)
  await prompt().fill('dark')
  let first = await prompt().getAttribute('aria-activedescendant')
  await prompt().press('Control+n'); expect(await prompt().getAttribute('aria-activedescendant')).not.toBe(first)
  await prompt().press('Control+p'); await expect(prompt()).toHaveAttribute('aria-activedescendant', first!)
  await prompt().press('ArrowDown'); await prompt().press('Tab'); await expect(prompt()).toHaveValue('dark on')
  await prompt().fill('dark mode'); await expect(chrome.getByRole('option', { selected: true })).toContainText('Toggle dark mode')
  await prompt().fill('brtls'); await prompt().press('Shift+Enter'); await expect(chrome.getByRole('status')).toContainText('Unknown command')
  await prompt().fill('zzzzunmatched'); await expect(chrome.getByText('No matching commands. Enter runs the text you typed.', { exact: true })).toBeVisible()
  await prompt().press('Enter'); await expect(chrome.getByRole('status')).toContainText('Unknown command')
  await prompt().press('Escape'); await expect(prompt()).toHaveCount(0)
})

test('movew opens the index prompt and reorders windows from the finder and CLI', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let originalWindowId = client.windowId
  let source = await rpc('new-window', { session: client.sessionId, url, name: 'movew fixture' })
  let windows = async () => (await state()).model.sessions.find((item: { id: string }) => item.id === client.sessionId).windows
  let originalOrder = (await windows()).map((window: { id: string }) => window.id)
  try {
    await rpc('select-window', { client: client.id, window: source.id })
    await expect(chrome.locator(`[data-pane-id="${source.panes[0].id}"]`)).toHaveAttribute('data-focused-pane', 'true')
    await open(); await prompt().fill('movew')
    await expect(chrome.getByRole('option', { selected: true })).toContainText('movew -t INDEX')
    await prompt().press('Enter')
    let position = chrome.getByRole('textbox', { name: 'Move window to index', exact: true })
    await expect(position).toBeFocused()
    await position.fill('1'); await position.press('Enter')
    await expect(position).toHaveCount(0)
    await expect.poll(async () => (await windows()).map((window: { id: string }) => window.id)).toEqual([source.id, ...originalOrder.filter((id: string) => id !== source.id)])

    await open(); await prompt().fill('movew -t 2'); await prompt().press('Enter')
    await expect(prompt()).toHaveCount(0)
    await expect.poll(async () => (await windows())[1].id).toBe(source.id)
    for (let [command, index] of [['movew', '1'], ['move-window', '2']]) {
      let { stdout } = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', command, '-c', client.id, '-t', index], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20_000 })
      expect(JSON.parse(stdout)).toMatchObject({ ok: true, result: { id: source.id } })
      await expect.poll(async () => (await windows())[Number(index) - 1].id).toBe(source.id)
    }
    expect((await state()).model.clients.find((item: { id: string }) => item.id === client.id)).toMatchObject({ sessionId: client.sessionId, windowId: source.id, paneId: source.panes[0].id })
    await expect.poll(nativeVisible).toBe(true)
  } finally {
    await chrome.keyboard.press('Escape')
    await rpc('select-window', { client: client.id, window: originalWindowId })
    await rpc('kill-window', { window: source.id, confirm: true })
  }
})

test('enabled plugin actions appear in fuzzy command results and execute', async () => {
  await open(); await prompt().fill('fixture greeting')
  await expect(chrome.getByRole('option', { selected: true })).toContainText('plugin run fixture/greet')
  await expect(chrome.getByRole('option', { selected: true })).toContainText('Cmd+Alt+P')
  await prompt().press('Enter')
  await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.pluginId === 'fixture')?.status).toBe('completed')
})

test('pane move command popup completes sessions and windows before moving the pane', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let originalWindowId = client.windowId
  let source = await rpc('new-window', { session: client.sessionId, url })
  let target = await rpc('new-session', { name: 'bmux-marketing' })
  try {
    await rpc('select-window', { client: client.id, window: source.id })
    await expect(chrome.locator(`[data-pane-id="${source.panes[0].id}"]`)).toHaveAttribute('data-focused-pane', 'true')
    await open(); await prompt().fill('movep -t bmux-mar')
    let targets = chrome.getByRole('listbox', { name: 'Targets', exact: true })
    await expect(targets).toBeVisible()
    let session = targets.getByRole('option').filter({ hasText: 'New window in session' })
    await expect(session).toHaveCount(1); await expect(session).toContainText('bmux-marketing:')
    await expect(targets.getByRole('option').filter({ hasText: 'Join window' })).toHaveCount(1)
    await chrome.screenshot({ path: path.resolve('artifacts/pane-move-targets.png') })
    await session.click()
    await expect(prompt()).toHaveValue('movep -t bmux-marketing:')
    expect((await state()).model.sessions.find((item: { id: string }) => item.id === target.id).windows).toHaveLength(1)
    await prompt().press('Enter'); await expect(prompt()).toHaveCount(0)
    await expect.poll(async () => (await state()).model.clients.find((item: { id: string }) => item.id === client.id).sessionId).toBe(target.id)
    let moved = (await state()).model.sessions.find((item: { id: string }) => item.id === target.id)
    expect(moved.windows).toHaveLength(2)
    expect(moved.windows[0].panes).toHaveLength(1)
    expect(moved.windows[1].panes[0]).toMatchObject({ id: source.panes[0].id, profileId: source.panes[0].profileId })
    await expect.poll(nativeVisible).toBe(true)

    await open(); await prompt().fill('movep -t bmux-marketing:1')
    await expect(targets.getByRole('option')).toHaveCount(1)
    await prompt().press('Control+n'); await prompt().press('Enter')
    await expect(prompt()).toHaveValue('movep -t bmux-marketing:1')
    expect((await state()).model.sessions.find((item: { id: string }) => item.id === target.id).windows).toHaveLength(2)
    await prompt().press('Tab'); await prompt().press('Enter'); await expect(prompt()).toHaveCount(0)
    let joined = (await state()).model.sessions.find((item: { id: string }) => item.id === target.id)
    expect(joined.windows).toHaveLength(1)
    expect(joined.windows[0].panes.map((pane: { id: string }) => pane.id)).toContain(source.panes[0].id)
    await expect.poll(nativeVisible).toBe(true)
  } finally {
    await chrome.keyboard.press('Escape')
    await rpc('switch-client', { client: client.id, session: client.sessionId })
    await rpc('select-window', { client: client.id, window: originalWindowId })
    await rpc('kill-session', { session: target.id, confirm: true })
    if ((await state()).model.sessions.some((session: any) => session.windows.some((window: any) => window.id === source.id))) await rpc('kill-window', { window: source.id, confirm: true })
  }
})

test('pane join commands keep omitted session targets and completions in the current session', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let target = await rpc('new-session', { name: 'join-local' }), destination = target.windows[0]
  await rpc('rename-window', { window: destination.id, name: 'main' })
  let otherWindows = async () => (await state()).model.sessions.filter((session: any) => session.id !== target.id).map((session: any) => ({ id: session.id, windows: session.windows.map((window: any) => ({ id: window.id, panes: window.panes.map((pane: any) => pane.id) })) }))
  let before = await otherWindows()
  try {
    await rpc('switch-client', { client: client.id, session: target.id })
    for (let command of ['joinp -t :1', 'movep -t :main']) {
      let source = await rpc('new-window', { session: target.id, name: 'join source', url })
      await rpc('select-window', { client: client.id, window: source.id })
      await expect(chrome.locator(`[data-pane-id="${source.panes[0].id}"]`)).toHaveAttribute('data-focused-pane', 'true')
      await open(); await prompt().fill(command)
      let targets = chrome.getByRole('listbox', { name: 'Targets', exact: true })
      await expect(targets.getByRole('option')).toHaveCount(1)
      await expect(targets.getByRole('option')).toContainText(':1 main')
      await prompt().press('Enter'); await expect(prompt()).toHaveCount(0)
      await expect.poll(async () => (await state()).model.clients.find((item: { id: string }) => item.id === client.id)).toMatchObject({ sessionId: target.id, windowId: destination.id, paneId: source.panes[0].id })
      let joined = (await state()).model.sessions.find((session: any) => session.id === target.id)
      expect(joined.windows).toHaveLength(1)
      expect(joined.windows[0].panes.map((pane: any) => pane.id)).toContain(source.panes[0].id)
      expect(await otherWindows()).toEqual(before)
      await expect.poll(nativeVisible).toBe(true)
    }
  } finally {
    await chrome.keyboard.press('Escape')
    await rpc('switch-client', { client: client.id, session: client.sessionId })
    await rpc('select-window', { client: client.id, window: client.windowId })
    await rpc('kill-session', { session: target.id, confirm: true })
  }
})

test('pane movement commands preserve live pages through same-window joins, swaps, rotation and breaks', async () => {
  let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)!
  let local = await rpc('new-session', { name: 'movement-local' }), other = await rpc('new-session', { name: 'movement-other' })
  let first = local.windows[0], a = first.panes[0]
  let cli = async (...args: string[]) => {
    let { stdout } = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args, '-c', client.id], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20_000 })
    let result = JSON.parse(stdout); expect(result.ok, stdout).toBe(true); return result.result
  }
  let window = async () => (await state()).model.sessions.find((session: any) => session.id === local.id).windows.find((window: any) => window.id === first.id)
  let ids = (node: any): string[] => !node ? [] : node.kind === 'pane' ? [node.paneId] : [...ids(node.first), ...ids(node.second)]
  try {
    await rpc('switch-client', { client: client.id, session: local.id })
    await rpc('select-window', { client: client.id, window: first.id })
    await rpc('navigate', { pane: a.id, url })
    let b = await rpc('split-window', { client: client.id, pane: a.id, profile: 'bot', url })
    let c = await rpc('split-window', { client: client.id, pane: a.id, url, axis: 'vertical' })
    for (let pane of [a, b, c]) { await rpc('wait', { pane: pane.id, selector: 'h1' }); await rpc('eval', { pane: pane.id, expression: `window.bmuxMovement = ${JSON.stringify(pane.id)}` }) }
    await expect(chrome.locator(`[data-pane-id="${c.id}"]`)).toHaveAttribute('data-focused-pane', 'true')
    await cli('joinp', '-s', b.id, '-t', ':1.0', '-bdh')
    expect(ids((await window()).layout)).toEqual([b.id, a.id, c.id])
    expect((await state()).model.clients.find((item: any) => item.id === client.id)).toMatchObject({ sessionId: local.id, windowId: first.id, paneId: c.id })

    await open(); await prompt().fill('swapp -s :1.0 -t :1.1')
    await expect(chrome.getByRole('listbox', { name: 'Targets', exact: true }).getByRole('option')).toHaveCount(1)
    await prompt().press('Enter'); await expect(prompt()).toHaveCount(0)
    expect(ids((await window()).layout)).toEqual([a.id, b.id, c.id])
    await cli('rotatew', '-U', '-t', ':1')
    expect(ids((await window()).layout)).toEqual([b.id, c.id, a.id])

    await cli('breakp', '-s', ':1.0', '-t', 'movement-other:2', '-n', 'moved pane', '-d')
    let broken = (await state()).model.sessions.find((session: any) => session.id === other.id).windows[1]
    expect(broken).toMatchObject({ name: 'moved pane', automaticName: false, panes: [{ id: b.id, profileId: b.profileId }] })
    expect(ids((await window()).layout)).toEqual([c.id, a.id])
    expect((await state()).model.clients.find((item: any) => item.id === client.id)).toMatchObject({ sessionId: local.id, windowId: first.id })
    await cli('join-pane', '-s', b.id, '-t', ':1.0', '-v', '-d')
    expect((await state()).model.sessions.find((session: any) => session.id === other.id).windows).toHaveLength(1)
    let beforeFloat = ids((await window()).layout)
    await cli('breakp', '-s', b.id, '-W', '-d')
    expect((await window()).floating.map((item: any) => item.paneId)).toContain(b.id)
    await cli('joinp', '-s', b.id, '-t', b.id, '-d')
    expect(ids((await window()).layout)).toEqual(beforeFloat)
    expect((await window()).floating).toHaveLength(0)
    for (let pane of [a, b, c]) expect(await rpc('eval', { pane: pane.id, expression: 'window.bmuxMovement' })).toBe(pane.id)
    expect((await window()).panes.find((pane: any) => pane.id === b.id).profileId).toBe(b.profileId)
    await rpc('select-pane', { client: client.id, pane: a.id })
    await expect.poll(() => application.evaluate(async ({ BaseWindow }, url) => {
      let panes: string[] = []
      for (let window of BaseWindow.getAllWindows().filter(window => window.isVisible())) for (let view of window.contentView.children) {
        let contents = (view as any).webContents, bounds = view.getBounds()
        if (contents?.getURL() === url && bounds.width > 100 && bounds.height > 100) panes.push(await contents.executeJavaScript('window.bmuxMovement'))
      }
      return panes.sort()
    }, url)).toEqual([a.id, b.id, c.id].sort())
  } finally {
    await chrome.keyboard.press('Escape')
    await rpc('switch-client', { client: client.id, session: client.sessionId })
    await rpc('select-window', { client: client.id, window: client.windowId })
    for (let session of [local, other]) if ((await state()).model.sessions.some((item: any) => item.id === session.id)) await rpc('kill-session', { session: session.id, confirm: true })
  }
})

test('window movement commands transfer and exchange explicit windows across sessions without losing pages', async () => {
  let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)!
  let local = await rpc('new-session', { name: 'windows-local' }), other = await rpc('new-session', { name: 'windows-other' })
  let a = local.windows[0], b = await rpc('new-window', { session: local.id, name: 'b' }), c = await rpc('new-window', { session: local.id, name: 'c', url })
  let cli = async (...args: string[]) => {
    let { stdout } = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args, '-c', client.id], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20_000 })
    let result = JSON.parse(stdout); expect(result.ok, stdout).toBe(true); return result.result
  }
  let windows = async (session: string) => (await state()).model.sessions.find((item: any) => item.id === session).windows.map((window: any) => window.id)
  try {
    await rpc('switch-client', { client: client.id, session: local.id })
    await rpc('select-window', { client: client.id, window: a.id })
    await rpc('wait', { pane: c.panes[0].id, selector: 'h1' })
    await rpc('eval', { pane: c.panes[0].id, expression: 'window.bmuxMovement = "window stays live"' })
    await rpc('select-window', { client: client.id, window: c.id })
    await rpc('toggle-pane-zoom', { client: client.id })
    await cli('movew', '-s', ':3', '-t', ':1')
    expect(await windows(local.id)).toEqual([c.id, a.id, b.id])
    expect((await state()).model.clients.find((item: any) => item.id === client.id)).toMatchObject({ windowId: c.id, zoomedPaneId: c.panes[0].id })
    await cli('movew', '-s', ':1', '-t', ':3')
    await rpc('select-window', { client: client.id, window: a.id })
    await cli('swapw', '-s', ':1', '-t', ':3', '-d')
    expect(await windows(local.id)).toEqual([c.id, b.id, a.id])
    expect((await state()).model.clients.find((item: any) => item.id === client.id)).toMatchObject({ sessionId: local.id, windowId: c.id, paneId: c.panes[0].id })
    await cli('movew', '-s', ':2', '-t', 'windows-other:2', '-d')
    expect(await windows(local.id)).toEqual([c.id, a.id])
    expect(await windows(other.id)).toEqual([other.windows[0].id, b.id])
    expect((await state()).model.clients.find((item: any) => item.id === client.id).windowId).toBe(c.id)
    await cli('swapw', '-s', ':2', '-t', 'windows-other:2', '-d')
    expect(await windows(local.id)).toEqual([c.id, b.id])
    expect(await windows(other.id)).toEqual([other.windows[0].id, a.id])
    await cli('movew', '-s', 'windows-other:2', '-t', ':2', '-b')
    expect(await windows(local.id)).toEqual([c.id, a.id, b.id])
    expect(await windows(other.id)).toEqual([other.windows[0].id])
    expect((await state()).model.clients.find((item: any) => item.id === client.id)).toMatchObject({ sessionId: local.id, windowId: a.id })
    await cli('movew', '-r', '-t', 'windows-local:')
    expect(await windows(local.id)).toEqual([c.id, a.id, b.id])
    await open(); await prompt().fill('selectw -t windows-other:1'); await prompt().press('Enter'); await expect(prompt()).toHaveCount(0)
    expect((await state()).model.clients.find((item: any) => item.id === client.id).sessionId).toBe(other.id)
    await open(); await prompt().fill('selectp -t windows-local:1.0'); await prompt().press('Enter'); await expect(prompt()).toHaveCount(0)
    expect((await state()).model.clients.find((item: any) => item.id === client.id)).toMatchObject({ sessionId: local.id, windowId: c.id, paneId: c.panes[0].id })
    expect(await rpc('eval', { pane: c.panes[0].id, expression: 'window.bmuxMovement' })).toBe('window stays live')
    await expect.poll(nativeVisible).toBe(true)
  } finally {
    await chrome.keyboard.press('Escape')
    await rpc('switch-client', { client: client.id, session: client.sessionId })
    await rpc('select-window', { client: client.id, window: client.windowId })
    for (let session of [local, other]) if ((await state()).model.sessions.some((item: any) => item.id === session.id)) await rpc('kill-session', { session: session.id, confirm: true })
  }
})

test('close-pane shortcut immediately removes the selected pane', async () => {
  let current = await state(), window = current.model.sessions[0].windows[0], original = window.panes[0]
  let pane = await rpc('split-window', { pane: original.id, client: current.clientId })
  await activate(); await rpc('focus-page', { client: current.clientId })
  await application.evaluate(async ({ webContents }) => {
    for (let event of [{ keyCode: 'x', modifiers: ['control'] }, { keyCode: 'q', modifiers: [] }]) {
      let contents = webContents.getFocusedWebContents()!
      contents.sendInputEvent({ type: 'keyDown', ...event } as Electron.KeyboardInputEvent)
      contents.sendInputEvent({ type: 'keyUp', ...event } as Electron.KeyboardInputEvent)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  })
  await expect(chrome.getByRole('textbox', { name: 'Close pane confirmation', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes.some((item: { id: string }) => item.id === pane.id)).toBe(false)
})

test('close commands confirm only when an internal window contains multiple pages', async () => {
  let current = await state(), session = current.model.sessions[0]
  for (let window of session.windows.slice(1)) await rpc('kill-window', { window: window.id, confirm: true })
  let create = () => rpc('new-window', { session: session.id, client: current.clientId })
  let window = await create()
  await open(); await prompt().fill('close-window'); await prompt().press('Enter')
  await expect.poll(async () => (await state()).model.sessions[0].windows.some((item: any) => item.id === window.id)).toBe(false)
  await expect(chrome.getByRole('textbox', { name: 'Close window confirmation', exact: true })).toHaveCount(0)
  await create(); await rpc('split-window', { pane: (await state()).model.sessions[0].windows[1].panes[0].id, client: current.clientId })
  await closeShortcut('Q')
  let confirmation = chrome.getByRole('textbox', { name: 'Close window confirmation', exact: true })
  await expect(confirmation).toBeFocused()
  expect((await state()).model.sessions[0].windows.length).toBe(2)
  await confirmation.press('n')
  expect((await state()).model.sessions[0].windows.length).toBe(2)
  await open(); await prompt().fill('close-window'); await prompt().press('Enter')
  await confirmation.press('y')
  await expect.poll(async () => (await state()).model.sessions[0].windows.length).toBe(1)
})

test('slash searches help commands and active shortcuts; Escape clears before closing', async () => {
  await chrome.getByRole('button', { name: 'Help', exact: true }).click()
  let help = chrome.getByRole('dialog', { name: 'Help', exact: true })
  await expect(help).toBeVisible(); await help.getByRole('button', { name: 'Close', exact: true }).focus(); await chrome.keyboard.press('/')
  let search = help.getByRole('textbox', { name: 'Search help', exact: true }); await expect(search).toBeFocused()
  await search.fill('browser tools')
  await expect(help.getByText('Cmd+Alt+D', { exact: true })).toBeVisible()
  await expect(help.getByText('browser-tools', { exact: true }).first()).toBeVisible()
  await expect(help.getByText('reload', { exact: true })).toHaveCount(0)
  await chrome.screenshot({ path: path.resolve('artifacts/help-search.png') })
  await search.fill('Ctrl X'); await expect(help.getByText('Ctrl+X then ?', { exact: true })).toBeVisible()
  await search.fill('zzzzunmatched'); await expect(help.getByText('No matching help entries.', { exact: true })).toBeVisible()
  await search.press('Escape'); await expect(help).toBeVisible(); await expect(search).toHaveValue('')
  await chrome.keyboard.press('/'); await expect(search).toBeFocused(); await expect(search).toHaveValue('')
  await search.press('Escape'); await chrome.keyboard.press('Escape'); await expect(help).toHaveCount(0)
  await activate(); await expect.poll(nativeVisible).toBe(true)
})

test('profile icon has no visible label and opens details for the selected pane', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let session = current.model.sessions.find((item: { id: string }) => item.id === client.sessionId)!
  let window = session.windows.find((item: { id: string }) => item.id === client.windowId)!
  let pane = window.panes.find((item: { id: string }) => item.id === client.paneId)!
  let profile = current.model.profiles.find((item: { id: string }) => item.id === pane.profileId)!
  let button = chrome.getByRole('button', { name: `Profile: ${profile.name}`, exact: true })
  await expect(button.locator('span')).toHaveCount(0)
  let panel = await openProfilePanel(profile.name)
  await expect(panel.getByRole('region', { name: `${profile.name} profile details`, exact: true })).toContainText(`Background pages${profile.background ? 'Keep running' : 'Throttle when inactive'}`)
  await expect(panel).toContainText(`Session${session.name}`)
  await expect(panel).toContainText(`Window${window.name}`)
  await expect(panel).toContainText(`Pane${pane.id}`)
})

test('profile popup renames default and custom profiles without changing pane identity', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let session = current.model.sessions.find((item: { id: string }) => item.id === client.sessionId)!
  let window = session.windows.find((item: { id: string }) => item.id === client.windowId)!
  let pane = window.panes.find((item: { id: string }) => item.id === client.paneId)!
  let profile = current.model.profiles.find((item: { id: string }) => item.id === pane.profileId)!
  let other = current.model.profiles.find((item: { id: string }) => item.id !== profile.id)!
  let customPane: { id: string } | undefined
  try {
    for (let [index, selected] of [profile, other].entries()) {
      if (index) customPane = await rpc('split-window', { pane: pane.id, profile: selected.id, client: client.id, url }) as { id: string }
      let selectedPane = customPane ?? pane
      let identity = await rpc('eval', { pane: selectedPane.id, expression: 'window.profileRenameIdentity ??= Math.random()' })
      let panel = await openProfilePanel(selected.name)
      let rename = panel.getByRole('button', { name: 'Edit profile name', exact: true })
      let input = panel.getByRole('textbox', { name: 'Profile name', exact: true })
      await expect(panel.getByRole('button', { name: 'Rename', exact: true })).toHaveCount(0)
      await expect(rename).toHaveText(selected.name)
      await rename.hover(); await expect(rename).toHaveCSS('cursor', 'text')
      await rename.click(); await expect(input).toBeFocused(); await expect(input).toHaveValue(selected.name)
      await input.fill('discarded'); await input.press('Escape')
      await expect(panel).toBeVisible(); await expect(input).toHaveCount(0); await expect(rename).toBeFocused()
      await rename.click(); await input.fill('also discarded'); await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(input).toHaveCount(0)
      await rename.click(); await input.fill('   '); await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await input.press('Enter'); await expect(input).toBeVisible()
      await input.fill(index ? profile.name : other.name); await input.press('Enter')
      await expect(chrome.getByText('Profile name already exists', { exact: true })).toBeVisible()
      await expect(input).toBeEnabled(); await expect(input).toBeVisible()
      let name = `Renamed ${selected.name}`
      await input.fill(`  ${name}  `)
      await chrome.screenshot({ path: path.resolve(`artifacts/profile-rename-editor-${index}.png`) })
      if (index) await panel.getByRole('button', { name: 'Save', exact: true }).click()
      else await input.press('Enter')
      await expect(input).toHaveCount(0)
      await expect(panel.getByRole('region', { name: `${name} profile details`, exact: true })).toBeVisible()
      await expect(panel.getByRole('combobox', { name: 'Default profile for new windows' }).getByRole('option', { name, exact: true })).toHaveAttribute('value', selected.id)
      await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')).profiles.find((item: { id: string }) => item.id === selected.id)?.name).toBe(name)
      await chrome.screenshot({ path: path.resolve(`artifacts/profile-renamed-${index}.png`) })
      await panel.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(chrome.locator(`[data-pane-id="${selectedPane.id}"]`).getByRole('button', { name: `Profile: ${name}`, exact: true })).toBeVisible()
      expect(await rpc('eval', { pane: selectedPane.id, expression: 'window.profileRenameIdentity' })).toBe(identity)
      await expect.poll(async () => (await rpc('list-panes', { window: window.id }) as { id: string; profileId: string }[]).find(item => item.id === selectedPane.id)?.profileId).toBe(selected.id)
      panel = await openProfilePanel(name)
      await rename.press('Enter'); await expect(input).toHaveValue(name)
      await input.press('Escape'); await panel.getByRole('button', { name: 'Close', exact: true }).click()
      await rpc('profile.rename', { profile: selected.id, name: selected.name })
    }
  } finally {
    await chrome.keyboard.press('Escape')
    await rpc('profile.rename', { profile: profile.id, name: profile.name })
    await rpc('profile.rename', { profile: other.id, name: other.name })
    if (customPane) await rpc('kill-pane', { pane: customPane.id, confirm: true })
  }
})

test('pane address shows profile controls for both default and custom profiles', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let session = current.model.sessions.find((item: { id: string }) => item.id === client.sessionId)!
  let defaultProfile = current.model.profiles.find((item: { id: string }) => item.id === session.defaultProfileId)!
  await expect(chrome.locator(`[data-pane-id="${client.paneId}"]`).getByRole('button', { name: `Profile: ${defaultProfile.name}`, exact: true })).toBeVisible()
  await expect(chrome.getByRole('contentinfo', { name: 'Browser status' }).getByRole('button', { name: /^Profile:/ })).toHaveCount(0)
  let customProfile = current.model.profiles.find((item: { id: string }) => item.id !== session.defaultProfileId)!
  let pane = await rpc('split-window', { pane: client.paneId, profile: customProfile.id, client: client.id, url })
  let route = chrome.getByRole('button', { name: `Profile: ${customProfile.name}`, exact: true })
  try {
    await expect(route).toBeVisible()
    await expect(route.locator(':scope > svg')).toHaveCount(2)
    await expect(route.locator('[data-profile-avatar]')).toHaveCount(1)
    await expect(route.locator('[data-profile-route-icon]')).toHaveCount(1)
  } finally {
    await rpc('kill-pane', { pane: (pane as { id: string }).id, confirm: true })
  }
})

test('proxy host picker filters SOCKS5 providers by location', async () => {
  let current = await state(), profile = current.model.profiles[0]
  let panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Connection' }).click()
  await panel.getByLabel('Protocol', { exact: true }).selectOption('socks5')
  await panel.getByLabel('Host', { exact: true }).click()
  let picker = panel.getByRole('dialog', { name: 'Proxy providers', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByLabel('Host provider').selectOption('bmux.nordvpn/nordvpn')
  await expect(picker.getByRole('region', { name: 'Europe', exact: true })).toBeVisible()
  await expect(picker.getByRole('region', { name: 'North America', exact: true })).toBeVisible()
  await chrome.screenshot({ path: path.resolve('artifacts/proxy-provider-picker.png') })
  await picker.getByLabel('Search proxy locations').fill('amsterdam')
  await expect(picker.getByRole('region', { name: 'North America', exact: true })).toHaveCount(0)
  await picker.getByRole('button', { name: /Amsterdam, Netherlands/ }).click()
  await expect(picker).toHaveCount(0)
  await expect(panel.getByLabel('Region', { exact: true })).toHaveValue('amsterdam.nl.socks.nordhold.net')
  await expect(panel).toContainText('Uses SOCKS5 proxy on port 1080')
})

test('saved proxy settings and credentials are shared across panes and profiles', async () => {
  let current = await state(), profile = current.model.profiles[0], client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)
  await rpc('profile.proxy.set', { profile: profile.id, protocol: 'http', host: '127.0.0.1', port: proxy.port, authenticated: true, username: 'fixture-user', password: 'fixture-password' })
  let other = await rpc('profile.create', { name: 'Shared proxy fixture' }) as { id: string; name: string }
  let pane = await rpc('split-window', { pane: client.paneId, profile: profile.id, client: client.id }) as { id: string }
  try {
    await rpc('select-pane', { pane: pane.id, client: client.id, focus: false })
    let panel = await openProfilePanel(profile.name)
    await panel.getByRole('tab', { name: 'Connection' }).click()
    await expect(panel.getByLabel('Host', { exact: true })).toHaveValue('127.0.0.1')
    await expect(panel.getByLabel('Username', { exact: true })).toHaveValue('fixture-user')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await rpc('pane.profile.set', { pane: pane.id, profile: other.id })
    await rpc('navigate', { pane: pane.id, url })
    await chrome.getByRole('button', { name: `Profile: ${other.name}`, exact: true }).click()
    await expect(panel.getByRole('region', { name: `${other.name} profile details`, exact: true })).toBeVisible()
    await panel.getByRole('tab', { name: 'Connection' }).click()
    await panel.getByLabel('Saved proxies', { exact: true }).selectOption((await state()).model.profiles.find((item: { id: string }) => item.id === profile.id).connectionId)
    await expect(panel.getByLabel('Host', { exact: true })).toHaveValue('127.0.0.1')
    await expect(panel.getByLabel('Username', { exact: true })).toHaveValue('fixture-user')
    await expect(panel.getByLabel('Password', { exact: true })).toHaveValue('')
    await panel.getByRole('switch', { name: 'Use for new panes', exact: true }).click()
    await expect(panel.getByRole('switch', { name: 'Use for new panes', exact: true })).toBeChecked()
    await panel.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
    await expect.poll(async () => (await state()).model.profiles.find((item: { id: string }) => item.id === other.id)?.proxy?.host).toBe('127.0.0.1')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    let before = proxyRequests
    let next = await rpc('split-window', { pane: pane.id, profile: other.id, url }) as { id: string }
    await rpc('wait', { pane: next.id, expression: "document.querySelector('h1')?.textContent === 'Command search fixture'" })
    await expect.poll(() => proxyRequests).toBeGreaterThan(before)
    await rpc('kill-pane', { pane: next.id, confirm: true })
    let result = await rpc('profile.proxy.test', { profile: other.id }) as { ip: string }
    expect(result.ip).toBe('203.0.113.9')
  } finally {
    await rpc('profile.proxy.clear', { profile: profile.id })
    await rpc('profile.proxy.clear', { profile: other.id })
    await rpc('kill-pane', { pane: pane.id, confirm: true })
  }
})

test('proxy toggle keeps testing available after errors and while changing the default', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let profile = await rpc('profile.create', { name: 'Proxy toggle fixture' }) as { id: string; name: string }
  let pane = await rpc('split-window', { pane: client.paneId, profile: profile.id, client: client.id }) as { id: string }
  try {
    await rpc('select-pane', { pane: pane.id, client: client.id, focus: false })
    let panel = await openProfilePanel(profile.name)
    await panel.getByRole('tab', { name: 'Connection' }).click()
    await panel.getByLabel('Protocol', { exact: true }).selectOption('http')
    await panel.getByLabel('Host', { exact: true }).fill('127.0.0.1')
    await panel.getByLabel('Port', { exact: true }).fill(String(proxy.port))
    let toggle = panel.getByRole('switch', { name: 'Use for new panes', exact: true })
    let testConnection = panel.getByRole('button', { name: 'Test connection', exact: true })
    // A rejected save must leave both controls usable.
    await toggle.click()
    await expect(chrome.getByRole('status')).toContainText('Proxy username and password are required')
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled()
    await expect(testConnection).toBeEnabled()
    await panel.getByLabel('Username', { exact: true }).fill('fixture-user')
    await panel.getByLabel('Password', { exact: true }).fill('wrong-password')
    await toggle.click()
    await expect(toggle).toBeChecked()
    await testConnection.click()
    await expect(chrome.getByRole('status')).toContainText('Proxy authentication failed')
    await expect(testConnection).toBeEnabled()
    await panel.getByLabel('Password', { exact: true }).fill('fixture-password')
    await testConnection.click()
    await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
    await expect(chrome.getByRole('status').filter({ hasText: 'Proxy authentication failed' })).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(panel.getByLabel('Password', { exact: true })).toHaveValue('')
    await expect(testConnection).toBeEnabled()
    let connectionId = (await state()).model.profiles.find((item: { id: string }) => item.id === profile.id).connectionId
    holdProxyTest = true
    await testConnection.click()
    await expect.poll(() => !!pendingProxyTest).toBe(true)
    await expect(testConnection).toHaveText('Testing…')
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect.poll(async () => (await state()).model.profiles.find((item: { id: string }) => item.id === profile.id).proxy).toBeUndefined()
    await expect(panel.getByLabel('Host', { exact: true })).toHaveValue('127.0.0.1')
    await expect(panel.getByLabel('Username', { exact: true })).toHaveValue('fixture-user')
    holdProxyTest = false; pendingProxyTest!(); pendingProxyTest = undefined
    await expect(testConnection).toBeEnabled()
    await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
    await testConnection.click()
    await expect(testConnection).toBeEnabled()
    await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    expect((await state()).model.profiles.find((item: { id: string }) => item.id === profile.id).connectionId).toBe(connectionId)
    await chrome.screenshot({ path: path.resolve('artifacts/proxy-toggle.png') })
  } finally {
    holdProxyTest = false; pendingProxyTest?.(); pendingProxyTest = undefined
    await rpc('profile.proxy.clear', { profile: profile.id })
    await rpc('kill-pane', { pane: pane.id, confirm: true })
  }
})

test('profile proxy settings route, test, and restore the selected profile connection', async () => {
  let current = await state(), profile = current.model.profiles[0]
  let panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Connection' }).click()
  await panel.getByLabel('Provider', { exact: true }).selectOption('bmux.nordvpn/nordvpn')
  await expect(panel.getByLabel('Region', { exact: true })).toBeVisible()
  await panel.getByLabel('Region', { exact: true }).selectOption('sg651.proxy.nordvpn.com')
  await expect(panel).toContainText('Uses HTTPS proxy on port 89')
  await panel.getByLabel('Provider', { exact: true }).selectOption('custom')
  await expect(panel.getByLabel('Protocol', { exact: true })).toHaveValue('https')
  await expect(panel.getByLabel('Host', { exact: true })).toHaveValue('sg651.proxy.nordvpn.com')
  await expect(panel.getByLabel('Port', { exact: true })).toHaveValue('89')
  await panel.getByLabel('Provider', { exact: true }).selectOption('bmux.nordvpn/nordvpn')
  await panel.getByLabel('Region', { exact: true }).selectOption('amsterdam.nl.socks.nordhold.net')
  await expect(panel).toContainText('Uses SOCKS5 proxy on port 1080')
  await expect(panel.getByLabel('Host', { exact: true })).toHaveCount(0)
  await panel.getByLabel('Provider', { exact: true }).selectOption('custom')
  await panel.getByLabel('Protocol', { exact: true }).selectOption('http')
  await panel.getByLabel('Host', { exact: true }).fill('127.0.0.1')
  await panel.getByLabel('Port', { exact: true }).fill(String(proxy.port))
  await panel.getByLabel('Username', { exact: true }).fill('fixture-user')
  await panel.getByLabel('Password', { exact: true }).fill('fixture-password')
  await panel.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
  expect((await state()).model.profiles[0].proxy).toBeUndefined()
  let before = proxyRequests
  await panel.getByRole('switch', { name: 'Use for new panes', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].proxy?.host).toBe('127.0.0.1')
  expect(proxyRequests).toBe(before)
  await expect(panel.getByRole('switch', { name: 'Use for new panes', exact: true })).toBeChecked()
  await expect(panel.getByRole('button', { name: 'Test connection', exact: true })).toBeEnabled()
  await expect(chrome.getByRole('button', { name: `Profile ${profile.name}, desktop, proxy connection`, exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
  await expect(panel.getByRole('status').locator('svg')).toBeVisible()
  await expect.poll(async () => (await state()).profileProxyTests[(await state()).model.profiles[0].connectionId]?.ip).toBe('203.0.113.9')
  let profileButton = chrome.getByRole('button', { name: `Profile: ${profile.name}`, exact: true })
  await expect(profileButton.locator('[data-proxy-verified="true"]')).toHaveCount(0)
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => {
    let panelBox = (await panel.boundingBox())!, headerBox = (await panel.locator(':scope > header').boundingBox())!
    return headerBox.y - panelBox.y
  }).toBeLessThanOrEqual(2)
  await expect(panel.getByRole('button', { name: 'Close', exact: true }).locator('svg')).toBeVisible()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  let proxyWindow = await rpc('new-window', { session: current.model.clients.find((item: { id: string }) => item.id === current.clientId).sessionId, profile: profile.id, client: current.clientId }) as { id: string }
  let proxyButton = chrome.getByRole('button', { name: `Proxy for ${profile.name}`, exact: true })
  await expect(proxyButton.locator('[data-proxy-verified="true"]')).toBeVisible()
  await expect(proxyButton).toHaveAttribute('title', /Proxy verified · Exit IP: 203\.0\.113\.9/)
  await proxyButton.click()
  let proxyPanel = chrome.getByRole('dialog', { name: 'Proxy', exact: true })
  await expect(proxyPanel.getByRole('region', { name: `${profile.name} proxy settings`, exact: true })).toBeVisible()
  await expect(proxyPanel.getByRole('status')).toContainText('RegionAmsterdam, North Holland, Netherlands')
  let originalBounds = await application.evaluate(({ BaseWindow }) => {
    let window = BaseWindow.getAllWindows().find(item => item.isVisible())!
    let bounds = window.getBounds()
    window.setBounds({ ...bounds, width: 620, height: 440 })
    return bounds
  })
  try {
    for (let scroll of [0, 10000]) {
      await proxyPanel.locator('[class*=proxyFields]').evaluate((element, top) => { element.scrollTop = top }, scroll)
      await expect(proxyPanel.getByRole('switch', { name: 'Use for new panes', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(proxyPanel.getByRole('button', { name: 'Test connection', exact: true })).toBeInViewport({ ratio: 1 })
    }
  } finally {
    await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(item => item.isVisible())!.setBounds(bounds), originalBounds)
  }

  await proxyPanel.locator('..').click({ position: { x: 5, y: 5 } })
  await expect(proxyPanel).toHaveCount(0)
  let otherProfile = current.model.profiles.find((item: { id: string }) => item.id !== profile.id)!
  let verificationSession = await rpc('new-session', { name: 'proxy route verification', profile: otherProfile.id, client: current.clientId }) as { id: string }
  let verificationState = await state(), verificationClient = verificationState.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let verificationPane = verificationState.model.sessions.find((item: { id: string }) => item.id === verificationSession.id)!.windows[0].panes[0]
  let customPane = await rpc('split-window', { pane: verificationPane.id, profile: profile.id, client: verificationClient.id, url }) as { id: string }
  let route = chrome.getByRole('button', { name: `Profile: ${profile.name}`, exact: true })
  await expect(route).toBeVisible()
  let paneProxyButton = chrome.getByRole('button', { name: `Proxy for ${profile.name}`, exact: true })
  await expect(paneProxyButton.locator('[data-proxy-verified="true"]')).toBeVisible()
  await expect(paneProxyButton).toHaveAttribute('title', /Exit IP: 203\.0\.113\.9/)
  await paneProxyButton.click()
  await expect(chrome.getByRole('dialog', { name: 'Proxy', exact: true }).getByRole('status')).toContainText('North Holland')
  await chrome.getByRole('dialog', { name: 'Proxy', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await rpc('kill-pane', { pane: customPane.id, confirm: true })
  await rpc('kill-session', { session: verificationSession.id, confirm: true })
  await rpc('select-window', { window: proxyWindow.id, client: current.clientId })
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Connection' }).click()
  await panel.getByRole('switch', { name: 'Use for new panes', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].proxy).toBeUndefined()
  await expect(panel.getByLabel('Host', { exact: true })).toHaveValue('127.0.0.1')
  await panel.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
  await expect(panel.getByRole('switch', { name: 'Use for new panes', exact: true })).not.toBeChecked()
  await expect(proxyButton).toBeVisible()
  await rpc('kill-window', { window: proxyWindow.id, confirm: true })
  await expect(proxyButton).toHaveCount(0)
  await expect(chrome.getByRole('button', { name: `Profile: ${profile.name}`, exact: true })).toBeVisible()
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Connection' }).click()
  await rpc('plugin.enable', { id: 'bmux.nordvpn', enabled: false })
  await expect.poll(async () => (await state()).plugins.find((plugin: { id: string }) => plugin.id === 'bmux.nordvpn')?.enabled).toBe(false)
  await expect(panel.getByLabel('Provider', { exact: true }).getByRole('option', { name: 'NordVPN', exact: true })).toHaveCount(0)
  await rpc('plugin.enable', { id: 'bmux.nordvpn', enabled: true })
  await expect.poll(async () => (await state()).plugins.find((plugin: { id: string }) => plugin.id === 'bmux.nordvpn')?.enabled).toBe(true)
  await expect(panel.getByLabel('Provider', { exact: true }).getByRole('option', { name: 'NordVPN', exact: true })).toHaveCount(1)
})

test('profile device identity is applied before requests and cache status is public', async () => {
  let current = await state(), profile = current.model.profiles[0]
  let tab = current.model.sessions[0].windows[0].panes[0].id
  let other = await rpc('new-window', { session: current.model.sessions[0].id, url }) as { panes: { id: string }[] }
  let otherTab = other.panes[0].id
  await expect.poll(() => rpc('eval', { tab: otherTab, expression: 'document.title' })).toBe('Command search fixture')
  await rpc('eval', { tab: otherTab, expression: 'window.deviceReloadMarker = true' })
  let panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  let mobile = panel.getByRole('switch', { name: 'Mobile device', exact: true })
  await expect(mobile).not.toBeChecked()
  await expect(panel.getByRole('button', { name: 'Apply device', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Use desktop', exact: true })).toHaveCount(0)
  await expect(panel.getByText(/device active.*for this pane/)).toHaveCount(0)
  let details = panel.locator('details').filter({ hasText: 'Emulation details' })
  await expect(details).toHaveJSProperty('open', false)
  await panel.getByLabel('Device', { exact: true }).selectOption('pixel-8')
  await panel.getByLabel('Locale', { exact: true }).fill('fr-FR')
  await panel.getByLabel('Timezone', { exact: true }).fill('Europe/Paris')
  await mobile.check()
  await expect(mobile).toBeChecked()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device?.preset).toBe('pixel-8')
  expect(await rpc('eval', { tab: otherTab, expression: 'window.deviceReloadMarker' })).toBe(true)
  expect((await state()).model.sessions[0].device).toBeUndefined()
  await expect(chrome.getByRole('button', { name: `Profile ${profile.name}, Pixel 8, system connection`, exact: true })).toHaveCount(0)
  current = await state()
  await rpc('navigate', { tab, url: `${url}/device-android` })
  await expect.poll(() => identityRequests.get('/device-android')?.['user-agent']).toContain('Android 10')
  expect(identityRequests.get('/device-android')?.['accept-language']).toContain('fr-FR')
  await details.locator('summary').click()
  await expect(details).toHaveJSProperty('open', true)
  await expect(details).toContainText('412 × 915 CSS px')
  await expect(details).toContainText('Sec-CH-UA-Mobile: ?1')
  await expect(details).toContainText(identityRequests.get('/device-android')!['user-agent'] as string)
  await expect(details).toContainText('Top 40 · right 0 · bottom 24 · left 0 CSS px')
  await chrome.screenshot({ path: path.resolve('artifacts/profile-device-details.png') })
  await expect.poll(() => rpc('eval', { tab, expression: '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints,cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:Intl.DateTimeFormat().resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,uaPlatform:navigator.userAgentData?.platform,uaMobile:navigator.userAgentData?.mobile})' })).toEqual({ width: 412, height: 915, dpr: 2.625, touch: 5, cores: 8, memory: 8, locale: 'fr-FR', timezone: 'Europe/Paris', uaPlatform: 'Android', uaMobile: true })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  let androidFrame = chrome.locator(`[data-pane-id="${tab}"] [data-platform="android"]`)
  await expect(androidFrame).toHaveAttribute('data-preset', 'pixel-8')
  await expect(androidFrame.locator('img')).toHaveAttribute('src', /pixel-8/)
  let androidFrameBounds = (await androidFrame.boundingBox())!
  let androidScreenBounds = (await androidFrame.locator('[data-browser-content]').boundingBox())!
  expect(androidFrameBounds.width).toBeGreaterThan(androidScreenBounds.width)
  expect(androidFrameBounds.height).toBeGreaterThan(androidScreenBounds.height)
  expect(Math.abs(androidFrameBounds.x + androidFrameBounds.width / 2 - androidScreenBounds.x - androidScreenBounds.width / 2)).toBeLessThanOrEqual(1)
  expect(androidScreenBounds.y - androidFrameBounds.y).toBeGreaterThan(0)
  expect(androidScreenBounds.y - androidFrameBounds.y).toBeLessThan(20)
  await chrome.screenshot({ path: path.resolve('artifacts/device-pixel-portrait-frame.png') })
  panel = await openProfilePanel(profile.name)
  await expect.poll(async () => (await state()).profileCaches[profile.id]?.limit).toBe(256 * 1024 * 1024)
  await panel.getByRole('tab', { name: 'Overview' }).click()
  await expect(panel.getByText(/MiB of 256 MiB/)).toBeVisible()
  await panel.getByRole('button', { name: 'Clear HTTP cache', exact: true }).click()

  await panel.getByRole('tab', { name: 'Device' }).click()
  await expect.poll(async () => (await state()).profileCaches[profile.id]?.bytes).toBe(0)

  await panel.getByRole('switch', { name: 'Mobile device', exact: true }).uncheck()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device).toBeUndefined()
  await panel.getByLabel('Device', { exact: true }).selectOption('custom')
  await panel.getByLabel('Platform', { exact: true }).selectOption('android')
  await panel.getByLabel('Orientation', { exact: true }).selectOption('landscape')
  await panel.getByLabel('Width', { exact: true }).fill('400')
  await panel.getByLabel('Height', { exact: true }).fill('800')
  await panel.getByLabel('DPR', { exact: true }).fill('2')
  await panel.getByText('Set geolocation', { exact: true }).click()
  await panel.getByLabel('Latitude', { exact: true }).fill('48.8566')
  await panel.getByLabel('Longitude', { exact: true }).fill('2.3522')
  await panel.getByLabel('Accuracy', { exact: true }).fill('12')
  await panel.getByLabel('Enable for all new panes').check()
  await panel.getByRole('tabpanel', { name: 'Device settings' }).evaluate(element => element.scrollIntoView({ block: 'start' }))
  await chrome.screenshot({ path: path.resolve('artifacts/profile-device-controls.png') })
  await panel.evaluate(element => { element.scrollTop = 0 })
  await panel.getByRole('switch', { name: 'Mobile device', exact: true }).check()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device?.orientation).toBe('landscape')
  expect((await state()).model.sessions[0].device?.orientation).toBe('landscape')
  let future = await rpc('new-window', { session: current.model.sessions[0].id }) as { panes: { device?: { orientation: string } }[] }
  expect(future.panes[0].device?.orientation).toBe('landscape')
  expect((await state()).model.sessions[0].windows[0].panes[0].device?.platform).toBe('android')
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')).sessions[0].windows[0].panes[0].device?.geolocation).toEqual({ latitude: 48.8566, longitude: 2.3522, accuracy: 12 })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(androidFrame).toBeVisible()
  await expect(chrome.locator(`[data-pane-id="${tab}"] img[alt="Page preview"]`)).toHaveCount(0)
  androidFrameBounds = (await androidFrame.boundingBox())!
  androidScreenBounds = (await androidFrame.locator('[data-browser-content]').boundingBox())!
  expect(androidFrameBounds.width).toBeGreaterThan(androidScreenBounds.width)
  expect(androidFrameBounds.height).toBeGreaterThan(androidScreenBounds.height)
  expect(Math.abs(androidFrameBounds.y + androidFrameBounds.height / 2 - androidScreenBounds.y - androidScreenBounds.height / 2)).toBeLessThanOrEqual(1)
  expect(androidScreenBounds.x - androidFrameBounds.x).toBeGreaterThan(20)
  await chrome.screenshot({ path: path.resolve('artifacts/device-android-frame.png') })
  await expect.poll(async () => {
    let contentBounds = await chrome.locator(`[data-browser-content][data-content-pane-id="${tab}"]`).boundingBox()
    let nativeBounds = await application.evaluate(({ BaseWindow }, path) => {
      for (let window of BaseWindow.getAllWindows()) for (let view of window.contentView.children) if ('webContents' in view && (view as any).webContents.getURL().includes(path)) return view.getBounds()
    }, '/device-android')
    // Closing the settings overlay reattaches the native page asynchronously.
    if (!nativeBounds || !contentBounds) return Infinity
    return Math.max(Math.abs(nativeBounds.x + nativeBounds.width / 2 - (contentBounds.x + contentBounds.width / 2)), Math.abs(nativeBounds.y + nativeBounds.height / 2 - (contentBounds.y + contentBounds.height / 2)), Math.abs(nativeBounds.width - contentBounds.width), Math.abs(nativeBounds.height - contentBounds.height))
  }).toBeLessThanOrEqual(1)
  let geolocation = rpc('eval', { tab, expression: 'new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}), error => reject(new Error(error.message))))' })
  let permission: any
  await expect.poll(async () => { permission = (await rpc('permission.list') as any[]).find(item => item.permission === 'geolocation'); return !!permission }).toBe(true)
  await rpc('permission.respond', { id: permission.id, allow: true })
  expect(await geolocation).toEqual({ latitude: 48.8566, longitude: 2.3522, accuracy: 12 })
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByLabel('Device', { exact: true }).selectOption('galaxy-s24')
  await panel.getByLabel('Orientation', { exact: true }).selectOption('portrait')
  await expect(panel.getByRole('switch', { name: 'Mobile device', exact: true })).toBeChecked()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device?.preset).toBe('galaxy-s24')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(androidFrame).toHaveAttribute('data-preset', 'galaxy-s24')
  await expect(androidFrame.locator('img')).toHaveAttribute('src', /galaxy-s24/)
  androidFrameBounds = (await androidFrame.boundingBox())!
  androidScreenBounds = (await androidFrame.locator('[data-browser-content]').boundingBox())!
  expect(Math.abs(androidFrameBounds.x + androidFrameBounds.width / 2 - androidScreenBounds.x - androidScreenBounds.width / 2)).toBeLessThanOrEqual(1)
  await chrome.screenshot({ path: path.resolve('artifacts/device-galaxy-portrait-frame.png') })
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByLabel('Device', { exact: true }).selectOption('iphone-15-pro')
  await panel.getByLabel('Orientation', { exact: true }).selectOption('landscape')
  await expect(panel.getByRole('switch', { name: 'Mobile device', exact: true })).toBeChecked()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device?.preset).toBe('iphone-15-pro')
  await expect.poll(() => identityRequests.get('/device-android')?.['user-agent']).toContain('CPU iPhone OS 18_6_2')
  await rpc('navigate', { tab, url: `${url}/device-ios` })
  await expect.poll(() => identityRequests.get('/device-ios')?.['user-agent']).toContain('CPU iPhone OS 18_6_2')
  expect(identityRequests.get('/device-ios')?.['user-agent']).toContain('Version/27.0')
  expect(identityRequests.get('/device-ios')?.['sec-ch-ua']).toBeUndefined()
  expect(await rpc('eval', { tab, expression: '({cores:navigator.hardwareConcurrency,hasMemory:"deviceMemory" in navigator,memory:navigator.deviceMemory})' })).toEqual({ cores: 6, hasMemory: false })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  let iosFrame = chrome.locator(`[data-pane-id="${tab}"] [data-platform="ios"]`)
  await expect(iosFrame).toBeVisible()
  await expect(iosFrame.locator('img')).toHaveAttribute('src', /iphone-15-pro/)
  let iosFrameBounds = (await iosFrame.boundingBox())!
  let iosScreenBounds = (await iosFrame.locator('[data-browser-content]').boundingBox())!
  expect(iosFrameBounds.width).toBeGreaterThan(iosScreenBounds.width)
  expect(iosFrameBounds.height).toBeGreaterThan(iosScreenBounds.height)
  expect(Math.abs(iosFrameBounds.y + iosFrameBounds.height / 2 - iosScreenBounds.y - iosScreenBounds.height / 2)).toBeLessThanOrEqual(1)
  await chrome.screenshot({ path: path.resolve('artifacts/device-ios-frame.png') })
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByLabel('Orientation', { exact: true }).selectOption('portrait')
  await expect(panel.getByRole('switch', { name: 'Mobile device', exact: true })).toBeChecked()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device?.orientation).toBe('portrait')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  iosFrameBounds = (await iosFrame.boundingBox())!
  iosScreenBounds = (await iosFrame.locator('[data-browser-content]').boundingBox())!
  expect(Math.abs(iosFrameBounds.x + iosFrameBounds.width / 2 - iosScreenBounds.x - iosScreenBounds.width / 2)).toBeLessThanOrEqual(1)
  expect(iosScreenBounds.y - iosFrameBounds.y).toBeGreaterThan(0)
  expect(iosScreenBounds.y - iosFrameBounds.y).toBeLessThan(20)
  await chrome.screenshot({ path: path.resolve('artifacts/device-ios-portrait-frame.png') })
  let windowsBeforePopup = (await state()).model.sessions[0].windows.length
  await rpc('eval', { tab, expression: `window.open(${JSON.stringify(`${url}/device-popup`)}, '_blank'); true` })
  await expect.poll(() => identityRequests.get('/device-popup')?.['user-agent']).toContain('CPU iPhone OS 18_6_2')
  expect(identityRequests.get('/device-popup')?.['sec-ch-ua']).toBeUndefined()
  chrome = application.context().pages().find(candidate => candidate.url().endsWith('/renderer/index.html'))!
  await expect.poll(async () => (await state()).model.sessions[0].windows.length).toBe(windowsBeforePopup + 1)
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByRole('switch', { name: 'Mobile device', exact: true }).uncheck()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device).toBeUndefined()
})

test('profile device toggle saves edits on close and changes new pane defaults without reloading', async () => {
  let current = await state(), session = current.model.sessions[0], profile = current.model.profiles[0], tab = session.windows[0].panes[0].id
  let panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByLabel('Device', { exact: true }).selectOption('iphone-15-pro')
  await panel.getByLabel('Locale', { exact: true }).fill('en-US')
  await panel.getByLabel('Timezone', { exact: true }).fill('UTC')
  await panel.getByRole('switch', { name: 'Mobile device', exact: true }).check()
  await expect(panel.getByRole('switch', { name: 'Mobile device', exact: true })).toBeEnabled()
  await rpc('eval', { tab, expression: 'window.deviceSettingsMarker = 42' })
  await panel.getByLabel('Enable for all new panes').check()
  await expect.poll(async () => (await state()).model.sessions[0].device?.preset).toBe('iphone-15-pro')
  await expect(panel.getByRole('switch', { name: 'Mobile device', exact: true })).toBeEnabled()
  expect(await rpc('eval', { tab, expression: 'window.deviceSettingsMarker' })).toBe(42)
  await panel.getByLabel('Enable for all new panes').uncheck()
  await expect.poll(async () => (await state()).model.sessions[0].device).toBeUndefined()
  expect(await rpc('eval', { tab, expression: 'window.deviceSettingsMarker' })).toBe(42)
  await panel.getByLabel('Locale', { exact: true }).fill('de-DE')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device?.locale).toBe('de-DE')
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await expect(panel.getByRole('switch', { name: 'Mobile device', exact: true })).toBeChecked()
  await expect(panel.getByLabel('Locale', { exact: true })).toHaveValue('de-DE')
  await panel.locator('summary').filter({ hasText: 'Emulation details' }).click()
  await expect(panel.locator('details')).toContainText('Omitted for iOS')
  await expect(panel.locator('details')).toContainText('Top 59 · right 0 · bottom 34 · left 0 CSS px')
  await panel.getByLabel('Timezone', { exact: true }).fill('Invalid/Timezone')
  await panel.getByRole('switch', { name: 'Mobile device', exact: true }).uncheck()
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes[0].device).toBeUndefined()
})

for (let preset of ['pixel-8', 'galaxy-s24', 'iphone-15-pro']) for (let axis of ['horizontal', 'vertical']) test(`mobile splits ${preset} ${axis} clip the screen and preserve the camera cutout`, async () => {
  let current = await state(), session = current.model.sessions[0], tab = session.windows[0].panes[0].id
  await rpc('profile.device.set', { pane: tab, profile: session.windows[0].panes[0].profileId, newPanes: true, device: { preset, orientation: axis === 'horizontal' ? 'portrait' : 'landscape', locale: 'en-US', timezone: 'UTC' } })
  await rpc('navigate', { tab, url: `${url}/device-split-original` })
  await rpc('eval', { tab, expression: 'window.splitMarker = 42' })
  let split = await rpc('split-window', { pane: tab, client: current.clientId, axis }) as { id: string }
  let pane = chrome.locator(`[data-pane-id="${split.id}"]`)
  await expect(pane).toBeVisible()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  if (!await address.isVisible()) await pane.getByRole('button', { name: 'Address', exact: true }).click()
  await address.fill(`${url}/device-split-new`); await address.press('Enter')
  await expect(address).toHaveCount(0)
  for (let [id, destination] of [[tab, `${url}/device-split-original`], [split.id, `${url}/device-split-new`]]) {
    await rpc('wait', { tab: id, expression: `location.href === ${JSON.stringify(destination)} && document.readyState === 'complete' && document.title === 'Device fixture'`, timeout: 5000 })
    await expect.poll(async () => (await state()).loading[id]).not.toBe(true)
    expect((await state()).crashes[id]).toBeUndefined()
  }
  await expect(async () => expect(await rpc('eval', { tab, expression: 'window.splitMarker' })).toBe(42)).toPass({ timeout: 5000 })
  // Capture the native app window without unrelated guest desktop notifications.
  let windowInfo = JSON.parse((await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics'); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))).find(window => window.kCGWindowOwnerPID === ${application.process().pid} && window.kCGWindowLayer === 0));`])).stdout)
  let painted = async (stage: string) => {
    await expect(async () => {
      let screenshotPath = path.resolve(`artifacts/device-split-${preset}-${axis}-${stage}.png`)
      await promisify(execFile)('/usr/sbin/screencapture', ['-x', '-o', '-l', String(windowInfo.kCGWindowNumber), screenshotPath])
      let colors = await application.evaluate(({ BaseWindow, nativeImage }, { screenshotPath, url, windowBounds }) => {
        let image = nativeImage.createFromPath(screenshotPath), size = image.getSize(), pixels = image.toBitmap()
        let scale = size.width / windowBounds.Width
        return BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children.flatMap(view => {
          if (!('webContents' in view) || !(view as Electron.WebContentsView).webContents.getURL().startsWith(`${url}/device-split-`)) return []
          let bounds = view.getBounds(), origin = window.getContentBounds()
          let camera = window.contentView.children[window.contentView.children.indexOf(view) + 1].getBounds()
          camera = { ...camera, x: camera.x - bounds.x, y: camera.y - bounds.y }
          let pixel = (x: number, y: number) => {
            let offset = (Math.floor((origin.y + bounds.y + y - windowBounds.Y) * scale) * size.width + Math.floor((origin.x + bounds.x + x - windowBounds.X) * scale)) * 4
            return [pixels[offset + 2], pixels[offset + 1], pixels[offset]]
          }
          return [{
            page: [pixel(bounds.width / 2, bounds.height * 0.7), pixel(8, bounds.height * 0.8)],
            corners: [[1, 1], [bounds.width - 2, 1], [1, bounds.height - 2], [bounds.width - 2, bounds.height - 2]].map(([x, y]) => pixel(x, y)),
            camera: pixel(camera.x + camera.width / 2, camera.y + camera.height / 2),
            besideCamera: camera.width > camera.height ? pixel(camera.x - 5, camera.y + camera.height / 2) : pixel(camera.x + camera.width / 2, camera.y - 5),
          }]
        }))
      }, { screenshotPath, url, windowBounds: windowInfo.kCGWindowBounds })
      expect(colors).toHaveLength(2)
      for (let screen of colors) {
        for (let pixel of screen.page) for (let [channel, expected] of [0x23, 0x45, 0x67].entries()) expect(Math.abs(pixel[channel] - expected)).toBeLessThanOrEqual(2)
        for (let corner of screen.corners) expect(corner).not.toEqual([0x23, 0x45, 0x67])
        expect(screen.camera).toEqual([8, 8, 8])
        // Translucent system bars can round a composited channel by one.
        for (let [channel, expected] of [0x23, 0x45, 0x67].entries()) expect(Math.abs(screen.besideCamera[channel] - expected)).toBeLessThanOrEqual(2)
      }
    }).toPass({ timeout: 10000 })
  }
  await painted('initial')
  await rpc('reload', { tab })
  await painted('reloaded')
  await rpc('kill-pane', { pane: split.id, confirm: true })
  await rpc('profile.device.clear', { pane: tab, profile: session.windows[0].panes[0].profileId })
})

test('mobile link preview stays at the bottom left of the whole pane', async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  await rpc('profile.device.set', { pane: pane.id, profile: pane.profileId, device: { preset: 'iphone-15-pro', orientation: 'portrait', locale: 'en-US', timezone: 'UTC' } })
  await rpc('navigate', { tab: pane.id, url: `${url}/device-link-preview` })
  let content = chrome.locator(`[data-pane-id="${pane.id}"] [data-pane-content]`)
  await expect(content).toBeVisible()
  await application.evaluate(({ webContents }, url) => {
    webContents.getAllWebContents().find(contents => contents.getURL() === `${url}/device-link-preview`)!.emit('update-target-url', {}, `${url}/destination`)
  }, url)
  await expect(async () => {
    let paneBounds = (await content.boundingBox())!
    let preview = await application.evaluate(({ BaseWindow }) => {
      let view = BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().endsWith('#link-preview'))!
      return { bounds: view.getBounds(), visible: view.getVisible() }
    })
    expect(preview.visible).toBe(true)
    expect(preview.bounds.x).toBe(Math.round(paneBounds.x))
    expect(preview.bounds.y + preview.bounds.height).toBe(Math.round(paneBounds.y + paneBounds.height))
  }).toPass({ timeout: 5000 })
  await rpc('profile.device.clear', { pane: pane.id, profile: pane.profileId })
})

for (let preset of ['iphone-15-pro', 'galaxy-s24']) test(`mobile safe areas ${preset} tint bars and scroll beneath them`, async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  await rpc('profile.device.set', { pane: pane.id, profile: pane.profileId, device: { preset, orientation: 'portrait', locale: 'en-US', timezone: 'UTC' } })
  for (let suffix of ['', '-cover']) {
    await chrome.locator(`[data-pane-id="${pane.id}"]`).getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${url}/safe-area${suffix}`); await address.press('Enter')
    await rpc('wait', { tab: pane.id, expression: "!!document.querySelector('bmux-device-bars')", timeout: 5000 })
    let inspect = () => rpc('eval', { tab: pane.id, expression: `(() => {
      let bars = document.querySelector('bmux-device-bars'), top = bars.shadowRoot.querySelector('.top'), bottom = bars.shadowRoot.querySelector('.bottom');
      return { start: document.querySelector('main').getBoundingClientRect().top, end: document.querySelector('#end').getBoundingClientRect().bottom, height: innerHeight, top: top.getBoundingClientRect().height, bottom: bottom.getBoundingClientRect().height, tint: getComputedStyle(top).backgroundColor, ink: getComputedStyle(top).color, barY: top.getBoundingClientRect().top };
    })()` }) as Promise<any>
    let initial = await inspect()
    expect(initial.start).toBe(preset === 'iphone-15-pro' ? 59 : 40)
    expect(initial.tint).toBe('color(srgb 0.137255 0.270588 0.403922 / 0.92)')
    expect(initial.ink).toBe('rgb(255, 255, 255)')
    if (!suffix) {
      let windowId = (await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics'); String(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))).find(window => window.kCGWindowOwnerPID === ${application.process().pid} && window.kCGWindowLayer === 0).kCGWindowNumber);`])).stdout.trim()
      await promisify(execFile)('/usr/sbin/screencapture', ['-x', '-o', '-l', windowId, path.resolve(`artifacts/safe-area-${preset}.png`)])
    }
    await rpc('eval', { tab: pane.id, expression: 'scrollTo(0, 200)' })
    await expect.poll(async () => (await inspect()).start).toBe(initial.start - 200)
    expect((await inspect()).barY).toBe(0)
    await rpc('eval', { tab: pane.id, expression: 'scrollTo(0, document.documentElement.scrollHeight)' })
    await expect.poll(async () => { let result = await inspect(); return result.height - result.end }).toBe(initial.bottom)
    await rpc('eval', { tab: pane.id, expression: `document.querySelector('meta[name="theme-color"]').content = '#888888'; document.body.style.background = '#eeeeee'` })
    await expect.poll(async () => (await inspect()).tint).toBe('color(srgb 0.933333 0.933333 0.933333 / 0.92)')
    expect((await inspect()).ink).toBe('rgb(17, 17, 17)')
    await rpc('reload', { tab: pane.id })
    await rpc('wait', { tab: pane.id, expression: "!!document.querySelector('bmux-device-bars')", timeout: 5000 })
    expect(await rpc('eval', { tab: pane.id, expression: "document.querySelectorAll('bmux-device-bars').length" })).toBe(1)
  }
  await rpc('profile.device.clear', { pane: pane.id, profile: pane.profileId })
  await rpc('wait', { tab: pane.id, expression: "document.readyState === 'complete' && !document.querySelector('bmux-device-bars')", timeout: 5000 })
})

for (let preset of ['iphone-15-pro', 'galaxy-s24']) test(`mobile safe areas ${preset} protect fixed headers and match painted surfaces`, async ({}, info) => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  await rpc('profile.device.set', { pane: pane.id, profile: pane.profileId, device: { preset, orientation: 'portrait', locale: 'en-US', timezone: 'UTC' } })
  await rpc('navigate', { tab: pane.id, url: `${url}/safe-area-cover-fixed` })
  await rpc('wait', { tab: pane.id, expression: "!!document.querySelector('bmux-device-bars')", timeout: 5000 })
  await rpc('eval', { tab: pane.id, expression: `
    document.querySelector('meta[name="theme-color"]').content = '#888888';
    document.body.innerHTML = '<header style="position:fixed;top:0;left:0;width:100%;height:48px;background:white;color:black">Video logo</header><main style="height:2000px;background:white"></main><footer style="position:fixed;bottom:0;left:0;width:100%;height:48px;background:white">Navigation</footer>';
  ` })
  let inspect = () => rpc('eval', { tab: pane.id, expression: `(() => {
    let bars = document.querySelector('bmux-device-bars').shadowRoot;
    return { top: document.querySelector('header').getBoundingClientRect().top, bottom: innerHeight - document.querySelector('footer').getBoundingClientRect().bottom, tint: getComputedStyle(bars.querySelector('.top')).backgroundColor, bottomTint: getComputedStyle(bars.querySelector('.bottom')).backgroundColor };
  })()` }) as Promise<any>
  await expect.poll(inspect).toEqual({ top: preset === 'iphone-15-pro' ? 59 : 40, bottom: preset === 'iphone-15-pro' ? 34 : 24, tint: 'rgb(255, 255, 255)', bottomTint: 'rgb(255, 255, 255)' })
  await rpc('eval', { tab: pane.id, expression: 'scrollTo(0, 300)' })
  await expect.poll(async () => (await inspect()).top).toBe(preset === 'iphone-15-pro' ? 59 : 40)
  await rpc('eval', { tab: pane.id, expression: `document.querySelector('header').style.top = '0px'` })
  await expect.poll(async () => (await inspect()).top).toBe(preset === 'iphone-15-pro' ? 59 : 40)
  await rpc('eval', { tab: pane.id, expression: `document.querySelector('header').style.top = 'env(safe-area-inset-top)'` })
  await expect.poll(async () => (await inspect()).top).toBe(preset === 'iphone-15-pro' ? 59 : 40)
  let windowId = (await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics'); String(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))).find(window => window.kCGWindowOwnerPID === ${application.process().pid} && window.kCGWindowLayer === 0).kCGWindowNumber);`])).stdout.trim()
  let screenshotPath = info.outputPath(`safe-area-fixed-${preset}.png`)
  // Device layout can settle before the native compositor presents the new surface.
  await expect(async () => {
    await promisify(execFile)('/usr/sbin/screencapture', ['-x', '-o', '-l', windowId, screenshotPath])
    let samples = await application.evaluate(({ BaseWindow, nativeImage }, { preset, url, screenshotPath }) => {
      let window = BaseWindow.getAllWindows().find(window => window.isVisible())!
      let view = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === `${url}/safe-area-cover-fixed`)!
      let bounds = view.getBounds(), image = nativeImage.createFromPath(screenshotPath), size = image.getSize(), pixels = image.toBitmap()
      let scale = size.width / window.getBounds().width
      let deviceScale = bounds.width / (preset === 'iphone-15-pro' ? 393 : 360)
      let pixel = (x: number, y: number) => {
        // Sample the nearest physical pixel; flooring can hit the antialiased
        // edge of a five-CSS-pixel indicator after the device is scaled down.
        let offset = (Math.round((bounds.y + y * deviceScale) * scale) * size.width + Math.round((bounds.x + x * deviceScale) * scale)) * 4
        return [...pixels.subarray(offset, offset + 3)]
      }
      let width = bounds.width / deviceScale, height = bounds.height / deviceScale
      return { home: pixel(width / 2, height - 10.5), top: pixel(width / 2, (preset === 'iphone-15-pro' ? 59 : 40) - 4), bottom: pixel(width / 4, height - (preset === 'iphone-15-pro' ? 34 : 24) / 2) }
    }, { preset, url, screenshotPath })
    expect(samples.home).toHaveLength(3)
    for (let channel of samples.home) expect(channel).toBeLessThan(40)
    for (let channel of [...samples.top, ...samples.bottom]) expect(channel).toBeGreaterThanOrEqual(254)
  }).toPass({ timeout: 5000 })

  await rpc('eval', { tab: pane.id, expression: `scrollTo(0,0); document.querySelector('header').style.cssText = 'position:sticky;top:0;height:48px;background:white'` })
  await rpc('eval', { tab: pane.id, expression: 'scrollTo(0,300)' })
  await expect.poll(async () => (await inspect()).top).toBe(preset === 'iphone-15-pro' ? 59 : 40)
  await rpc('profile.device.clear', { pane: pane.id, profile: pane.profileId })
})

for (let preset of ['iphone-15-pro-max', 'pixel-8']) test(`mobile safe areas ${preset} support Trusted Types and stable app bars`, async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let inset = preset === 'iphone-15-pro-max' ? 59 : 40, bottom = preset === 'iphone-15-pro-max' ? 34 : 24
  await rpc('profile.device.set', { pane: pane.id, profile: pane.profileId, device: { preset, orientation: 'portrait', locale: 'en-US', timezone: 'UTC' } })
  await rpc('navigate', { tab: pane.id, url: `${url}/safe-area-trusted` })
  await rpc('wait', { tab: pane.id, expression: "!!document.querySelector('bmux-device-bars')", timeout: 5000 })
  let inspect = () => rpc('eval', { tab: pane.id, expression: `(() => {
    let bars = document.querySelector('bmux-device-bars')?.shadowRoot, header = document.querySelector('header'), footer = document.querySelector('footer');
    return { top: header.getBoundingClientRect().top, offset: parseFloat(getComputedStyle(header).top), filters: document.querySelector('#filters').getBoundingClientRect().top, stickyOffset: parseFloat(getComputedStyle(document.querySelector('#sticky')).top), nestedTop: document.querySelector('#nested').getBoundingClientRect().top, bottom: innerHeight - footer.getBoundingClientRect().bottom, tint: bars && getComputedStyle(bars.querySelector('.top')).backgroundColor, bottomTint: bars && getComputedStyle(bars.querySelector('.bottom')).backgroundColor, icons: bars?.querySelector('svg')?.children.length };
  })()` }) as Promise<any>
  await expect.poll(inspect).toEqual({ top: inset, offset: inset, filters: inset + 48, stickyOffset: inset, nestedTop: inset, bottom, tint: 'rgb(255, 255, 255)', bottomTint: 'rgb(255, 255, 255)', icons: 4 })
  // Unrelated site updates during a bar transition must not add interpolated gaps.
  for (let revision of [1, 2, 3, 4]) {
    await rpc('eval', { tab: pane.id, expression: `document.querySelector('main').className = 'revision-${revision}'` })
    await expect.poll(async () => { let result = await inspect(); return { top: result.top, filters: result.filters, bottom: result.bottom } }).toEqual({ top: inset, filters: inset + 48, bottom })
  }
  // A site's reveal/hide transform must not be fed back into the safe offset.
  for (let translate of [12, -20, -48, 0]) {
    await rpc('eval', { tab: pane.id, expression: `document.querySelector('header').style.transform = 'translateY(${translate}px)'; scrollTo(0,${300 + translate})` })
    // A fully covering site header supplies the safe-area paint itself.
    let tint = inset + translate <= 0 && translate + 48 >= 0 ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 255, 255)'
    await expect.poll(async () => { let result = await inspect(); return { top: result.top, nestedTop: result.nestedTop, offset: result.offset, tint: result.tint } }).toEqual({ top: inset + translate, nestedTop: inset + translate, offset: inset, tint })
  }
  await expect.poll(() => rpc('eval', { tab: pane.id, expression: "document.querySelector('#sticky').getBoundingClientRect().top" })).toBe(inset)
  // Native safe padding already reserves space for bottom navigation controls.
  await rpc('eval', { tab: pane.id, expression: "document.querySelector('footer').style.cssText = 'bottom:0;padding-bottom:env(safe-area-inset-bottom);background:rgba(15,15,15,.7);backdrop-filter:blur(24px)'" })
  await expect.poll(async () => (await inspect()).bottom).toBe(0)
  await expect.poll(() => rpc('eval', { tab: pane.id, expression: `(() => {
    let bottom = document.querySelector('bmux-device-bars').shadowRoot.querySelector('.bottom'), footer = document.querySelector('footer');
    return { background: getComputedStyle(bottom).backgroundColor, blur: getComputedStyle(bottom).backdropFilter, siteBlur: getComputedStyle(footer).backdropFilter, home: getComputedStyle(bottom.querySelector('.home')).backgroundColor };
  })()` })).toEqual({ background: 'rgba(0, 0, 0, 0)', blur: 'none', siteBlur: 'blur(24px)', home: 'rgb(255, 255, 255)' })
  // Site DOM cleanup must not permanently remove the emulated system bars.
  await rpc('eval', { tab: pane.id, expression: "document.querySelector('bmux-device-bars').remove()" })
  await expect.poll(async () => (await inspect()).icons).toBe(4)
  await rpc('profile.device.clear', { pane: pane.id, profile: pane.profileId })
})
