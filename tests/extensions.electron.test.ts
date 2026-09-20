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
  await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Fixture extension', version: '1.0', permissions: ['storage', 'tabs'], background: { service_worker: 'background.js' }, action: { default_popup: 'popup.html' }, sandbox: { pages: ['inline-list.html'] }, web_accessible_resources: [{ resources: ['inline.html', 'inline.js', 'inline-list.html', 'inline-list.js'], matches: ['http://127.0.0.1/*'], use_dynamic_url: true }], content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_start' }] }))
  await fs.writeFile(path.join(extensionPath, 'background.js'), `
    chrome.tabs.onActivated.addListener(() => chrome.storage.local.get('activated', value => chrome.storage.local.set({ activated: (value.activated || 0) + 1 })))
    chrome.runtime.onConnect.addListener(port => {
      if (port.name !== 'inline') return
      port.onMessage.addListener(message => {
        if (message.command !== 'newItem') return
        chrome.storage.local.set({ inlineSender: port.sender?.tab, inlineOrigin: port.sender?.origin, inlineFrameId: port.sender?.frameId })
        port.postMessage({ command: 'ack' })
        chrome.tabs.sendMessage(port.sender.tab.id, { command: 'newItem' })
      })
    })
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (message.command !== 'newItemDone') return
      chrome.storage.local.set({ inlineReply: sender.tab?.url })
      chrome.storage.local.get('inlineWindow', value => {
        if (value.inlineWindow) return chrome.windows.update(value.inlineWindow, { focused: true })
        chrome.tabs.query({ url: chrome.runtime.getURL('edit.html') + '*' }, existing => {
          let queryError = chrome.runtime.lastError?.message
          chrome.storage.local.set({ inlineQueryCount: existing?.length, inlineQueryError: queryError })
          if (queryError) return
          chrome.windows.get(sender.tab.windowId, { populate: true }, senderWindow => {
            chrome.runtime.getPlatformInfo(() => {
              chrome.windows.create({ type: 'popup', focused: true, width: 420, height: 630, left: senderWindow.left, top: senderWindow.top, url: chrome.runtime.getURL('edit.html?uilocation=popout') }, created => {
                chrome.storage.local.set({ inlineWindow: created?.id, inlineError: chrome.runtime.lastError?.message })
              })
            })
          })
        })
      })
    })
  `)
  await fs.writeFile(path.join(extensionPath, 'content.js'), 'document.documentElement.dataset.extensionFixture = "loaded"; let frame = document.createElement("iframe"); frame.setAttribute("credentialless", ""); frame.src = chrome.runtime.getURL("inline.html"); document.documentElement.appendChild(frame); chrome.runtime.onMessage.addListener(message => { if (message.command === "newItem") chrome.runtime.sendMessage({ command: "newItemDone" }) })')
  await fs.writeFile(path.join(extensionPath, 'inline.html'), '<!doctype html><iframe sandbox="allow-scripts" src="inline-list.html" style="width:300px;height:100px"></iframe><script src="inline.js"></script>')
  await fs.writeFile(path.join(extensionPath, 'inline.js'), 'let port = chrome.runtime.connect({ name: "inline" }); port.onMessage.addListener(message => { if (message.command === "ack") document.body.dataset.ack = "received" }); window.addEventListener("message", event => { if (event.source !== document.querySelector("iframe").contentWindow || event.data.command !== "newItem") return; port.postMessage({ command: "newItem" }) })')
  await fs.writeFile(path.join(extensionPath, 'inline-list.html'), '<!doctype html><button id="new-item">New item</button><script src="inline-list.js"></script>')
  await fs.writeFile(path.join(extensionPath, 'inline-list.js'), 'document.querySelector("#new-item").onclick = () => parent.postMessage({ command: "newItem" }, "*")')
  await fs.writeFile(path.join(extensionPath, 'edit.html'), '<!doctype html><h1>New vault item</h1>')
  await fs.writeFile(path.join(extensionPath, 'popup.html'), '<!doctype html><h1>Extension fixture</h1><p id="active-tab"></p><script src="popup.js"></script>')
  await fs.writeFile(path.join(extensionPath, 'popup.js'), `
    window.tabEvents = { updated: [] }
    chrome.tabs.onUpdated.addListener((_id, info) => window.tabEvents.updated.push(info))
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => { document.querySelector('#active-tab').textContent = tabs[0]?.url || 'missing' })
  `)
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><h1>Local extension test</h1><input type="password">') })
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
    await chrome.getByRole('button', { name: 'Extensions', exact: true }).click()
    let extensionPanel = chrome.getByRole('dialog', { name: 'Extensions', exact: true })
    await expect(extensionPanel).toContainText('Profile: default')
    await extensionPanel.getByRole('button', { name: /Fixture extension/ }).click()
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/popup.html'))).toBe(true)
    let toolbarPopup = application!.context().pages().find(page => page.url().endsWith('/popup.html'))!
    await expect(toolbarPopup.getByRole('heading', { name: 'Extension fixture' })).toBeVisible()
    await toolbarPopup.close()
    await page.frameLocator('iframe').frameLocator('iframe').getByRole('button', { name: 'New item' }).click()
    await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-ack', 'received')
    expect(await page.evaluate(() => ['require', 'bmux'].map(key => typeof (window as any)[key]))).toEqual(['undefined', 'undefined'])
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/edit.html?uilocation=popout'))).toBe(true)
    let editWindow = application!.context().pages().find(page => page.url().endsWith('/edit.html?uilocation=popout'))!
    await expect(editWindow.getByRole('heading', { name: 'New vault item' })).toBeVisible()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)?.isFocused(), editWindow.url())).toBe(true)
    let other = await rpc('profile.create', { name: 'Isolated extension profile' })
    expect((await rpc('extension.list', { profile: other.id })).extensions).toEqual([])
    await rpc('extension.open', { profile, id: installed.id })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/popup.html'))).toBe(true)
    let popup = application!.context().pages().find(page => page.url().endsWith('/popup.html'))!
    await expect(popup.locator('h1')).toHaveText('Extension fixture')
    await expect(popup.locator('#active-tab')).toHaveText(url)
    expect(await popup.evaluate(async () => (await (window as any).chrome.storage.local.get(['inlineQueryCount', 'inlineQueryError'])))).toEqual({ inlineQueryCount: 0 })
    await expect.poll(() => popup.evaluate(async () => (await (window as any).chrome.storage.local.get('inlineSender')).inlineSender?.url)).toBe(url)
    expect(await popup.evaluate(async () => (await (window as any).chrome.storage.local.get('inlineOrigin')).inlineOrigin)).toBe(`chrome-extension://${installed.id}`)
    expect(await popup.evaluate(async () => (await (window as any).chrome.storage.local.get('inlineFrameId')).inlineFrameId)).toBeGreaterThan(0)
    await expect.poll(() => popup.evaluate(async () => (await (window as any).chrome.storage.local.get('inlineReply')).inlineReply)).toBe(url)
    await page.locator('input[type=password]').click()
    await expect.poll(() => application!.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.getTitle() === 'bmux')?.isFocused())).toBe(true)
    await page.frameLocator('iframe').frameLocator('iframe').getByRole('button', { name: 'New item' }).click()
    await expect.poll(() => application!.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)?.isFocused(), editWindow.url())).toBe(true)
    await editWindow.close()
    let current = (await rpc('tab.list')).find((tab: any) => tab.active)
    let nextUrl = url.replace('/fixture', '/appstoreconnect.apple.com/login?targetUrl=%2Fapps')
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(nextUrl); await address.press('Enter')
    await expect.poll(() => popup.evaluate(expected => (window as any).tabEvents.updated.some((info: any) => info.url === expected), nextUrl)).toBe(true)
    await rpc('extension.open', { profile, id: installed.id })
    await expect(popup.locator('#active-tab')).toHaveText(nextUrl)
    await application!.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.getTitle() === 'bmux')?.focus())
    await expect.poll(async () => (await rpc('state')).focusedClientId).toBeTruthy()
    let activated = await popup.evaluate(async () => (await (window as any).chrome.storage.local.get('activated')).activated || 0)
    await rpc('tab.create', { pane: current.paneId, url, client: true })
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    await rpc('extension.open', { profile, id: installed.id })
    await expect(popup.locator('#active-tab')).toHaveText(url)
    await expect.poll(() => popup.evaluate(async () => (await (window as any).chrome.storage.local.get('activated')).activated || 0)).toBeGreaterThan(activated)
    await application!.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.getTitle() === 'bmux')?.focus())
    await expect.poll(async () => (await rpc('state')).focusedClientId).toBeTruthy()
    await rpc('tab.select', { tab: current.id })
    await rpc('extension.open', { profile, id: installed.id })
    await expect(popup.locator('#active-tab')).toHaveText(nextUrl)
    await expect.poll(() => popup.evaluate(async () => (await (window as any).chrome.storage.local.get('activated')).activated || 0)).toBeGreaterThan(activated + 1)
    expect(await application!.evaluate(({ BrowserWindow }, url) => {
      let window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === url)
      return window && { contentSize: window.getContentSize(), resizable: window.isResizable(), maximizable: window.isMaximizable(), fullscreenable: window.isFullScreenable() }
    }, popup.url())).toEqual({ contentSize: [420, 640], resizable: false, maximizable: false, fullscreenable: false })
    expect(await popup.evaluate(() => ['require', 'bmux'].map(key => typeof (window as any)[key]))).toEqual(['undefined', 'undefined'])
    await popup.evaluate(async () => { let chrome = (window as any).chrome; await chrome.storage.session.set({ fixture: 'memory only' }) })
    expect(await popup.evaluate(() => (window as any).chrome.storage.session.get('fixture'))).toEqual({ fixture: 'memory only' })
    await popup.bringToFront()
    await application!.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)!.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['meta'] }), popup.url())
    await expect.poll(() => popup.isClosed()).toBe(true)
    await rpc('extension.open', { profile, id: installed.id })
    popup = application!.context().pages().find(page => page.url() === `chrome-extension://${installed.id}/popup.html`)!
    await expect(popup.locator('#active-tab')).toHaveText(nextUrl)
    let anotherPath = path.join(directory, 'another-extension')
    await fs.cp(extensionPath, anotherPath, { recursive: true })
    let another = await rpc('extension.load', { profile, path: anotherPath })
    await rpc('extension.open', { profile, id: another.id })
    let anotherPopup = application!.context().pages().find(page => page.url() === `chrome-extension://${another.id}/popup.html`)!
    expect(await anotherPopup.evaluate(() => (window as any).chrome.storage.session.get(null))).toEqual({})
    await anotherPopup.evaluate(() => { (window as any).observedChanges = []; (window as any).chrome.storage.onChanged.addListener((changes: unknown) => (window as any).observedChanges.push(changes)) })
    await popup.evaluate(() => (window as any).chrome.storage.session.set({ fixture: 'still private' }))
    expect(await anotherPopup.evaluate(() => (window as any).observedChanges)).toEqual([])
    let extensionWindow = await popup.evaluate(() => (window as any).chrome.windows.create({ url: (window as any).chrome.runtime.getURL('popup.html'), type: 'popup' }))
    expect(extensionWindow.id).toBeGreaterThan(0)
    expect(extensionWindow.tabs).toHaveLength(1)
    await rpc('extension.remove', { profile, id: another.id })
    await popup.evaluate(() => (window as any).chrome.storage.local.set({ upgradeFixture: 'preserved' }))
    let manifest = JSON.parse(await fs.readFile(path.join(extensionPath, 'manifest.json'), 'utf8'))
    manifest.version = '1.1'
    await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest))
    await application!.close()
    await launch()
    expect((await rpc('extension.list', { profile })).extensions[0]).toMatchObject({ id: installed.id, version: '1.1' })
    await rpc('extension.open', { profile, id: installed.id })
    let restoredPopup = application!.context().pages().find(page => page.url() === `chrome-extension://${installed.id}/popup.html`)!
    expect(await restoredPopup.evaluate(() => (window as any).chrome.storage.local.get('upgradeFixture'))).toEqual({ upgradeFixture: 'preserved' })
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
