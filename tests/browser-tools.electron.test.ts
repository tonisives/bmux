import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { stringify } from 'yaml'

let directory: string, application: ElectronApplication, chrome: Page, page: Page, url: string, server: http.Server, tabId: string
let adRequests = 0
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let command = async (line: string) => {
  await activate()
  await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
  let prompt = chrome.getByRole('combobox', { name: 'Command', exact: true })
  await prompt.fill(line); await prompt.press('Enter'); await activate()
}
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-browser-tools-'))
  server = http.createServer((request, response) => {
    if (request.url?.startsWith('/bmux-ad.js')) { adRequests++; response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('window.adLoaded = true'); return }
    response.writeHead(200, { 'Content-Type': 'text/html', ...(request.url?.startsWith('/strict') ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'nonce-fixture'; style-src 'nonce-fixture'" } : {}) })
    response.end(`<!doctype html><html><head><title>Browser tools fixture</title><script nonce="fixture">window.startObserved = window.earlyFlag || 'missing'</script><style nonce="fixture">body{background:white;color:black;font:20px sans-serif;padding:24px}input{display:block;margin:8px}.bmux-ad{height:50px;background:red}</style></head><body><h1>Browser tools fixture</h1><div class="bmux-ad">Advertisement</div><p class="custom">Custom style</p><form><label>Name<input id="name" autocomplete="name"></label><label>Email<input id="email" type="email"></label><input type="password" id="password"><input id="cc-number" autocomplete="cc-number"><input id="hidden" type="hidden"><button type="button">Continue</button></form><script src="/bmux-ad.js?private-query=fixture"></script></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'early.js'), "globalThis.earlyFlag = 'before-inline'")
  await fs.writeFile(path.join(directory, 'style.css'), '.custom { color: rgb(120, 20, 30) !important }')
  await fs.writeFile(path.join(directory, 'config.yaml'), '# Preserve this comment\n' + stringify({ keyboard: {}, browser: { autoUpdateFilters: false, rules: ['/bmux-ad.js$script', '127.0.0.1##.bmux-ad'], userscripts: [
    { id: 'early', file: './early.js', enabled: true, runAt: 'document-start', matches: [`${url}/*`], exclude: [`${url}/excluded*`], profiles: ['profile_default'] },
    { id: 'style', file: './style.css', enabled: true, matches: [`${url}/*`] },
  ] } }))
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await activate()
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(`${url}/fixture`); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === `${url}/fixture`)).toBe(true)
  page = application.context().pages().find(page => page.url() === `${url}/fixture`)!
  tabId = (await state()).model.sessions[0].windows[0].panes[0].activeTabId
  await expect(page.locator('h1')).toBeVisible()
})
test.afterAll(async () => { await application?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }) })
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return
  let current = await state().catch(() => undefined)
  console.error('BROWSER_TOOLS_FAILURE', { focusedClientId: current?.focusedClientId, runs: current?.pluginRuns?.map((run: any) => ({ pluginId: run.pluginId, status: run.status, error: run.error })) })
})

test('blocks requests before they reach the server and runs scripts before page JavaScript', async () => {
  expect(await page.evaluate(() => (window as any).startObserved)).toBe('before-inline')
  expect(await page.evaluate(() => (window as any).adLoaded)).toBeUndefined()
  expect(adRequests).toBe(0)
  await expect(page.locator('.bmux-ad')).toBeHidden()
  await expect(page.locator('.custom')).toHaveCSS('color', 'rgb(120, 20, 30)')
  let tools = (await state()).browserTools
  expect(tools.filters.network).toBeGreaterThan(10000)
  expect(tools.tabs[tabId].blocked).toBeGreaterThan(0)
  expect(JSON.stringify(tools)).not.toContain('private-query')
  expect(await page.evaluate(() => ['process', 'require', 'bmux'].map(key => typeof (window as any)[key]))).toEqual(['undefined', 'undefined', 'undefined'])
})

test('plugin screen shows live tool status and opens blocking configuration', async () => {
  await command('plugins')
  let panel = chrome.getByRole('dialog', { name: 'Plugins', exact: true })
  let status = panel.getByRole('region', { name: 'Tools status' })
  await expect(status).toContainText('requests blocked since navigation')
  await expect(status).toContainText('Ready')
  await status.getByRole('button', { name: 'Configure browser tools' }).click()
  let tools = chrome.getByRole('dialog', { name: 'Browser tools', exact: true })
  await tools.getByRole('button', { name: 'Ad and tracker blocking: on', exact: true }).click()
  await expect(tools.getByRole('button', { name: 'Ad and tracker blocking: off', exact: true })).toBeVisible()
  await expect(tools.getByRole('region', { name: 'Tools status' })).toContainText('Off')
  await tools.getByRole('button', { name: 'Ad and tracker blocking: off', exact: true }).click()
  await tools.getByRole('button', { name: 'Close', exact: true }).click()
})

test('settings tabs change preferences without editing YAML', async () => {
  await command('settings')
  let panel = chrome.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(panel.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel).not.toContainText('Set a binding to null')
  await expect(panel.getByRole('tabpanel', { name: 'General' })).toContainText('Lets screen readers and other accessibility tools inspect page controls.')
  let bounds = await panel.boundingBox()
  let tabBounds = await panel.getByRole('tab', { name: 'Appearance' }).boundingBox()
  expect(bounds).not.toBeNull()
  expect(tabBounds).not.toBeNull()
  let expectStableBounds = async () => {
    let next = await panel.boundingBox()
    let nextTab = await panel.getByRole('tab', { name: 'Appearance' }).boundingBox()
    expect(next?.height).toBe(bounds?.height)
    expect(next?.y).toBe(bounds?.y)
    expect(nextTab?.y).toBe(tabBounds?.y)
  }
  await panel.getByRole('checkbox', { name: 'Accessibility' }).click()
  await expect.poll(async () => (await state()).accessibility).toBe(true)
  await expect(panel.getByRole('checkbox', { name: 'Accessibility' })).toBeChecked()
  await panel.getByRole('tab', { name: 'General' }).press('ArrowRight')
  await expect(panel.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
  await expectStableBounds()
  await expect(panel.getByRole('region', { name: 'Browser layout' }).getByRole('combobox', { name: 'Status bar' })).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Click mode' }).getByRole('checkbox', { name: 'Enabled' })).toBeVisible()
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
  await chrome.screenshot({ path: path.resolve('artifacts/settings-panel.png') })
  await panel.getByRole('combobox', { name: 'Status bar' }).selectOption('bottom')
  await expect.poll(async () => (await state()).statusBar).toBe('bottom')
  await panel.getByRole('checkbox', { name: 'Tab close buttons' }).click()
  await expect.poll(async () => (await state()).showTabCloseButtons).toBe(true)
  await panel.getByRole('checkbox', { name: 'Tab close buttons' }).click()
  await expect.poll(async () => (await state()).showTabCloseButtons).toBe(false)
  await panel.getByRole('combobox', { name: 'Status bar' }).selectOption('top')
  await expect.poll(async () => (await state()).statusBar).toBe('top')
  await panel.getByRole('tab', { name: 'Browser tools' }).click()
  await expectStableBounds()
  await expect(panel.getByRole('combobox', { name: 'Website dark mode' })).toBeVisible()
  await panel.getByRole('tab', { name: 'Plugins' }).click()
  await expectStableBounds()
  await expect(panel.getByRole('checkbox').first()).toBeVisible()
  await panel.getByRole('tab', { name: 'General' }).click()
  await panel.getByRole('checkbox', { name: 'Accessibility' }).click()
  await expect.poll(async () => (await state()).accessibility).toBe(false)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  let config = await fs.readFile(path.join(directory, 'config.yaml'), 'utf8')
  expect(config).toContain('# Preserve this comment')
  expect(config).toContain('accessibility: false')
})

test('dark mode renders on the native page and site settings persist without changing selection', async () => {
  await command('browser-tools')
  let panel = chrome.getByRole('dialog', { name: 'Browser tools', exact: true })
  await expect(panel).toBeVisible()
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
  await chrome.screenshot({ path: path.resolve('artifacts/browser-tools-panel.png') })
  await panel.getByLabel('Website dark mode').selectOption('dark')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('style.darkreader').length)).toBeGreaterThan(0)
  await expect.poll(() => page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgb(255, 255, 255)')
  await activate()
  await expect.poll(() => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.some(view => 'webContents' in view && (view as any).webContents.getURL() === url && view.getBounds().height > 300)), `${url}/fixture`)).toBe(true)
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
  await page.screenshot({ path: path.resolve('artifacts/browser-tools-dark.png') })
  let before = (await state()).model.clients
  await rpc('browser.set', { tab: tabId, setting: 'darkMode', value: 'off' })
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('style.darkreader').length)).toBe(0)
  expect((await state()).model.clients).toEqual(before)
  let config = await fs.readFile(path.join(directory, 'config.yaml'), 'utf8')
  expect(config).toContain('# Preserve this comment')
  expect(config).toContain('darkMode: off')
  await rpc('browser.set', { tab: tabId, setting: 'darkMode', value: 'dark', scope: 'profile' })
  await command('browser-tools')
  await panel.getByLabel('Apply changes to').selectOption('profile')
  await expect(panel.getByLabel('Website dark mode')).toHaveValue('dark')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await panel.getByLabel('Website dark mode').selectOption('off')
  await panel.getByLabel('Apply changes to').selectOption('site')
  await expect(panel.getByLabel('Website dark mode')).toHaveValue('off')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
})

test('dark mode and cosmetic hiding work with a strict page CSP', async () => {
  await rpc('browser.set', { tab: tabId, setting: 'darkMode', value: 'dark' })
  await rpc('navigate', { tab: tabId, url: `${url}/strict` })
  await expect.poll(() => page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgb(255, 255, 255)')
  await expect(page.locator('.bmux-ad')).toBeHidden()
  await expect(page.locator('.custom')).toHaveCSS('color', 'rgb(120, 20, 30)')
  expect(await page.evaluate(() => {
    let script = document.createElement('script'); script.textContent = 'globalThis.cspEscaped = true'; document.head.append(script)
    return (window as any).cspEscaped
  })).toBeUndefined()
  await rpc('browser.set', { tab: tabId, setting: 'darkMode', value: 'off' })
})

test('request exceptions are profile scoped; userscript changes and exclusions reload', async () => {
  await rpc('browser.set', { tab: tabId, setting: 'adblock', value: false })
  await rpc('navigate', { tab: tabId, url: `${url}/fixture` })
  await expect.poll(() => page.evaluate(() => (window as any).adLoaded)).toBe(true)
  await expect(page.locator('.bmux-ad')).toBeVisible()
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let bot = await rpc('split-window', { pane: pane.id, profile: 'bot', url: `${url}/bot` })
  await rpc('wait', { tab: bot.activeTabId, selector: 'h1' })
  expect(await rpc('eval', { tab: bot.activeTabId, expression: 'window.startObserved' })).toBe('missing')
  expect(await rpc('eval', { tab: bot.activeTabId, expression: '!!window.adLoaded' })).toBe(false)
  await fs.writeFile(path.join(directory, 'style.css'), '.custom { color: rgb(10, 100, 30) !important }')
  await expect(page.locator('.custom')).toHaveCSS('color', 'rgb(10, 100, 30)')
  await fs.writeFile(path.join(directory, 'early.js'), "globalThis.earlyFlag = 'changed'")
  await rpc('browser.reload-scripts')
  await rpc('navigate', { tab: tabId, url: `${url}/fixture` })
  expect(await page.evaluate(() => (window as any).startObserved)).toBe('changed')
  await rpc('navigate', { tab: tabId, url: `${url}/excluded` })
  expect(await page.evaluate(() => (window as any).startObserved)).toBe('missing')
  await rpc('browser.script', { id: 'early', enabled: false })
  await rpc('navigate', { tab: tabId, url: `${url}/fixture` })
  expect(await page.evaluate(() => (window as any).startObserved)).toBe('missing')
  await rpc('select-pane', { client: current.clientId, pane: pane.id })
})

test('bundled form actions save encrypted data and reject profile, document, and field changes', async () => {
  await page.evaluate(() => { let input = document.createElement('input'); input.setAttribute('aria-label', 'One time code'); input.value = 'fixture-code'; document.body.append(input) })
  await page.locator('#name').fill('Disposable Name'); await page.locator('#email').fill('fixture@example.test')
  await page.locator('#password').fill('disposable-password'); await page.locator('#cc-number').fill('4111111111111111')
  await command('save-fill')
  let name = chrome.getByRole('textbox', { name: 'Name this saved form', exact: true })
  await expect(name).toBeVisible(); await name.fill('Fixture form'); await activate(); await name.press('Enter')
  await expect.poll(async () => (await rpc('forms.list', { tab: tabId })).length).toBe(1)
  let form = (await rpc('forms.list', { tab: tabId }))[0]
  expect(form.fields).toBe(2)
  let bytes = await fs.readFile(path.join(directory, 'saved-forms', 'profile_default.bin'))
  expect(bytes.includes(Buffer.from('Disposable Name'))).toBe(false)
  expect(JSON.stringify(await state())).not.toContain('disposable-password')
  await page.locator('#name').fill(''); await page.locator('#email').fill('')
  await command('fill')
  let picker = chrome.getByRole('textbox', { name: 'Choose a saved form', exact: true })
  await expect(picker).toBeVisible(); await activate(); await picker.press('Enter')
  await expect(page.locator('#name')).toHaveValue('Disposable Name')
  await expect(page.locator('#email')).toHaveValue('fixture@example.test')
  let current = await state(), bot = current.model.sessions[0].windows[0].panes.find((pane: any) => pane.profileId === 'profile_bot')
  if (!bot) {
    let pane = current.model.sessions[0].windows[0].panes[0]
    bot = await rpc('split-window', { pane: pane.id, profile: 'bot', url: `${url}/bot` })
    await rpc('wait', { tab: bot.activeTabId, selector: 'h1' })
    await rpc('select-pane', { client: current.clientId, pane: pane.id })
  }
  expect(await rpc('forms.list', { tab: bot.activeTabId })).toEqual([])
  await expect(rpc('forms.fill', { tab: bot.activeTabId, id: form.id })).rejects.toThrow('not found')
  await page.locator('#name').evaluate(node => node.setAttribute('type', 'password'))
  await expect(rpc('forms.fill', { tab: tabId, id: form.id })).rejects.toThrow()
  await rpc('navigate', { tab: tabId, url: `${url.replace('127.0.0.1', 'localhost')}/fixture` })
  expect(await rpc('forms.list', { tab: tabId })).toEqual([])
  await rpc('navigate', { tab: tabId, url: `${url}/fixture` })
  await rpc('forms.delete', { tab: tabId, id: form.id })
  expect(await rpc('forms.list', { tab: tabId })).toEqual([])
})

test('filter updates compile off-thread and retain working filters after a failed download', async () => {
  await application.evaluate(() => {
    let runtime = globalThis as any
    runtime.fixtureOriginalFetch = runtime.fetch
    runtime.fetch = async () => new Response('[Adblock Plus 2.0]\n||updated.example.test^\n' + '! fixture padding\n'.repeat(1000))
  })
  try {
    let before = (await rpc('browser.status')).filters.updatedAt
    await rpc('browser.update-filters')
    await expect.poll(async () => (await rpc('browser.status')).filters.updating, { timeout: 15000 }).toBe(false)
    let updated = (await rpc('browser.status')).filters
    expect(updated.error).toBeUndefined(); expect(updated.updatedAt).toBeGreaterThan(before); expect(updated.network).toBeGreaterThan(0)
    expect(await fs.stat(path.join(directory, 'filters/adblock.bin.gz'))).toBeTruthy()
    await application.evaluate(() => { (globalThis as any).fetch = async () => new Response('Unavailable', { status: 503 }) })
    await rpc('browser.update-filters')
    await expect.poll(async () => (await rpc('browser.status')).filters.updating).toBe(false)
    let failed = (await rpc('browser.status')).filters
    expect(failed.error).toContain('Keeping the last working lists'); expect(failed.updatedAt).toBe(updated.updatedAt)
  } finally { await application.evaluate(() => { let runtime = globalThis as any; runtime.fetch = runtime.fixtureOriginalFetch; delete runtime.fixtureOriginalFetch }) }
})
