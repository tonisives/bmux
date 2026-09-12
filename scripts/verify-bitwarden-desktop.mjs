import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { randomBytes, createHash, X509Certificate } from 'node:crypto'
import { createProxy } from './fixtures/bitwarden-proxy.mjs'

if (process.env.BMUX_TEST_NATIVE !== '1' || process.env.CI !== '1') throw new Error('Run this disposable desktop check through node scripts/tart.mjs bitwarden-desktop.')
let manifest = path.join(os.homedir(), 'Library/Containers/com.duckduckgo.macos.browser/Data/Library/Application Support/NativeMessagingHosts/com.8bit.bitwarden.json')
if (await fs.stat(manifest).catch(() => undefined)) throw new Error('Use a guest without an existing DuckDuckGo pairing manifest.')
let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-desktop-vault-'))
let exec = promisify(execFile)
let application, child, bmux, desktopPage, chromePage, proxy, fixture
let credentials = { email: `bmux-${randomBytes(8).toString('hex')}@example.invalid`, master: randomBytes(30).toString('base64url'), password: randomBytes(24).toString('base64url') }
let safe = value => Object.values(credentials).reduce((text, secret) => text.replaceAll(secret, '[fixture]').replaceAll(secret.toUpperCase(), '[fixture]'), String(value))
try {
  let certificate = path.join(directory, 'vault.crt'), key = path.join(directory, 'vault.key'), certificateName = `bmux-disposable-${randomBytes(8).toString('hex')}`
  await fs.writeFile(path.join(directory, 'openssl.cnf'), `[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=${certificateName}\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=serverAuth\n`)
  await exec('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', path.join(directory, 'openssl.cnf'), '-keyout', key, '-out', certificate])
  let spki = createHash('sha256').update(new X509Certificate(await fs.readFile(certificate)).publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
  proxy = createProxy('127.0.0.1', 18210, 'http://192.168.64.1:18211', { key: await fs.readFile(key), cert: await fs.readFile(certificate) })
  fixture = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>bmux disposable login</title><h1>Desktop vault fixture</h1><form><label>Username<input id="username" autocomplete="username"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form><script>window.submitted=false;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submitted=true}</script>')
  })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  let fixtureUrl = `http://127.0.0.1:${fixture.address().port}/login`
  await fs.mkdir(path.join(directory, 'plugins'), { recursive: true })
  await fs.cp('examples/plugins/experimental.bitwarden', path.join(directory, 'plugins/experimental.bitwarden'), { recursive: true })
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nplugins:\n  experimental.bitwarden:\n    enabled: true\n')
  child = spawn('/Applications/Bitwarden.app/Contents/MacOS/Bitwarden', ['--remote-debugging-port=19222', `--ignore-certificate-errors-spki-list=${spki}`], { env: { ...process.env, BITWARDEN_APPDATA_DIR: path.join(directory, 'desktop') }, stdio: 'ignore' })
  for (let attempt = 0; attempt < 30; attempt++) {
    try { application = await chromium.connectOverCDP('http://127.0.0.1:19222', { timeout: 1000 }); break } catch { await delay(1000) }
  }
  if (!application) throw new Error('The isolated desktop debugging endpoint did not become ready.')
  let page = application.contexts()[0].pages()[0]
  desktopPage = page
  page.on('response', response => { if (response.status() >= 400) console.log('Desktop request failed:', response.status(), new URL(response.url()).pathname) })
  page.setDefaultTimeout(10000)
  await page.waitForTimeout(1500)
  await page.getByText('bitwarden.com', { exact: true }).click()
  await page.getByText('self-hosted', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Server URL', exact: true }).fill('https://localhost:18210')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  bmux = await electron.launch({ args: [process.cwd(), `--ignore-certificate-errors-spki-list=${spki}`], env: { ...process.env, BMUX_DATA_DIR: path.join(directory, 'bmux'), BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => bmux.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  let chrome = bmux.context().pages().find(page => page.url().endsWith('/renderer/index.html'))
  chromePage = chrome
  chrome.setDefaultTimeout(10000)
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill('https://localhost:18210/#/register'); await address.press('Enter')
  await expect.poll(() => bmux.context().pages().some(page => page.url().includes('18210'))).toBe(true)
  let vault = bmux.context().pages().find(page => page.url().includes('18210'))
  await vault.waitForTimeout(2500)
  await vault.getByRole('textbox', { name: /Email address/ }).fill(credentials.email)
  await vault.getByRole('textbox', { name: 'Name', exact: true }).fill('bmux disposable test')
  await vault.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(vault.locator('input[type=password]')).toHaveCount(2)
  await vault.locator('input[type=password]').nth(0).fill(credentials.master)
  await vault.locator('input[type=password]').nth(1).fill(credentials.master)
  await vault.getByRole('checkbox', { name: 'Check known data breaches for this password', exact: true }).uncheck()
  await vault.getByRole('button', { name: 'Create account', exact: true }).click()
  await vault.waitForTimeout(2000)
  await expect(vault.getByText('Your new account has been created!', { exact: true })).toBeVisible()
  console.log('Disposable vault account created.')
  await page.getByRole('textbox', { name: /Email address/ }).fill(credentials.email)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.locator('input[type=password]').fill(credentials.master)
  await expect.poll(() => page.locator('input[type=password]').evaluate((node, value) => node.value === value, credentials.master)).toBe(true)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New', exact: true }).first()).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'New', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Login', exact: true }).click()
  await page.getByRole('textbox', { name: /^Item name/ }).fill('bmux local fixture')
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('bmux-fixture-user')
  await page.getByLabel('Password', { exact: true }).fill(credentials.password)
  await page.getByRole('textbox', { name: 'Website (URI)', exact: true }).fill(fixtureUrl)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'bmux local fixture', exact: true })).toBeVisible()
  await exec('/usr/bin/osascript', ['-e', `tell application "System Events" to set frontmost of first process whose unix id is ${child.pid} to true`, '-e', 'tell application "System Events" to keystroke "," using command down'])
  await page.waitForTimeout(1000)
  await page.getByRole('checkbox', { name: 'Allow DuckDuckGo browser integration', exact: true }).check()
  await page.getByText('Close', { exact: true }).click()
  let rpc = (method, args = {}) => chrome.evaluate(({ method, args }) => window.bmux.command({ method, args }), { method, args })
  let state = await chrome.evaluate(() => window.bmux.state())
  let activate = async () => {
    // The experiment asks the user to return from the desktop approval window.
    await exec('/usr/bin/osascript', ['-e', `tell application "System Events" to set frontmost of first process whose unix id is ${bmux.process().pid} to true`])
    await expect.poll(async () => (await exec('/usr/bin/osascript', ['-e', 'tell application "System Events" to get unix id of first application process whose frontmost is true'])).stdout.trim()).toBe(String(bmux.process().pid))
    await rpc('activate-client', { client: state.clientId })
  }
  await activate()
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  await address.fill(fixtureUrl); await address.press('Enter')
  await expect.poll(() => bmux.context().pages().some(page => page.url() === fixtureUrl)).toBe(true)
  let login = bmux.context().pages().find(page => page.url() === fixtureUrl)
  await expect(login.getByRole('heading', { name: 'Desktop vault fixture', exact: true })).toBeVisible()
  expect((await rpc('plugin.list')).find(plugin => plugin.id === 'experimental.bitwarden')?.enabled).toBe(true)
  let pair = async action => {
    await activate()
    let run = await rpc('plugin.run', { action: `experimental.bitwarden/${action}` })
    console.log(`Confirming bmux ${action} invocation.`)
    await chrome.getByRole('button', { name: 'Yes', exact: true }).click()
    console.log(`Waiting for desktop ${action} approval.`)
    await expect(page.getByRole('button', { name: 'Yes', exact: true })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Yes', exact: true }).click()
    return run.id
  }
  let completed = async id => {
    await expect.poll(async () => (await rpc('plugin.runs')).find(item => item.id === id)?.status, { timeout: 15000 }).toBe('completed')
    return (await rpc('plugin.runs')).find(item => item.id === id).result
  }
  expect(await completed(await pair('status'))).toEqual({ connected: true, status: 'unlocked' })
  console.log('Real desktop pairing and unlocked status verified.')
  let clearingMemory = page.waitForEvent('crash')
  await exec('/usr/bin/osascript', ['-e', `tell application "System Events" to set frontmost of first process whose unix id is ${child.pid} to true`, '-e', 'tell application "System Events" to keystroke "l" using command down'])
  // Released Bitwarden deliberately crashes/reloads its renderer on lock to
  // clear key material. Reconnect automation to the replacement renderer.
  await clearingMemory
  await application.close()
  await expect.poll(async () => {
    application = await chromium.connectOverCDP('http://127.0.0.1:19222')
    page = application.contexts()[0].pages()[0]; desktopPage = page
    if (await page.getByRole('button', { name: 'Unlock', exact: true }).isVisible().catch(() => false)) return true
    await application.close(); return false
  }, { timeout: 20000, intervals: [100, 250] }).toBe(true)
  expect(await completed(await pair('status'))).toEqual({ connected: true, status: 'locked' })
  console.log('Locked desktop status verified.')
  await page.locator('input[type=password]').fill(credentials.master)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New', exact: true }).first()).toBeVisible()
  let fill = await pair('fill')
  await activate()
  await expect(chrome.getByText('This page uses unencrypted HTTP. Fill credentials anyway?', { exact: true })).toBeVisible()
  await chrome.getByRole('button', { name: 'Yes', exact: true }).click()
  await chrome.getByRole('textbox', { name: 'Choose a login', exact: true }).press('Enter')
  expect(await completed(fill)).toEqual({ filled: true })
  expect(await login.locator('#password').evaluate((node, password) => node.value === password, credentials.password)).toBe(true)
  expect(await login.locator('#username').inputValue() === 'bmux-fixture-user').toBe(true)
  expect(await login.evaluate(() => window.submitted)).toBe(false)
  await expect.poll(() => bmux.evaluate(({ BaseWindow }, url) => {
    let window = BaseWindow.getFocusedWindow()
    return !!window?.isVisible() && window.contentView.children.some(view => 'webContents' in view && view.webContents.getURL() === url && view.getBounds().height > 100)
  }, fixtureUrl)).toBe(true)
  console.log('Desktop login filled into the local fixture without submission.')
  await fs.mkdir('artifacts', { recursive: true })
  await login.screenshot({ path: 'artifacts/bitwarden-desktop-fill.png', mask: [login.locator('input')] })
  await fs.writeFile('artifacts/bitwarden-desktop.json', JSON.stringify({ desktop: '2026.8.0', server: 'Vaultwarden 1.37.2', paired: true, unlocked: true, locked: true, filled: true, submitted: false, nativePageVisible: true }, null, 2))
} catch (error) {
  console.error(safe(error.message)); process.exitCode = 1
  if (desktopPage) console.log('Desktop failure screen:', safe(await desktopPage.locator('body').innerText().catch(() => 'Desktop renderer unavailable')))
  if (chromePage) console.log('bmux run diagnostics:', await chromePage.evaluate(async () => { let state = await window.bmux.state(); return { focused: state.focusedClientId === state.clientId, prompt: state.pluginPrompt?.kind, runs: state.pluginRuns?.map(run => ({ status: run.status, error: run.error, progress: run.progress?.message })) } }).catch(() => undefined))
} finally {
  await bmux?.close().catch(() => undefined)
  await application?.close().catch(() => undefined)
  let stopped = child && child.exitCode === null && child.signalCode === null && new Promise(resolve => child.once('exit', resolve))
  child?.kill()
  await stopped
  await fs.rm(manifest, { force: true })
  proxy?.closeFixture()
  fixture?.closeAllConnections(); fixture?.close()
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
