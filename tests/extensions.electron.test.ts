import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

test('loads an extension per profile, opens its sandboxed popup, restores and removes it', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-extensions-'))
  let extensionPath = path.join(directory, 'extension')
  await fs.mkdir(extensionPath)
  await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Fixture extension', version: '1.0', permissions: ['storage'], browser_action: { default_popup: 'popup.html' }, content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_start' }] }))
  await fs.writeFile(path.join(extensionPath, 'content.js'), 'document.documentElement.dataset.extensionFixture = "loaded"')
  await fs.writeFile(path.join(extensionPath, 'popup.html'), '<!doctype html><h1>Extension fixture</h1>')
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><h1>Local extension test</h1>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/fixture`
  let application: ElectronApplication | undefined, chrome!: Page
  let launch = async () => {
    let installed = process.env.BMUX_TEST_INSTALLED === '1'
    application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  }
  let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
  try {
    await launch()
    let profile = 'profile_default'
    let installed = await rpc('extension.load', { profile, path: extensionPath })
    expect(installed.name).toBe('Fixture extension')
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application!.context().pages().find(page => page.url() === url)!
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-extension-fixture', 'loaded')
    expect(await page.evaluate(() => ['require', 'bmux'].map(key => typeof (window as any)[key]))).toEqual(['undefined', 'undefined'])
    let other = await rpc('profile.create', { name: 'Isolated extension profile' })
    expect((await rpc('extension.list', { profile: other.id })).extensions).toEqual([])
    await rpc('extension.open', { profile, id: installed.id })
    await expect.poll(() => application!.context().pages().some(page => page.url().startsWith('chrome-extension://'))).toBe(true)
    let popup = application!.context().pages().find(page => page.url().startsWith('chrome-extension://'))!
    await expect(popup.locator('h1')).toHaveText('Extension fixture')
    expect(await popup.evaluate(() => ['require', 'bmux'].map(key => typeof (window as any)[key]))).toEqual(['undefined', 'undefined'])
    await popup.evaluate(async () => { let chrome = (window as any).chrome; await chrome.storage.session.set({ fixture: 'memory only' }) })
    expect(await popup.evaluate(() => (window as any).chrome.storage.session.get('fixture'))).toEqual({ fixture: 'memory only' })
    let anotherPath = path.join(directory, 'another-extension')
    await fs.cp(extensionPath, anotherPath, { recursive: true })
    let another = await rpc('extension.load', { profile, path: anotherPath })
    await rpc('extension.open', { profile, id: another.id })
    let anotherPopup = application!.context().pages().find(page => page.url().startsWith(`chrome-extension://${another.id}/`))!
    expect(await anotherPopup.evaluate(() => (window as any).chrome.storage.session.get(null))).toEqual({})
    await anotherPopup.evaluate(() => { (window as any).observedChanges = []; (window as any).chrome.storage.onChanged.addListener((changes: unknown) => (window as any).observedChanges.push(changes)) })
    await popup.evaluate(() => (window as any).chrome.storage.session.set({ fixture: 'still private' }))
    expect(await anotherPopup.evaluate(() => (window as any).observedChanges)).toEqual([])
    let extensionWindow = await popup.evaluate(() => (window as any).chrome.windows.create({ url: (window as any).chrome.runtime.getURL('popup.html'), type: 'popup' }))
    expect(extensionWindow.id).toBeGreaterThan(0)
    expect(extensionWindow.tabs).toHaveLength(1)
    await rpc('extension.remove', { profile, id: another.id })
    await application!.close()
    await launch()
    expect((await rpc('extension.list', { profile })).extensions[0].id).toBe(installed.id)
    await rpc('extension.open', { profile, id: installed.id })
    let restoredPopup = application!.context().pages().find(page => page.url().startsWith('chrome-extension://'))!
    expect(await restoredPopup.evaluate(() => (window as any).chrome.storage.session.get(null))).toEqual({})
    await rpc('extension.remove', { profile, id: installed.id })
    expect((await rpc('extension.list', { profile })).extensions).toEqual([])
    expect(JSON.parse(await fs.readFile(path.join(directory, 'extensions.json'), 'utf8'))).toEqual([])
  } finally {
    await application?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
