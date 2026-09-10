import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

let root = process.cwd()
let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-ui-'))
let target = process.env.BMUX_TEST_URL ?? process.env.BROWMUX_TEST_URL ?? 'https://example.com/'
let selector = process.env.BMUX_TEST_SELECTOR ?? process.env.BROWMUX_TEST_SELECTOR
let failedRequests = []
let pageErrors = []
let keepOpen = process.argv.includes('--keep-open')
let installed = process.argv.includes('--installed')
let appPath = path.join(os.homedir(), 'workspace', '_tools', 'bmux.app', 'Contents', 'MacOS', 'bmux')
let application = await electron.launch({ ...(installed ? { executablePath: appPath } : {}), args: installed ? [] : [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_BACKGROUND: '0', BMUX_DEBUG: '1' } })
application.context().on('requestfailed', request => { let url = new URL(request.url()); failedRequests.push({ path: url.origin + url.pathname, error: request.failure()?.errorText }) })
application.context().on('response', response => { if (response.status() >= 400) { let url = new URL(response.url()); failedRequests.push({ path: url.origin + url.pathname, status: response.status() }) } })
application.context().on('page', page => page.on('pageerror', error => pageErrors.push({ name: error.name, message: error.message.replace(/https?:[^\s)]+/g, '[URL]').slice(0, 200) })))
let activate = async () => {
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))
  await chrome.evaluate(async () => { let state = await window.bmux.state(); await window.bmux.command({ method: 'activate-client', args: { client: state.clientId } }) })
  await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.isFocused()))).toBe(true)
}
try {
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 20000 }).toBe(true)
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))
  await activate()
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let prompt = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await prompt.fill(target)
  await prompt.press('Enter')
  await expect(prompt).toHaveCount(0, { timeout: 45000 })
  await expect(chrome.getByRole('button', { name: 'Address', exact: true })).toContainText(new URL(target).hostname, { timeout: 45000 })
  if (selector) {
    await expect.poll(() => application.context().pages().some(page => page.url().startsWith(target)), { timeout: 30000 }).toBe(true)
    let page = application.context().pages().find(page => page.url().startsWith(target))
    await expect(page.locator(selector).first()).toBeVisible({ timeout: 45000 })
  }
  await activate()
  await chrome.waitForTimeout(100)
  let visible = await application.evaluate(({ BaseWindow }, target) => {
    let window = BaseWindow.getAllWindows().find(window => window.isVisible())
    let view = window?.contentView.children.find(view => 'webContents' in view && view.webContents.getURL().startsWith(target))
    return view ? { bounds: view.getBounds(), url: view.webContents.getURL(), title: view.webContents.getTitle() } : null
  }, target)
  if (!visible || visible.bounds.width < 600 || visible.bounds.height < 300) throw new Error('The URL loaded without attaching a visible page')
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true })
  // Park the view briefly to capture its actual rendered preview together with the status bar.
  let clientId = await chrome.evaluate(async () => (await window.bmux.state()).clientId)
  await chrome.evaluate(client => window.bmux.command({ method: 'client.overlay', args: { client, visible: true } }), clientId)
  await chrome.waitForTimeout(200)
  await chrome.screenshot({ path: path.join(root, 'artifacts/url-opened.png') })
  await chrome.evaluate(client => window.bmux.command({ method: 'client.overlay', args: { client, visible: false } }), clientId)
  if (process.env.BMUX_TEST_SECOND_URL ?? process.env.BROWMUX_TEST_SECOND_URL) {
    let secondUrl = process.env.BMUX_TEST_SECOND_URL ?? process.env.BROWMUX_TEST_SECOND_URL
    await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
    let command = chrome.getByRole('textbox', { name: 'Command', exact: true })
    await command.fill('new-window -n comparison'); await command.press('Enter')
    await expect(chrome.getByRole('button', { name: '1:comparison*', exact: true })).toBeVisible()
    await activate()
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    await prompt.fill(secondUrl); await prompt.press('Enter')
    await expect(chrome.getByRole('button', { name: 'Address', exact: true })).toContainText(new URL(secondUrl).hostname, { timeout: 45000 })
    let urls = await chrome.evaluate(async () => (await window.bmux.state()).model.sessions[0].windows.map(window => window.panes[0].tabs[0].url))
    if (urls[0] !== target || urls[1] !== secondUrl) throw new Error('Internal windows did not preserve their own URLs')
    await activate()
    await chrome.getByRole('button', { name: '0:main', exact: true }).click()
    await expect.poll(() => application.evaluate(({ BaseWindow }, target) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some(view => 'webContents' in view && view.webContents.getURL() === target)), target)).toBe(true)
    console.log(JSON.stringify({ passed: 'Two internal windows kept distinct URLs and switching restored the correct native view', urls }))
  }
  console.log(JSON.stringify({ passed: 'Typed a real URL, submitted Enter, and verified visible native page rendering', ...visible, debugPid: application.process().pid }))
  if (keepOpen) { console.log('Debug browser is open with isolated temporary profiles. Quit it to finish.'); await new Promise(resolve => application.on('close', resolve)) }
} catch (error) {
  let diagnostics = await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), children: window.contentView.children.filter(view => 'webContents' in view).map(view => ({ url: view.webContents.getURL(), bounds: view.getBounds() })) })))
  let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))
  let selection = await chrome?.evaluate(async () => { let state = await window.bmux.state(); return { focusedClientId: state.focusedClientId, clients: state.model.clients, windows: state.model.sessions[0].windows.map(window => ({ id: window.id, panes: window.panes.map(pane => ({ id: pane.id, tab: pane.activeTabId })) })) } })
  console.error('FOCUS', { expectedPid: application.process().pid, frontmost: execFileSync('/usr/bin/osascript', ['-e', 'tell application "System Events" to get {name, unix id} of first application process whose frontmost is true'], { encoding: 'utf8' }).trim() })
  console.error(JSON.stringify({ failedRequests, pageErrors, diagnostics, selection }))
  throw error
} finally {
  await application.close().catch(() => undefined)
  await fs.rm(directory, { recursive: true, force: true })
}
