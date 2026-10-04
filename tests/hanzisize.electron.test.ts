import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { closeTestApplication } from './electron-fixture'

test('Hanzisize automatically resizes permitted pages without opening its popup', async () => {
  test.setTimeout(90000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-hanzisize-'))
  let extensionPath = path.join(directory, 'extension')
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><style>p { font-size: 13px }</style><p id="thai">สวัสดี</p><p id="english">Hello</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/thai`
  let application: ElectronApplication | undefined, chrome!: Page
  let launch = async () => {
    let packaged = process.env.BMUX_TEST_INSTALLED === '1'
    application = await electron.launch({ ...(packaged ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: packaged ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  }
  let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
  let openPage = async (target: string) => {
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(target)
    await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === target)).toBe(true)
    return application!.context().pages().find(page => page.url() === target)!
  }
  try {
    // Official, immutable Mozilla package: exercise the real background and content scripts.
    let response = await fetch('https://addons.mozilla.org/firefox/downloads/file/3783326/hanzisize-0.2.7.xpi', { signal: AbortSignal.timeout(30000) })
    expect(response.ok).toBe(true)
    let archive = Buffer.from(await response.arrayBuffer())
    expect(createHash('sha256').update(archive).digest('hex')).toBe('e1fe32e42d84f9b83170838ebff41b6abb7c728f879db2f3112de0723a4c7d01')
    let zip = path.join(directory, 'hanzisize.zip')
    await fs.writeFile(zip, archive)
    await promisify(execFile)('/usr/bin/unzip', ['-q', zip, '-d', extensionPath])
    let manifestFile = path.join(extensionPath, 'manifest.json')
    let manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    manifest.permissions.push('http://127.0.0.1/*')
    await fs.writeFile(manifestFile, JSON.stringify(manifest))
    await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
    await launch()
    let installed = await rpc('extension.load', { profile: 'profile_default', path: extensionPath })
    await expect.poll(() => application!.evaluate(async ({ webContents }, id) => {
      let background = webContents.getAllWebContents().find(contents => contents.getURL() === `chrome-extension://${id}/robots.txt`)
      return background?.executeJavaScript('globalThis.bmuxHanzisizeAutoResize === true')
    }, installed.id)).toBe(true)
    await application!.evaluate(async ({ webContents }, id) => {
      let background = webContents.getAllWebContents().find(contents => contents.getURL() === `chrome-extension://${id}/robots.txt`)!
      await background.executeJavaScript(`
        globalThis.fixtureTrace = []
        chrome.tabs.onUpdated.addListener((id, info, tab) => fixtureTrace.push({ event: 'updated', id, info, url: tab.url }))
        for (let name of ['sendMessage', 'executeScript']) {
          let original = chrome.tabs[name].bind(chrome.tabs)
          chrome.tabs[name] = (...args) => {
            let callback = args.pop()
            fixtureTrace.push({ api: name, args })
            original(...args, result => {
              fixtureTrace.push({ callback: name, error: chrome.runtime.lastError?.message, result })
              callback(result)
            })
          }
        }
        void 0
      `)
      await background.executeJavaScript("new Promise(resolve => chrome.storage.local.set({ language: 'thai', minFontSize: 18 }, resolve))")
    }, installed.id)
    let page = await openPage(url)
    await expect(page.locator('#thai')).toHaveCSS('font-size', '18px')
    await expect(page.locator('#english')).toHaveCSS('font-size', '13px')
    await page.reload()
    await expect(page.locator('#thai')).toHaveCSS('font-size', '18px')
    expect(application!.context().pages().some(page => page.url() === `chrome-extension://${installed.id}/index.html`)).toBe(false)

    let current = await chrome.evaluate(() => (window as any).bmux.state())
    let client = current.model.clients.find((item: { id: string }) => item.id === current.clientId)
    await rpc('new-window', { client: client.id, session: client.sessionId, profile: 'profile_default', url: `${url}/second` })
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}/second`)).toBe(true)
    let second = application!.context().pages().find(page => page.url() === `${url}/second`)!
    await expect(second.locator('#thai')).toHaveCSS('font-size', '18px')
    let selectedWindow = (await rpc('state')).model.clients.find((item: { id: string }) => item.id === client.id).windowId
    await page.goto(`${url}/background`)
    await expect(page.locator('#thai')).toHaveCSS('font-size', '18px')
    expect((await rpc('state')).model.clients.find((item: { id: string }) => item.id === client.id).windowId).toBe(selectedWindow)
    await second.goto(url.replace('127.0.0.1', 'localhost'))
    await expect(second.locator('#thai')).toHaveCSS('font-size', '13px')

    await rpc('extension.disable', { profile: 'profile_default', id: installed.id })
    await page.reload()
    await expect(page.locator('#thai')).toHaveCSS('font-size', '13px')
    await rpc('extension.enable', { profile: 'profile_default', id: installed.id })
    await expect(page.locator('#thai')).toHaveCSS('font-size', '18px')
    await closeTestApplication(application)
    application = undefined
    await launch()
    page = await openPage(`${url}/restored`)
    await expect(page.locator('#thai')).toHaveCSS('font-size', '18px')
    expect(application!.context().pages().some(page => page.url() === `chrome-extension://${installed.id}/index.html`)).toBe(false)
  } catch (error) {
    console.error('HANZISIZE_FIXTURE', JSON.stringify(await application?.evaluate(async ({ webContents }) => {
      let host = webContents.getAllWebContents().find(contents => contents.getURL().endsWith('/robots.txt'))
      return host?.executeJavaScript("Promise.all([new Promise(resolve => chrome.tabs.query({}, resolve)), new Promise(resolve => chrome.storage.local.get(null, resolve))]).then(([tabs, settings]) => ({ tabs, settings, trace: globalThis.fixtureTrace }))")
    }).catch(() => 'diagnostics unavailable')))
    throw error
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
