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
let vaultPrompt = async (name: string) => {
  let input = chrome.getByRole('textbox', { name, exact: true })
  // Separate instances of the installed app can lose foreground status on macOS.
  // Explicitly activate this test client while waiting for its guarded prompt.
  await expect.poll(async () => { await activate(); return input.isVisible() }).toBe(true)
  return input
}
let expectVaultPassword = async () => {
  await expect.poll(async () => { await activate(); return page.locator('#vault-password').inputValue() }).toBe('fixture-vault-password')
}
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-browser-tools-'))
  server = http.createServer((request, response) => {
    if (request.url?.startsWith('/bmux-ad.js')) { adRequests++; response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('window.adLoaded = true'); return }
    if (request.url?.startsWith('/vault-')) {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      let password = '<label>Password<input id="vault-password" type="password" autocomplete="current-password"></label><button type="submit">Log in</button>'
      let initial = request.url.startsWith('/vault-password') ? password : '<label>Phone, email, or username<input id="vault-user" autocomplete="username"></label><button type="button" id="next">Next</button>'
      let action = request.url.startsWith('/vault-user-nav') ? "location.href = '/vault-password'" : 'document.querySelector("form").innerHTML = ' + JSON.stringify(password)
      response.end('<!doctype html><html><head><title>Two-step login</title></head><body><h1>Login fixture</h1><form>' + initial + '</form><script>window.submitted=false;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submitted=true};document.querySelector("#next")?.addEventListener("click",()=>{' + action + '})</script></body></html>')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html', ...(request.url?.startsWith('/strict') ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'nonce-fixture'; style-src 'nonce-fixture'" } : {}) })
    response.end(`<!doctype html><html><head><title>Browser tools fixture</title><script nonce="fixture">window.startObserved = window.earlyFlag || 'missing'</script><style nonce="fixture">body{background:white;color:black;font:20px sans-serif;padding:24px}input{display:block;margin:8px}.bmux-ad{height:50px;background:red}</style></head><body><h1>Browser tools fixture</h1><div class="bmux-ad">Advertisement</div><p class="custom">Custom style</p><form><label>Name<input id="name" autocomplete="name"></label><label>Email<input id="email" type="email"></label><input type="password" id="password"><input id="cc-number" autocomplete="cc-number"><input id="hidden" type="hidden"><button type="button">Continue</button></form><script src="/bmux-ad.js?private-query=fixture"></script></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'early.js'), "globalThis.earlyFlag = 'before-inline'")
  await fs.writeFile(path.join(directory, 'style.css'), '.custom { color: rgb(120, 20, 30) !important }')
  let vault = path.join(directory, 'bw-fixture')
  await fs.writeFile(vault, `#!${process.execPath}
let args = process.argv.slice(2), origin = args[args.indexOf('--url') + 1];
if (args.includes('fixture-master') || args.includes('fixture-session') || process.env.BMUX_PLUGIN_TOKEN) process.exit(2);
if (args[0] === 'status') process.stdout.write(JSON.stringify({ status: process.env.BW_SESSION === 'fixture-session' ? 'unlocked' : 'locked' }));
else if (args[0] === 'unlock') { if (process.env.BMUX_VAULT_PASSWORD !== 'fixture-master') process.exit(2); process.stdout.write('fixture-session'); }
else if (args[0] === 'list') { if (process.env.BW_SESSION !== 'fixture-session') process.exit(2); process.stdout.write(JSON.stringify([{id:'fixture-login',type:1,name:'Fixture vault login',login:{username:'vault@example.test',password:'fixture-vault-password',uris:[{uri:origin+'/login'}]}},{id:'other',type:1,name:'Different origin',login:{password:'excluded',uris:[{uri:'https://unrelated.example.test'}]}}])); }
`, { mode: 0o700 })
  await fs.writeFile(path.join(directory, 'config.yaml'), '# Preserve this comment\n' + stringify({ keyboard: {}, browser: { autoUpdateFilters: false, rules: ['/bmux-ad.js$script', '127.0.0.1##.bmux-ad'], userscripts: [
    { id: 'early', file: './early.js', enabled: true, runAt: 'document-start', matches: [`${url}/*`], exclude: [`${url}/excluded*`], profiles: ['profile_default'] },
    { id: 'style', file: './style.css', enabled: true, matches: [`${url}/*`] },
  ] } }))
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  application = await electron.launch({ ...(installed ? { executablePath: path.join(os.homedir(), 'workspace/_tools/bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_BITWARDEN_CLI: vault, BITWARDENCLI_APPDATA_DIR: path.join(directory, 'vault'), BW_SESSION: '' } })
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

test('Bitwarden action unlocks privately and fills only the selected exact-origin login', async () => {
  await page.locator('#password').fill('')
  await rpc('plugin.enable', { id: 'bmux.bitwarden', enabled: true })
  await command('passwords')
  let unlock = await vaultPrompt('Unlock Bitwarden')
  await unlock.fill('fixture-master'); await activate(); await unlock.press('Enter')
  let picker = await vaultPrompt(`Login for ${url}`)
  await expect(chrome.getByRole('button', { name: 'Different origin', exact: true })).toHaveCount(0)
  await activate(); await picker.press('Enter')
  await expect(chrome.getByText('Fill this login over unencrypted HTTP?', { exact: true })).toBeVisible()
  await activate()
  await chrome.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect(page.locator('#email')).toHaveValue('vault@example.test')
  await expect(page.locator('#password')).toHaveValue('fixture-vault-password')
  await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.pluginId === 'bmux.bitwarden')?.status).toBe('completed')
  let published = JSON.stringify(await state())
  for (let value of ['fixture-master', 'fixture-session', 'fixture-vault-password']) expect(published).not.toContain(value)
})

let chooseVaultLogin = async (unlockExpected = false) => {
  await command('passwords')
  let unlock = chrome.getByRole('textbox', { name: 'Unlock Bitwarden', exact: true })
  if (unlockExpected) {
    await vaultPrompt('Unlock Bitwarden'); await unlock.fill('fixture-master'); await activate(); await unlock.press('Enter')
  }
  let picker = await vaultPrompt(`Login for ${url}`)
  await expect(unlock).toHaveCount(0)
  await activate(); await picker.press('Enter')
  await expect(chrome.getByText('Fill this login over unencrypted HTTP?', { exact: true })).toBeVisible()
  await chrome.getByRole('button', { name: 'Yes', exact: true }).click()
}

test('Bitwarden reuses its session on a password-only screen and fills through native input events', async () => {
  await rpc('navigate', { tab: tabId, url: `${url}/vault-password` })
  await page.evaluate(() => document.querySelector('input')!.addEventListener('input', () => { (window as any).observed = (document.querySelector('input') as HTMLInputElement).value }))
  await chooseVaultLogin()
  await expectVaultPassword()
  expect(await page.evaluate(() => (window as any).observed)).toBe('fixture-vault-password')
  expect(await page.evaluate(() => (window as any).submitted)).toBe(false)
})

for (let mode of ['dom', 'nav']) test(`Bitwarden follows the username and password steps through ${mode} without another prompt`, async () => {
  await rpc('navigate', { tab: tabId, url: `${url}/vault-user-${mode}` })
  await chooseVaultLogin()
  await expect(page.locator('#vault-user')).toHaveValue('vault@example.test')
  await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.pluginId === 'bmux.bitwarden')?.status).toBe('completed')
  await activate(); await page.locator('#next').click()
  await expectVaultPassword()
  await expect(chrome.getByRole('textbox', { name: 'Unlock Bitwarden', exact: true })).toHaveCount(0)
  await expect(chrome.getByRole('textbox', { name: `Login for ${url}`, exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).submitted)).toBe(false)
  let published = JSON.stringify(await state())
  for (let secret of ['fixture-master', 'fixture-session', 'fixture-vault-password']) expect(published).not.toContain(secret)
})

test('Bitwarden waits without blocking shortcuts and resumes when its original tab is active', async () => {
  await rpc('navigate', { tab: tabId, url: `${url}/vault-user-dom` })
  await chooseVaultLogin(); await expect(page.locator('#vault-user')).toHaveValue('vault@example.test')
  let before = await state()
  await command('tabs'); await expect(chrome.getByRole('dialog', { name: 'Tabs', exact: true })).toBeVisible()
  await chrome.keyboard.press('Escape')
  let other = await rpc('tab.create', { pane: before.model.clients.find((client: any) => client.id === before.clientId).paneId, url: `${url}/vault-password` })
  await rpc('tab.select', { client: before.clientId, tab: other.id })
  await page.evaluate(() => (document.querySelector('#next') as HTMLElement).click())
  await page.waitForTimeout(650)
  await expect(page.locator('#vault-password')).toHaveValue('')
  await rpc('tab.select', { client: before.clientId, tab: tabId })
  await expectVaultPassword()
  await rpc('tab.close', { tab: other.id })
})

for (let stop of ['cancel', 'lock', 'cross-origin', 'typed', 'registration', 'multiple']) test(`Bitwarden continuation stops on ${stop}`, async () => {
  await rpc('navigate', { tab: tabId, url: `${url}/vault-user-dom` })
  // Each case starts with one explicit unlock to avoid dependencies on earlier cases.
  await command('passwords lock'); await chooseVaultLogin(true)
  await expect(page.locator('#vault-user')).toHaveValue('vault@example.test')
  if (stop === 'cancel' || stop === 'lock') await command(`passwords ${stop}`)
  if (stop === 'cross-origin') {
    await rpc('navigate', { tab: tabId, url: `${url.replace('127.0.0.1', 'localhost')}/vault-password` })
    await rpc('navigate', { tab: tabId, url: `${url}/vault-password` })
  } else {
    await page.evaluate(stop => {
      (document.querySelector('#next') as HTMLElement).click()
      let password = document.querySelector('#vault-password') as HTMLInputElement
      if (stop === 'typed') password.value = 'user-entered-fixture'
      if (stop === 'registration') password.autocomplete = 'new-password'
      if (stop === 'multiple') document.querySelector('form')!.append(password.cloneNode())
    }, stop)
  }
  await page.waitForTimeout(750)
  await expect(page.locator('#vault-password').first()).toHaveValue(stop === 'typed' ? 'user-entered-fixture' : '')
})

test('Mac locking cancels an open unlock prompt and discards the cached session', async () => {
  await command('passwords lock')
  await rpc('navigate', { tab: tabId, url: `${url}/vault-password` })
  await command('passwords')
  await vaultPrompt('Unlock Bitwarden')
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  await expect(chrome.getByRole('textbox', { name: 'Unlock Bitwarden', exact: true })).toHaveCount(0)
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'))
  await chooseVaultLogin(true)
  await expectVaultPassword()
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
