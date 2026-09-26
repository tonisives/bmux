import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { stringify } from 'yaml'
import { Server as ProxyServer } from 'proxy-chain'

let directory: string, application: ElectronApplication, chrome: Page, page: Page, url: string, server: http.Server, proxy: ProxyServer, proxyRequests = 0
let identityRequests = new Map<string, http.IncomingHttpHeaders>()
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let prompt = () => chrome.getByRole('combobox', { name: 'Command', exact: true })
let open = async () => { await activate(); await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click(); await expect(prompt()).toBeFocused() }
let openProfilePanel = async (profile: string) => {
  let panel = chrome.getByRole('dialog', { name: 'Profile', exact: true })
  let details = panel.getByRole('region', { name: `${profile} profile details`, exact: true })
  if (!await details.isVisible()) {
    if (await panel.isVisible()) await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await chrome.getByRole('button', { name: `Profile: ${profile}`, exact: true }).click()
  }
  await expect(details).toBeVisible()
  return panel
}
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
    let deviceIndex = request.url?.indexOf('/device-') ?? -1
    if (request.url && deviceIndex >= 0) {
      identityRequests.set(request.url.slice(deviceIndex), request.headers)
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Device fixture</title><h1>Device fixture</h1><a href="/device-popup" target="_blank">Open device popup</a>')
      return
    }
    if (request.url === '/ip') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ip: '203.0.113.9', city: 'Amsterdam', region: 'North Holland', country: 'Netherlands' })); return }
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Command search fixture</title><style>body{background:#e8eef8;color:#173353;font:24px sans-serif;padding:32px}</style><h1>Command search fixture</h1><p>A visible native page behind the command finder.</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}/fixture`
  proxy = new ProxyServer({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => { proxyRequests++; return { requestAuthentication: request.username !== 'fixture-user' || request.password !== 'fixture-password' } } })
  proxy.on('requestFailed', () => undefined); await proxy.listen()
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_PROXY_TEST_URL: `http://127.0.0.1:${(server.address() as any).port}/ip` } })
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
  await chrome.keyboard.press('Escape'); await chrome.keyboard.press('Escape')
  let current = await state(); await rpc('select-window', { client: current.clientId, window: current.model.sessions[0].windows[0].id }); await activate()
})
test.afterAll(async () => { await application?.close(); await proxy?.close(true); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (directory) await fs.rm(directory, { recursive: true, force: true }) })

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

test('enabled plugin actions appear in fuzzy command results and execute', async () => {
  await open(); await prompt().fill('fixture greeting')
  await expect(chrome.getByRole('option', { selected: true })).toContainText('plugin run fixture/greet')
  await expect(chrome.getByRole('option', { selected: true })).toContainText('Cmd+Alt+P')
  await prompt().press('Enter')
  await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.pluginId === 'fixture')?.status).toBe('completed')
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

test('pane profile route uses icons only for a profile that differs from the session default', async () => {
  let current = await state(), client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)!
  let session = current.model.sessions.find((item: { id: string }) => item.id === client.sessionId)!
  let defaultProfile = current.model.profiles.find((item: { id: string }) => item.id === session.defaultProfileId)!
  await expect(chrome.getByRole('button', { name: `Profile ${defaultProfile.name}, desktop`, exact: true })).toHaveCount(0)
  let customProfile = current.model.profiles.find((item: { id: string }) => item.id !== session.defaultProfileId)!
  let pane = await rpc('split-window', { pane: client.paneId, profile: customProfile.id, client: client.id })
  let route = chrome.getByRole('button', { name: `Profile ${customProfile.name}, desktop`, exact: true })
  try {
    await expect(route).toBeVisible()
    await expect(route.locator(':scope > svg')).toHaveCount(2)
    await expect(route.locator('[data-profile-avatar]')).toHaveCount(1)
    await expect(route.locator('[data-profile-route-icon]')).toHaveCount(1)
  } finally {
    await rpc('kill-pane', { pane: (pane as { id: string }).id, confirm: true })
  }
})

test('profile proxy settings route, test, and restore the selected profile connection', async () => {
  let current = await state(), profile = current.model.profiles[0]
  let panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Connection' }).click()
  await panel.getByLabel('Provider', { exact: true }).selectOption('bmux.nordvpn/nordvpn')
  await expect(panel.getByLabel('Region', { exact: true })).toBeVisible()
  await panel.getByLabel('Region', { exact: true }).selectOption('sg640.proxy.nordvpn.com')
  await expect(panel).toContainText('Uses HTTPS proxy on port 89')
  await panel.getByLabel('Provider', { exact: true }).selectOption('custom')
  await expect(panel.getByLabel('Protocol', { exact: true })).toHaveValue('https')
  await expect(panel.getByLabel('Host', { exact: true })).toHaveValue('sg640.proxy.nordvpn.com')
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
  let before = proxyRequests
  await panel.getByRole('button', { name: 'Save proxy', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].proxy?.host).toBe('127.0.0.1')
  await expect.poll(() => proxyRequests).toBeGreaterThan(before)
  await expect(chrome.getByRole('button', { name: `Profile ${profile.name}, desktop, proxy connection`, exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('Exit IP203.0.113.9')
  await expect(panel.getByRole('status').locator('svg')).toBeVisible()
  await expect.poll(async () => (await state()).profileProxyTests[profile.id]?.ip).toBe('203.0.113.9')
  let profileButton = chrome.getByRole('button', { name: `Profile: ${profile.name}`, exact: true })
  await expect(profileButton.locator('[data-proxy-verified="true"]')).toHaveCount(0)
  await panel.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => {
    let panelBox = (await panel.boundingBox())!, headerBox = (await panel.locator(':scope > header').boundingBox())!
    return headerBox.y - panelBox.y
  }).toBeLessThanOrEqual(2)
  await expect(panel.getByRole('button', { name: 'Close', exact: true }).locator('svg')).toBeVisible()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
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
      for (let name of ['Save proxy', 'Test connection', 'Use system connection']) await expect(proxyPanel.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
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
  let customPane = await rpc('split-window', { pane: verificationPane.id, profile: profile.id, client: verificationClient.id }) as { id: string }
  let route = chrome.getByRole('button', { name: `Profile ${profile.name}, desktop`, exact: true })
  await expect(route).toBeVisible()
  let paneProxyButton = chrome.getByRole('button', { name: `Proxy for ${profile.name}, verified`, exact: true })
  await expect(paneProxyButton.locator('[data-proxy-verified="true"]')).toBeVisible()
  await expect(paneProxyButton).toHaveAttribute('title', /Exit IP: 203\.0\.113\.9/)
  await paneProxyButton.click()
  await expect(chrome.getByRole('dialog', { name: 'Proxy', exact: true }).getByRole('status')).toContainText('North Holland')
  await chrome.getByRole('dialog', { name: 'Proxy', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await rpc('kill-pane', { pane: customPane.id, confirm: true })
  await rpc('kill-session', { session: verificationSession.id, confirm: true })
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Connection' }).click()
  await panel.getByRole('button', { name: 'Use system connection', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].proxy).toBeUndefined()
  await expect.poll(async () => (await state()).profileProxyTests[profile.id]).toBeUndefined()
  await expect(proxyButton).toHaveCount(0)
  await expect(chrome.getByRole('button', { name: `Profile ${profile.name}, desktop`, exact: true })).toHaveCount(0)
  await rpc('plugin.enable', { id: 'bmux.nordvpn', enabled: false })
  await expect.poll(async () => (await state()).plugins.find((plugin: { id: string }) => plugin.id === 'bmux.nordvpn')?.enabled).toBe(false)
  await expect(panel.getByLabel('Provider', { exact: true }).getByRole('option', { name: 'NordVPN', exact: true })).toHaveCount(0)
  await rpc('plugin.enable', { id: 'bmux.nordvpn', enabled: true })
  await expect.poll(async () => (await state()).plugins.find((plugin: { id: string }) => plugin.id === 'bmux.nordvpn')?.enabled).toBe(true)
  await expect(panel.getByLabel('Provider', { exact: true }).getByRole('option', { name: 'NordVPN', exact: true })).toHaveCount(1)
})

test('profile device identity is applied before requests and cache status is public', async () => {
  let current = await state(), profile = current.model.profiles[0]
  let panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByLabel('Device', { exact: true }).selectOption('pixel-8')
  await panel.getByLabel('Locale', { exact: true }).fill('fr-FR')
  await panel.getByLabel('Timezone', { exact: true }).fill('Europe/Paris')
  await panel.getByRole('button', { name: 'Apply device', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].device?.preset).toBe('pixel-8')
  await expect(chrome.getByRole('button', { name: `Profile ${profile.name}, Pixel 8, system connection`, exact: true })).toHaveCount(0)
  current = await state()
  let tab = current.model.sessions[0].windows[0].panes[0].id
  await rpc('navigate', { tab, url: `${url}/device-android` })
  await expect.poll(() => identityRequests.get('/device-android')?.['user-agent']).toContain('Android 10')
  expect(identityRequests.get('/device-android')?.['accept-language']).toContain('fr-FR')
  await expect.poll(() => rpc('eval', { tab, expression: '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints,cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory,locale:Intl.DateTimeFormat().resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,uaPlatform:navigator.userAgentData?.platform,uaMobile:navigator.userAgentData?.mobile})' })).toEqual({ width: 412, height: 915, dpr: 2.625, touch: 5, cores: 8, memory: 8, locale: 'fr-FR', timezone: 'Europe/Paris', uaPlatform: 'Android', uaMobile: true })
  await expect.poll(async () => (await state()).profileCaches[profile.id]?.limit).toBe(256 * 1024 * 1024)
  await panel.getByRole('tab', { name: 'Overview' }).click()
  await expect(panel.getByText(/MiB of 256 MiB/)).toBeVisible()
  await panel.getByRole('button', { name: 'Clear HTTP cache', exact: true }).click()

  await panel.getByRole('tab', { name: 'Device' }).click()
  await expect.poll(async () => (await state()).profileCaches[profile.id]?.bytes).toBe(0)

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
  await panel.getByRole('heading', { name: 'Device', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
  await chrome.screenshot({ path: path.resolve('artifacts/profile-device-controls.png') })
  await panel.getByRole('button', { name: 'Apply device', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].device?.orientation).toBe('landscape')
  expect((await state()).model.profiles[1].device).toBeUndefined()
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')).profiles[0].device?.geolocation).toEqual({ latitude: 48.8566, longitude: 2.3522, accuracy: 12 })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  let contentBounds = await chrome.locator(`[data-browser-content][data-content-pane-id="${tab}"]`).boundingBox()
  await expect.poll(() => application.evaluate(({ BaseWindow }, path) => {
    for (let window of BaseWindow.getAllWindows()) for (let view of window.contentView.children) if ('webContents' in view && (view as any).webContents.getURL().includes(path)) return view.getBounds()
  }, '/device-android')).toMatchObject({ width: 800, height: 400 })
  let nativeBounds = await application.evaluate(({ BaseWindow }, path) => {
    for (let window of BaseWindow.getAllWindows()) for (let view of window.contentView.children) if ('webContents' in view && (view as any).webContents.getURL().includes(path)) return view.getBounds()
  }, '/device-android')
  expect(Math.abs(nativeBounds!.x + nativeBounds!.width / 2 - (contentBounds!.x + contentBounds!.width / 2))).toBeLessThanOrEqual(1)
  expect(Math.abs(nativeBounds!.y + nativeBounds!.height / 2 - (contentBounds!.y + contentBounds!.height / 2))).toBeLessThanOrEqual(1)
  let geolocation = rpc('eval', { tab, expression: 'new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}), error => reject(new Error(error.message))))' })
  let permission: any
  await expect.poll(async () => { permission = (await rpc('permission.list') as any[]).find(item => item.permission === 'geolocation'); return !!permission }).toBe(true)
  await rpc('permission.respond', { id: permission.id, allow: true })
  expect(await geolocation).toEqual({ latitude: 48.8566, longitude: 2.3522, accuracy: 12 })
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByLabel('Device', { exact: true }).selectOption('iphone-15-pro')
  await panel.getByRole('button', { name: 'Apply device', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].device?.preset).toBe('iphone-15-pro')
  await expect.poll(() => identityRequests.get('/device-android')?.['user-agent']).toContain('CPU iPhone OS 18_6_2')
  await rpc('navigate', { tab, url: `${url}/device-ios` })
  await expect.poll(() => identityRequests.get('/device-ios')?.['user-agent']).toContain('CPU iPhone OS 18_6_2')
  expect(identityRequests.get('/device-ios')?.['user-agent']).toContain('Version/27.0')
  expect(identityRequests.get('/device-ios')?.['sec-ch-ua']).toBeUndefined()
  expect(await rpc('eval', { tab, expression: '({cores:navigator.hardwareConcurrency,hasMemory:"deviceMemory" in navigator,memory:navigator.deviceMemory})' })).toEqual({ cores: 6, hasMemory: false })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  let windowsBeforePopup = (await state()).model.sessions[0].windows.length
  await rpc('eval', { tab, expression: `window.open(${JSON.stringify(`${url}/device-popup`)}, '_blank'); true` })
  await expect.poll(() => identityRequests.get('/device-popup')?.['user-agent']).toContain('CPU iPhone OS 18_6_2')
  expect(identityRequests.get('/device-popup')?.['sec-ch-ua']).toBeUndefined()
  chrome = application.context().pages().find(candidate => candidate.url().endsWith('/renderer/index.html'))!
  await expect.poll(async () => (await state()).model.sessions[0].windows.length).toBe(windowsBeforePopup + 1)
  panel = await openProfilePanel(profile.name)
  await panel.getByRole('tab', { name: 'Device' }).click()
  await panel.getByRole('button', { name: 'Use desktop', exact: true }).click()
  await expect.poll(async () => (await state()).model.profiles[0].device).toBeUndefined()
})
