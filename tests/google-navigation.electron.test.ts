import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { closeTestApplication } from './electron-fixture'
import { sendNativeKeys } from './native-focus'

let application: ElectronApplication, page: Page, chrome: Page, directory: string, server: http.Server
let fixture = `<!doctype html><style>
body { margin: 40px; font: 18px sans-serif; } main { padding-top: 160px; } article { height: 360px; }
a h3 { display: block; margin-top: 70px; } a .site { display: block; transform: translateY(-130px); }
#contents { display: contents; } #contents span { display: block; margin-top: 50px; }
</style><input aria-label="Search"><button>Settings</button><main id="search"><div id="rso">
${Array.from({ length: 5 }, (_, i) => `<article><a id="result-${i}" href="#opened-${i}"><h3>Result ${i}</h3><span class="site">Site icon ${i}</span></a></article>`).join('')}
<a id="contents" href="#contents-opened"><span>Contents link</span></a>
</div></main>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-google-navigation-'))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  adblock: false\n  autoUpdateFilters: false\nkeyboard: {}\nplugins:\n  bmux.google-search: { enabled: true, hooks: false }\n')
  server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(fixture) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/search`
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.pressSequentially(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
  page = application.context().pages().find(page => page.url() === url)!
  await expect(page.locator('#result-0')).toBeVisible()
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
})

test.afterAll(async () => {
  try { await closeTestApplication(application) }
  finally { server?.close(); if (directory) await fs.rm(directory, { recursive: true, force: true }) }
})

let isolated = async (expression: string, worldName = 'bmux:click-mode') => application.evaluate(async ({ webContents }, { expression, worldName, url }) => {
  let contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
  let { frameTree } = await contents.debugger.sendCommand('Page.getFrameTree')
  let { executionContextId } = await contents.debugger.sendCommand('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName })
  let result = await contents.debugger.sendCommand('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}, { expression, worldName, url: page.url() })
let keys = async (...keyCodes: string[]) => sendNativeKeys(application, keyCodes.map(keyCode => ({ keyCode })))
let activate = async () => {
  await sendNativeKeys(application, [{ keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: 'Alt', modifiers: ['alt'] }])
  await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(1)
}
let hintFor = (id: string) => isolated(`(() => {
  let mode = globalThis.__bmuxClickMode, element = document.getElementById(${JSON.stringify(id)}), box = element.querySelector('h3,span').getBoundingClientRect();
  let label = [...mode.shadow.querySelectorAll('span')].find(label => Math.abs(parseFloat(label.style.top) - box.top - 2) < 1 && Math.abs(parseFloat(label.style.left) - box.left - 2) < 1);
  return label?.textContent;
})()`)

test('Google-style result headlines and boxless links get native click hints on their visible content', async () => {
  await activate()
  await expect.poll(() => hintFor('result-0')).toEqual(expect.any(String))
  let hint = await hintFor('result-0')
  await keys(...hint.toLowerCase())
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#opened-0')
  await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(0)
  await page.locator('#contents span').scrollIntoViewIfNeeded()
  await activate()
  await expect.poll(() => hintFor('contents')).toEqual(expect.any(String))
  hint = await hintFor('contents')
  await keys(...hint.toLowerCase())
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#contents-opened')
})

test('Google navigation plugin selects and scrolls results with native arrow keys while preserving search editing', async () => {
  await page.evaluate(() => { history.replaceState(null, '', '/search'); scrollTo(0, 0); (document.activeElement as HTMLElement)?.blur() })
  let source = await fs.readFile('bundled-plugins/bmux.google-search/navigation.js', 'utf8')
  await isolated(source, 'bmux:google-search')
  await isolated(source, 'bmux:google-search')
  await keys('Down')
  await expect(page.locator('#result-0')).toBeFocused()
  await keys('Down')
  await expect(page.locator('#result-1')).toBeFocused()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
  await keys('Up')
  await expect(page.locator('#result-0')).toBeFocused()
  await keys('Return')
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#opened-0')
  await page.getByRole('textbox', { name: 'Search' }).click()
  await keys('Down')
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeFocused()
  await page.locator('#result-0').focus()
  await keys('Escape')
  expect(await page.locator('#result-0').evaluate(element => (element as HTMLElement).style.outline)).toBe('')
  await activate(); await keys('Down')
  await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(1)
  await keys('Escape')
})

test('Google navigation automatic hooks can be enabled in Settings and select results after loading a search', async () => {
  await application.context().route('https://www.google.com/search**', route => route.fulfill({ contentType: 'text/html', body: fixture }))
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true })
  await command.fill('settings'); await command.press('Enter')
  let settings = chrome.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('tab', { name: 'Plugins', exact: true }).click()
  let hooks = settings.getByRole('checkbox', { name: 'Automatic hooks for Google result navigation', exact: true })
  await expect(hooks).not.toBeChecked()
  await hooks.click()
  await expect(hooks).toBeChecked()
  await expect.poll(async () => {
    let config = await fs.readFile(path.join(directory, 'config.yaml'), 'utf8')
    return (await import('yaml')).parse(config).plugins['bmux.google-search']
  }).toEqual({ enabled: true, hooks: true })
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  let url = 'https://www.google.com/search?q=fixture'
  await address.fill(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
  page = application.context().pages().find(page => page.url() === url)!
  await expect(page.locator('#result-0')).toBeVisible()
  await expect.poll(() => chrome.evaluate(async () => (await (window as any).bmux.state()).pluginRuns?.some((run: any) => run.pluginId === 'bmux.google-search' && run.status === 'completed'))).toBe(true)
  await keys('Down')
  await expect(page.locator('#result-0')).toBeFocused()
  await keys('Down')
  await expect(page.locator('#result-1')).toBeFocused()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
})
