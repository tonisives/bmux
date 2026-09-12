import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { stringify } from 'yaml'

let application: ElectronApplication, chrome: Page, page: Page, directory: string, url: string, remote: string, server: http.Server, tabId: string
let adRequests = 0
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let frameBody = '<h2>Frame content</h2><p class="bmux-frame-local">Local ad</p><p class="bmux-frame-remote">Remote ad</p><p class="bmux-frame-generic">Generic ad</p><p class="user-style">User style stays in the main document</p>'
let names = ['same', 'nested', 'srcdoc', 'blank', 'sandboxed', 'remote', 'strict', 'remote-srcdoc', 'remote-sandboxed']
// Electron's frame tree remains complete during cross-process frame handoffs.
let nativeFrame = (name: string, expression: string, target = page.url()) => application.evaluate(async ({ webContents }, { name, expression, target }) => {
  let contents = webContents.getAllWebContents().find(contents => contents.getURL() === target)
  let frame = contents?.mainFrame.framesInSubtree.find(frame => frame.name === name)
  if (!frame?.url) return null
  return { url: frame.url, processId: frame.processId, value: await frame.executeJavaScript(expression) }
}, { name, expression, target })
let opaqueFrame = (name: string, target = page.url()) => {
  let document = application.context().pages().find(page => page.url() === target)!
  return name === 'remote-sandboxed' ? document.frameLocator('[name=remote]').frameLocator('[name=remote-sandboxed]') : document.frameLocator('[name=sandboxed]')
}
let display = async (name: string, selector: string, target?: string) => name.includes('sandboxed')
  ? opaqueFrame(name, target).locator(selector).evaluate(node => getComputedStyle(node).display)
  : (await nativeFrame(name, `(() => { let node = document.querySelector(${JSON.stringify(selector)}); return node ? getComputedStyle(node).display : null })()`, target))?.value
let expectDisplay = (name: string, selector: string, value: string, target?: string) => expect.poll(() => display(name, selector, target)).toBe(value)
let clients = (value: any) => value.model.clients.map((client: any) => ({ ...client, zoomedPaneId: client.zoomedPaneId ?? null }))

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-frame-cosmetics-'))
  server = http.createServer((request, response) => {
    if (request.url === '/bmux-frame-ad.js') { adRequests++; response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end('globalThis.adRan = true'); return }
    let fixture = request.url?.startsWith('/fixture')
    let strict = request.url === '/strict-frame'
    response.writeHead(200, { 'Content-Type': 'text/html', ...(strict ? { 'Content-Security-Policy': "default-src 'none'; style-src 'none'; script-src 'none'" } : {}) })
    response.end(`<!doctype html><title>Frame cosmetics fixture</title>${fixture ? `<style>body{font:18px sans-serif;background:#edf3fa;color:#18324f;padding:20px}iframe{width:44%;height:180px;margin:8px;border:1px solid #7590aa}h1{font-size:26px}</style><h1>Frame cosmetics fixture</h1>
      <iframe name="same" src="${url}/frame"></iframe><iframe name="remote" src="${remote}/nested"></iframe>
      <iframe name="strict" src="${remote}/strict-frame"></iframe><iframe name="sandboxed" sandbox srcdoc='${frameBody}'></iframe>
      <iframe name="srcdoc" srcdoc='${frameBody}'></iframe><iframe name="blank"></iframe>
      <script>document.querySelector('[name=blank]').contentDocument.body.innerHTML = ${JSON.stringify(frameBody)}</script>` : frameBody + (strict ? '' : '<script src="/bmux-frame-ad.js"></script>') + (request.url === '/nested' ? `<iframe name="nested" src="${url}/frame"></iframe><iframe name="remote-srcdoc" srcdoc='${frameBody}'></iframe><iframe name="remote-sandboxed" sandbox srcdoc='${frameBody}'></iframe>` : '')}`)
  })
  await new Promise<void>(resolve => server.listen(0, resolve))
  let port = (server.address() as { port: number }).port
  url = `http://127.0.0.1:${port}`; remote = `http://localhost:${port}`
  await fs.writeFile(path.join(directory, 'early.js'), 'globalThis.userScriptRan = true')
  await fs.writeFile(path.join(directory, 'user.css'), '.user-style{display:none!important}')
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { autoUpdateFilters: false,
    rules: ['/bmux-frame-ad.js$script', '127.0.0.1##.bmux-frame-local', 'localhost##.bmux-frame-remote', '##.bmux-frame-generic', '##.bmux-frame-dynamic'],
    profiles: { profile_default: { sites: { [remote]: { adblock: false } } }, profile_bot: { adblock: false } },
    userscripts: [{ id: 'early', file: './early.js', enabled: true, matches: ['http://*/*'], runAt: 'document-start' }, { id: 'style', file: './user.css', enabled: true, matches: ['http://*/*'] }],
  } }))
  application = await electron.launch({ args: [process.cwd(), '--site-per-process'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let current = await state()
  expect(current.configError).toBeNull()
  await rpc('activate-client', { client: current.clientId })
  await expect.poll(async () => (await state()).focusedClientId).toBe(current.clientId)
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(`${url}/fixture`); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === `${url}/fixture`)).toBe(true)
  page = application.context().pages().find(page => page.url() === `${url}/fixture`)!
  tabId = (await state()).model.sessions[0].windows[0].panes[0].activeTabId
  await expect(page.locator('h1')).toBeVisible()
})
test.afterAll(async () => {
  await application?.close()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus || !page) return
  console.error('FRAME_FIXTURE', page.frames().map(frame => ({ name: frame.name(), url: frame.url() })))
  console.error('NATIVE_FRAMES', await application.evaluate(({ webContents }, url) => {
    let contents = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))!
    return contents?.mainFrame.framesInSubtree.map(frame => ({ name: frame.name, url: frame.url, processId: frame.processId }))
  }, url))
})

test('hides frame ads using each document host, including nested, opaque, and strict-CSP frames', async () => {
  await expectDisplay('remote-sandboxed', 'h2', 'block')
  for (let name of ['same', 'nested', 'srcdoc', 'blank', 'sandboxed']) {
    await expectDisplay(name, 'h2', 'block')
    await expectDisplay(name, '.bmux-frame-local', 'none')
    await expectDisplay(name, '.bmux-frame-remote', 'block')
    await expectDisplay(name, '.bmux-frame-generic', 'none')
  }
  for (let name of ['remote', 'strict', 'remote-srcdoc', 'remote-sandboxed']) {
    await expectDisplay(name, '.bmux-frame-local', 'block')
    await expectDisplay(name, '.bmux-frame-remote', 'none')
    await expectDisplay(name, '.bmux-frame-generic', 'none')
  }
  let processes = await application.evaluate(({ webContents }, url) => {
    let contents = webContents.getAllWebContents().find(contents => contents.getURL() === `${url}/fixture`)!
    return contents.mainFrame.framesInSubtree.map(frame => ({ name: frame.name, processId: frame.processId }))
  }, url)
  expect(processes.find(frame => frame.name === 'remote')?.processId).not.toBe(processes.find(frame => frame.name === 'same')?.processId)
  expect(adRequests).toBe(0)
  expect(await page.evaluate(() => (window as any).userScriptRan)).toBe(true)
  for (let name of names) {
    let capabilities = name.includes('sandboxed')
      ? await opaqueFrame(name).locator('body').evaluate(() => ['process', 'require', 'bmux', 'userScriptRan'].map(key => typeof (globalThis as any)[key]))
      : (await nativeFrame(name, "['process', 'require', 'bmux', 'userScriptRan'].map(key => typeof globalThis[key])"))?.value
    expect(capabilities).toEqual(['undefined', 'undefined', 'undefined', 'undefined'])
    await expectDisplay(name, '.user-style', 'block')
  }
  expect((await nativeFrame('strict', `(() => {
    let script = document.createElement('script'); script.textContent = 'globalThis.cspEscaped = true'; document.head.append(script);
    let style = document.createElement('style'); style.textContent = 'h2{display:none!important}'; document.head.append(style);
    return !!globalThis.cspEscaped;
  })()`))?.value).toBe(false)
  await expectDisplay('strict', 'h2', 'block')
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
  await page.screenshot({ path: path.resolve('artifacts/frame-cosmetics.png') })
})

test('refreshes dynamic content and follows frame navigation, process swaps, removal, and replacement', async () => {
  await nativeFrame('remote', "let ad = document.createElement('p'); ad.className = 'bmux-frame-dynamic'; ad.textContent = 'Dynamic ad'; document.body.prepend(ad)")
  await expect.poll(() => display('remote', '.bmux-frame-dynamic'), { timeout: 10000 }).toBe('none')
  for (let origin of [remote, url, remote]) {
    await page.locator('[name=same]').evaluate((node, src) => { (node as HTMLIFrameElement).src = src }, `${origin}/frame`)
    await expect.poll(async () => (await nativeFrame('same', 'true'))?.url).toBe(`${origin}/frame`)
    await expectDisplay('same', origin === url ? '.bmux-frame-local' : '.bmux-frame-remote', 'none')
    await expectDisplay('same', origin === url ? '.bmux-frame-remote' : '.bmux-frame-local', 'block')
  }
  await page.locator('[name=same]').evaluate(node => node.remove())
  await page.evaluate(url => { let child = document.createElement('iframe'); child.name = 'replacement'; child.src = `${url}/frame`; document.body.append(child) }, url)
  await expect.poll(async () => (await nativeFrame('replacement', 'true'))?.url).toBe(`${url}/frame`)
  await expectDisplay('replacement', '.bmux-frame-local', 'none')
  await rpc('navigate', { tab: tabId, url: `${url}/fixture?reloaded` })
  await expectDisplay('remote-sandboxed', 'h2', 'block')
  await expectDisplay('same', '.bmux-frame-local', 'none')
  await expectDisplay('remote', '.bmux-frame-remote', 'none')
})

test('applies live site toggles to all frames while background operations preserve clients and native focus', async () => {
  let current = await state(), selection = clients(current)
  await rpc('focus-page', { client: current.clientId })
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  let focused = await application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id)
  let session = await rpc('new-session', { name: 'Frame background', profile: 'default' })
  let tab = session.windows[0].panes[0].activeTabId
  await rpc('navigate', { tab, url: `${url}/fixture?background` })
  await expect.poll(() => application.context().pages().some(page => page.url() === `${url}/fixture?background`)).toBe(true)
  let background = application.context().pages().find(page => page.url() === `${url}/fixture?background`)!
  await expectDisplay('remote', 'h2', 'block', background.url())
  await expectDisplay('remote', '.bmux-frame-remote', 'none', background.url())
  let wait = rpc('wait', { tab, expression: 'globalThis.waitComplete === true', timeout: 20000 })
  try {
    await nativeFrame('remote', "history.pushState({}, '', '#same-document')")
    await rpc('browser.set', { tab, setting: 'adblock', value: false })
    for (let name of names) await expectDisplay(name, '.bmux-frame-generic', 'block')
    await expectDisplay('remote', '.bmux-frame-remote', 'block', background.url())
    await rpc('browser.set', { tab, setting: 'adblock', value: true })
    await expectDisplay('remote', '.bmux-frame-remote', 'none', background.url())
    await expectDisplay('strict', '.bmux-frame-generic', 'none')
    expect(clients(await state())).toEqual(selection)
    expect(await application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id)).toBe(focused)
    expect(await page.evaluate(() => document.hasFocus())).toBe(true)
  } finally { await background.evaluate(() => { (window as any).waitComplete = true }); await wait }
})

test('respects profile defaults and top-level site exemptions on first load', async () => {
  let session = await rpc('new-session', { name: 'Frame bot', profile: 'bot' })
  let tab = session.windows[0].panes[0].activeTabId
  await rpc('navigate', { tab, url: `${url}/fixture?bot` })
  await expect.poll(() => application.context().pages().some(page => page.url() === `${url}/fixture?bot`)).toBe(true)
  let bot = application.context().pages().find(page => page.url() === `${url}/fixture?bot`)!
  await expectDisplay('remote', 'h2', 'block', bot.url())
  await expectDisplay('remote', '.bmux-frame-generic', 'block', bot.url())
  await rpc('browser.set', { tab, setting: 'adblock', value: true, scope: 'profile' })
  await expectDisplay('remote', '.bmux-frame-generic', 'none', bot.url())
  await rpc('navigate', { tab: tabId, url: `${remote}/fixture?exempt` })
  await expectDisplay('remote-sandboxed', 'h2', 'block')
  for (let name of names) await expectDisplay(name, '.bmux-frame-generic', 'block')
})
