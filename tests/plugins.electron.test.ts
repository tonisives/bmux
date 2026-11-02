import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { stringify } from 'yaml'
import { observeNativeFocus, recordNativeFocus } from './native-focus'

let directory: string, application: ElectronApplication, chrome: Page, url: string, server: http.Server
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let run = async (action: string, args: Record<string, unknown> = {}) => (await rpc('plugin.run', { action: `test/${action}`, ...args })).id as string
let completed = async (id: string, status = 'completed', timeout = 5000) => { await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.id === id)?.status, { timeout }).toBe(status) }
let script = `import { execFileSync } from 'node:child_process';
let host = (method,args={}) => JSON.parse(execFileSync(process.env.BMUX_CLI,['plugin','host',method,'--stdin'],{input:JSON.stringify(args),encoding:'utf8',stdio:['pipe','pipe','pipe']})).result;
let context = host('context'), action = process.argv[2];
if (action === 'pick') {
 let selected = host('ui',{kind:'pick',title:'Fixture login',items:[{id:'first',label:'First user'},{id:'second',label:'Second user'}]});
 host('fill',{origin:new URL(context.url).origin,fields:[{selector:'#username',value:selected},{selector:'#password',value:'disposable-test-password'}]}); host('result',{filled:true});
} else if (action === 'launch') { host('result',{pane:context.paneId,profile:context.profileId,approved:context.launchApproved,url:context.launchUrl,parameters:context.parameters});
} else if (action === 'password') { host('result',{received:context.parameters.password === 'disposable-test-value'});
} else if (action === 'stale') {
 host('progress',{percent:10,message:'Captured document'}); await new Promise(resolve=>setTimeout(resolve,1000));
 try { host('fill',{origin:new URL(context.url).origin,fields:[{selector:'#username',value:'must-not-appear'}]}); process.exit(1) } catch { host('result',{staleRejected:true}) }
} else if (action === 'slow') { await new Promise(resolve=>setTimeout(resolve,30000));
} else if (action === 'wait') { host('wait',{selector:'#never',timeout:30000});
} else if (action === 'ready') { host('eval',{expression:'document.documentElement.dataset.pluginReady="yes"; true'});
} else if (action === 'changed') { host('eval',{expression:'document.documentElement.dataset.pluginChanged="yes"; true'});
} else if (action === 'hidden') {
 try { host('fill',{origin:new URL(context.url).origin,fields:[{selector:'#hidden',value:'must-not-appear'}]}); process.exit(1) } catch { host('result',{hiddenRejected:true}) }
} else if (action === 'title') { host('result',{title:host('eval',{expression:'document.title'})});
} else if (action === 'overlay') {
 host('overlay.update',{title:'Feed training',subtitle:'Fixture profile',status:'Waiting for Start',nodes:[{title:'1 Post',lines:['A software demo'],tone:'cyan'},{title:'2 Input',lines:['Caption and post metadata'],tone:'cyan'},{title:'3 Decision',lines:['Match: software'],tone:'neutral'},{title:'4 Action',lines:['Watch for 10 seconds'],tone:'green'}],controls:[{id:'start',label:'Start browsing',kind:'button'},{id:'ads',label:'Skip ads',kind:'toggle',value:false}],details:[{title:'Profile',text:'Interested in computers'}]});
 while(true){let inputs=host('overlay.events');if(inputs.some(input=>input.id==='start')){host('result',{started:true});break}await new Promise(resolve=>setTimeout(resolve,100))}
} else if (action === 'capture') { host('result',host('screenshot',{fullPage:false,encoding:'base64',format:'jpeg',quality:60,maxDimension:768})); }
`
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-plugin-ui-'))
  let folder = path.join(directory, 'plugins/test'); await fs.mkdir(folder, { recursive: true })
  await fs.cp(path.resolve('examples/plugins/local.page-tools'), path.join(directory, 'plugins/local.page-tools'), { recursive: true })
  await fs.writeFile(path.join(folder, 'run.mjs'), script)
  let action = (id: string) => ({ id, title: id, command: ['node', './run.mjs', id], capabilities: ['browser.read', 'browser.write', 'ui'], timeout_seconds: 40 })
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Fixture plugin', category: 'Social Media', description: 'Feed browsing and all platform tools.', version: '1', actions: ['pick', 'stale', 'slow', 'wait', 'hidden', 'title', 'capture', 'overlay'].map(action).concat([{ ...action('launch'), title: 'Simulate feed browsing', capabilities: ['browser.manage', 'ui'], launch_url: 'https://example.test/feed', parameters: [{ name: 'seconds', title: 'Duration in seconds', kind: 'text', default: '300' }, { name: 'ads', title: 'Skip ads', kind: 'boolean', default: false }, { name: 'session', title: 'Session ID', kind: 'text', hidden: true }] } as any, { ...action('password'), parameters: [{ name: 'password', title: 'Fixture password', kind: 'password', required: true }] } as any]), hooks: [{ ...action('ready'), event: 'page-ready', matches: ['http://127.0.0.1:*/*'] }, { ...action('changed'), event: 'url-change', matches: ['http://127.0.0.1:*/*'] }] }))
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ browser: { autoUpdateFilters: false }, keyboard: { shortcuts: { 'Cmd+Shift+L': 'plugin:test/pick' } }, plugins: { test: { enabled: true, hooks: true }, 'local.page-tools': { enabled: true } } }))
  server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Plugin fixture</title><h1>Plugin fixture</h1><input id="username" autocomplete="username"><input id="password" type="password"><input id="hidden" type="hidden"><p id="note">Native page content</p>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}`
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_DEBUG: '1' } })
  await observeNativeFocus(application)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let current = await state(); await rpc('activate-client', { client: current.clientId })
})
test.afterAll(async () => {
  await closeTestApplication(application).catch(() => undefined)
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
test.afterEach(async ({}, info) => { await recordNativeFocus(application, info) })
test.beforeEach(async ({}, info) => {
  let current = await state(), first = current.model.sessions[0].windows[0]
  await rpc('select-window', { client: current.clientId, window: first.id }); await activate()
  if (!info.title.startsWith('typed URLs')) {
    await rpc('navigate', { tab: first.panes[0].id, url })
    await rpc('wait', { tab: first.panes[0].id, selector: '#username' })
    await activate()
  }
})
test('typed URLs render native pages, hooks execute, and plugin pickers fill the selected login', async () => {
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search' }); await address.fill(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url().startsWith(url))).toBe(true)
  let page = application.context().pages().find(page => page.url().startsWith(url))!
  await expect(page.locator('html')).toHaveAttribute('data-plugin-ready', 'yes')
  await expect.poll(() => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some((view: any) => view.webContents?.getURL().startsWith(url) && view.getBounds().height > 100)), url)).toBe(true)
  // Real accelerator originates from the native page.
  await activate(); await rpc('focus-page', { client: (await state()).clientId }); await page.locator('#username').focus()
  await application.evaluate(({ webContents }, url) => {
    let page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))!
    page.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['meta', 'shift'] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['meta', 'shift'] })
  }, url)
  let picker = chrome.getByRole('textbox', { name: 'Fixture login' })
  await expect(picker).toBeFocused()
  await fs.mkdir(path.resolve('artifacts'), { recursive: true }); await chrome.screenshot({ path: path.resolve('artifacts/plugin-picker.png') })
  await picker.fill('Second'); await picker.press('Enter')
  await expect(page.locator('#username')).toHaveValue('second'); await expect(page.locator('#password')).toHaveValue('disposable-test-password')
  await expect(picker).toHaveCount(0)
  let current = await state()
  expect(JSON.stringify(current.pluginRuns)).not.toContain('disposable-test-password')
  expect(await page.evaluate(() => ({ node: typeof (window as any).require, bridge: typeof (window as any).bmux }))).toEqual({ node: 'undefined', bridge: 'undefined' })
  await page.evaluate(() => history.pushState({}, '', '/spa'))
  await expect(page.locator('html')).toHaveAttribute('data-plugin-changed', 'yes')
})
test('viewport screenshots preserve visible and hidden device pages without CDP resizing', async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let windows = () => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds() })))
  try {
    for (let mobile of [false, true]) {
      if (mobile) await rpc('profile.device.set', { pane: pane.id, profile: pane.profileId, device: { preset: 'pixel-8', orientation: 'portrait', locale: 'en-US', timezone: 'UTC' } })
      await rpc('navigate', { pane: pane.id, url })
      await rpc('wait', { pane: pane.id, selector: '#username' })
      let page = application.context().pages().find(page => page.url().startsWith(url))!
      await page.evaluate(() => {
        document.body.style.minHeight = '2600px'
        document.documentElement.style.scrollBehavior = 'auto'
        window.scrollTo(0, 180)
      })
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(180)
      await application.evaluate(({ webContents }, url) => {
        let contents = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))!
        let state = globalThis as any
        state.viewportScreenshot = { cdp: 0, native: [] }
        let send = contents.debugger.sendCommand.bind(contents.debugger), capture = contents.capturePage.bind(contents)
        contents.debugger.sendCommand = (method, ...args) => { if (method === 'Page.captureScreenshot') state.viewportScreenshot.cdp++; return send(method, ...args) }
        contents.capturePage = (...args) => {
          let call: { hidden?: boolean; size?: { width: number; height: number } } = { hidden: args[1]?.stayHidden }
          state.viewportScreenshot.native.push(call)
          return capture(...args).then(frame => { call.size = frame.getSize(); return frame })
        }
      }, url)
      for (let hidden of [false, true]) {
        if (hidden) await application.evaluate(({ app }) => app.hide())
        else await activate()
        let beforeWindows = await windows(), beforeSelection = (await state()).model.clients
        let beforePage = await page.evaluate(() => {
          let state = window as any
          state.screenshotChanges = []
          window.addEventListener('resize', () => state.screenshotChanges.push('resize'))
          document.addEventListener('visibilitychange', () => state.screenshotChanges.push('visibility'))
          return { width: innerWidth, height: innerHeight, scrollY, visibility: document.visibilityState, dpr: devicePixelRatio, touch: navigator.maxTouchPoints }
        })
        // Activation can capture a swipe preview; observe only the screenshot requests.
        await application.evaluate(() => { (globalThis as any).viewportScreenshot = { cdp: 0, native: [] } })
        let id = await run('capture', { pane: pane.id })
        await completed(id, 'completed', 10000)
        let result = (await rpc('plugin.runs')).find((item: any) => item.id === id).result
        expect(result).toMatchObject({ pane: pane.id, fullPage: false, format: 'jpeg' })
        expect(Buffer.from(result.data, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
        let jpeg = await application.evaluate(({ nativeImage }, data) => nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize(), result.data)
        expect(jpeg.width).toBeGreaterThan(0)
        expect(jpeg.height).toBeGreaterThan(0)
        expect(Math.max(jpeg.width, jpeg.height)).toBeLessThanOrEqual(768)
        let output = path.join(directory, `viewport-${mobile}-${hidden}.png`)
        expect(await rpc('screenshot', { pane: pane.id, fullPage: false, output })).toEqual({ pane: pane.id, path: output, fullPage: false })
        let png = await fs.readFile(output)
        expect(png.subarray(1, 4).toString()).toBe('PNG')
        let captures = await application.evaluate(() => (globalThis as any).viewportScreenshot)
        expect(captures.cdp).toBe(0)
        expect(captures.native.length).toBeGreaterThan(0)
        expect(captures.native.every((capture: { hidden: boolean }) => capture.hidden)).toBe(true)
        let size = captures.native.at(-1).size
        expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(size)
        expect(Math.abs(jpeg.width / jpeg.height - size.width / size.height)).toBeLessThan(0.01)
        expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollY, visibility: document.visibilityState, dpr: devicePixelRatio, touch: navigator.maxTouchPoints }))).toEqual(beforePage)
        expect(await page.evaluate(() => (window as any).screenshotChanges)).toEqual([])
        expect(await windows()).toEqual(beforeWindows)
        expect((await state()).model.clients).toEqual(beforeSelection)
      }
      await activate()
    }
  } finally {
    await activate()
    await rpc('profile.device.clear', { pane: pane.id, profile: pane.profileId })
  }
})
test('password parameters stay private and Escape cancels', async () => {
  await rpc('activate-client', { client: (await state()).clientId })
  let id = await run('password')
  let password = chrome.getByRole('textbox', { name: 'Fixture password' })
  await expect(password).toHaveAttribute('type', 'password')
  for (let attempt = 0; attempt < 3; attempt++) { await activate(); await expect(password).toBeFocused() }
  await password.fill('disposable-test-value')
  await application.evaluate(({ app }) => app.hide())
  await expect.poll(async () => (await state()).focusedClientId).toBeNull()
  await new Promise(resolve => setTimeout(resolve, 700))
  await expect(password).toHaveValue('disposable-test-value')
  await activate(); await password.press('Enter')
  await completed(id)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === id).result).toEqual({ received: true })
  expect(JSON.stringify((await state()).pluginRuns)).not.toContain('disposable-test-value')
  await activate()
  let cancelled = await run('pick'); await expect(chrome.getByRole('textbox', { name: 'Fixture login' })).toBeVisible()
  await chrome.keyboard.press('Escape'); await completed(cancelled, 'cancelled')
})
test('bundled shell/Python examples run from the plugin panel with prompts and results', async () => {
  let current = await state(), windowId = current.model.sessions[0].windows[0].id
  await rpc('select-window', { client: current.clientId, window: windowId }); await activate()
  let title = await rpc('plugin.run', { action: 'local.page-tools/title' }); await completed(title.id)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === title.id).result.result).toBe('Plugin fixture')
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true }); await command.fill('plugins'); await command.press('Enter')
  let panel = chrome.getByRole('dialog', { name: 'Plugins', exact: true })
  await expect(panel.getByRole('heading', { name: 'Custom', exact: true })).toBeVisible()
  let plugin = panel.getByRole('button', { name: /^Page tools/ })
  let toggle = panel.getByRole('switch', { name: 'Enable Page tools', exact: true })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(plugin).toHaveText('Page tools')
  await expect(panel.getByRole('region', { name: 'Plugin details' })).toHaveCount(0)
  expect((await rpc('plugin.list')).find((item: any) => item.id === 'local.page-tools').enabled).toBe(false)
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(plugin).toHaveText('Page tools')
  let bundled = (await rpc('plugin.list')).find((item: any) => item.bundled)
  expect(bundled).toBeTruthy()
  await expect(panel.getByRole('switch', { name: `Enable ${bundled.name}`, exact: true })).toHaveAttribute('aria-checked', String(bundled.enabled))
  await plugin.click()
  let details = panel.getByRole('region', { name: 'Plugin details' })
  await expect(panel.locator('header').getByRole('button', { name: 'Back to plugins' })).toBeFocused()
  await panel.locator('header').getByRole('button', { name: 'Back to plugins' }).press('Escape')
  await expect(plugin).toBeFocused()
  await plugin.press('i')
  await details.getByRole('button', { name: 'Jump to heading', exact: true }).click()
  let prompt = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(prompt.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  await prompt.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Jump to heading', exact: true })).toBeFocused()
  await expect(panel.getByRole('button', { name: 'Back to plugins' })).toBeVisible()
  await details.getByRole('button', { name: 'Jump to heading', exact: true }).click()
  let picker = chrome.getByRole('textbox', { name: 'Jump to heading', exact: true })
  await expect(picker).toBeFocused()
  let heading = (await state()).pluginPrompt!.runId
  await picker.press('Enter')
  await expect(picker).toHaveCount(0)
  await expect(details).toBeVisible()
  // Python launches another CLI process after the prompt to evaluate and publish
  // the result. Bound that work by its own deadline, after verifying submission.
  await completed(heading, 'completed', 15000)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === heading).result).toEqual({ scrolled: true })
  await activate()
  let annotation = await rpc('plugin.run', { action: 'local.page-tools/annotate' })
  let note = chrome.getByRole('textbox', { name: 'Note', exact: true }); await note.fill('Fixture annotation'); await note.press('Enter'); await completed(annotation.id)
  let tab = (await state()).model.sessions[0].windows[0].panes[0].id
  expect(await rpc('eval', { tab, expression: 'document.querySelector("aside").textContent' })).toBe('Fixture annotation')
})
test('navigation rejects stale fills and hidden fields; plugin waits do not block shortcuts or attachment', async () => {
  await activate()
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0], tab = pane.id
  let stale = await run('stale')
  await expect.poll(async () => (await rpc('plugin.runs')).find((item: any) => item.id === stale)?.progress?.percent).toBe(10)
  await rpc('navigate', { tab, url: `${url}/replacement`, waitUntil: 'none' }); await completed(stale)
  expect((await rpc('plugin.runs')).find((item: any) => item.id === stale).result).toEqual({ staleRejected: true })
  expect(await rpc('eval', { tab, expression: 'document.querySelector("#username").value' })).toBe('')
  await completed(await run('hidden'))
  let waiting = await run('wait'), slow = await run('slow')
  let next = await rpc('new-window', { session: current.model.sessions[0].id, name: 'other' })
  await rpc('select-window', { client: current.clientId, window: next.id })
  await expect(chrome.getByRole('button', { name: '2:other*', exact: true })).toBeVisible()
  await rpc('select-window', { client: current.clientId, window: pane ? current.model.sessions[0].windows[0].id : '' })
  await activate()
  await expect.poll(() => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some((view: any) => view.webContents?.getURL().startsWith(url))), url)).toBe(true)
  await rpc('plugin.cancel', { id: waiting }); await rpc('plugin.cancel', { id: slow }); await completed(waiting, 'cancelled')
  await activate()
  let pick = await run('pick'); await expect(chrome.getByRole('textbox', { name: 'Fixture login' })).toBeVisible()
  await rpc('select-window', { client: current.clientId, window: next.id }); await completed(pick, 'cancelled')
})

test('plugin overlay sits above the page, resizes, collapses and receives controls', async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let capture = async () => { let id = await run('capture', { pane: pane.id }); await completed(id); return (await rpc('plugin.runs')).find((run: any) => run.id === id).result.data }
  let id = await run('overlay', { pane: pane.id })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('#plugin-overlay'))).toBe(true)
  let observer = application.context().pages().find(page => page.url().endsWith('#plugin-overlay'))!
  await expect(observer.getByRole('status')).toHaveText('Waiting for Start')
  await expect(observer.getByRole('button', { name: 'Start browsing', exact: true })).toBeVisible()
  await observer.getByText('Optimise this session', { exact: true }).click()
  await expect(observer.getByRole('checkbox', { name: 'Skip ads' })).not.toBeChecked()
  let before = (await state()).pluginOverlay.bounds
  await observer.getByRole('slider', { name: 'Resize observer' }).focus()
  await observer.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await state()).pluginOverlay.bounds.width).toBe(before.width - 24)
  await observer.getByRole('button', { name: 'Collapse observer' }).click()
  await expect(observer.getByRole('button', { name: 'Expand observer' })).toBeVisible()
  await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).find((view: any) => view.webContents?.getURL().endsWith('#plugin-overlay'))?.getBounds().height)).toBe(48)
  await observer.getByRole('button', { name: 'Expand observer' }).click()
  await expect(observer.getByRole('button', { name: 'Collapse observer' })).toBeVisible()
  await expect(observer.getByRole('status')).toBeVisible()
  await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).find((view: any) => view.webContents?.getURL().endsWith('#plugin-overlay'))?.getBounds().height)).toBe(before.height)
  let captured = await capture()
  let pixel = await application.evaluate(({ BaseWindow, nativeImage }, { data, url }) => {
    let views = BaseWindow.getAllWindows().flatMap(window => window.contentView.children) as any[]
    let observer = views.find(view => view.webContents?.getURL().endsWith('#plugin-overlay')).getBounds()
    let page = views.find(view => view.webContents?.getURL().startsWith(url)).getBounds()
    let image = nativeImage.createFromBuffer(Buffer.from(data, 'base64')), size = image.getSize()
    let x = Math.floor((observer.x + observer.width / 2 - page.x) / page.width * size.width)
    let y = Math.floor((observer.y + observer.height / 2 - page.y) / page.height * size.height)
    let offset = (y * size.width + x) * 4
    return [...image.toBitmap().subarray(offset, offset + 3)]
  }, { data: captured, url })
  // This point is dark in the observer and white in the fixture page beneath it.
  expect(pixel).toHaveLength(3)
  expect(pixel.every(channel => channel > 240)).toBe(true)
  await observer.screenshot({ path: path.resolve('artifacts/plugin-overlay.png') })
  await observer.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await completed(id)
  await expect(observer.getByRole('button', { name: 'Restart session', exact: true })).toBeVisible()
  let page = application.context().pages().find(page => page.url().startsWith(url))!
  expect(await page.evaluate(() => typeof (window as any).bmux)).toBe('undefined')
})

test('Social Media details launch one settings form and a muted window with the active profile', async () => {
  let before = await state(), client = before.model.clients.find((client: any) => client.id === before.clientId)
  let profile = (await rpc('profile.create', { name: 'Feed launch fixture' })).id
  let source = await rpc('new-window', { session: client.sessionId, client: client.id, profile, url })
  await rpc('wait', { pane: source.panes[0].id, selector: '#username' }); await activate()
  let windows = (await state()).model.sessions.find((session: any) => session.id === client.sessionId).windows.length
  await chrome.getByRole('button', { name: 'Command prompt' }).click()
  let command = chrome.getByRole('combobox', { name: 'Command', exact: true }); await command.fill('plugins'); await command.press('Enter')
  let panel = chrome.getByRole('dialog', { name: 'Plugins', exact: true })
  await expect(panel.getByRole('heading', { name: 'Social Media', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Fixture plugin', exact: true }).click()
  let details = panel.getByRole('region', { name: 'Plugin details' })
  await expect(details.getByText('Feed browsing and all platform tools.')).toBeVisible()
  await expect(details.getByRole('button', { name: 'password', exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Simulate feed browsing', exact: true }).click()
  let dialog = chrome.getByRole('dialog', { name: 'Plugin', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Fixture plugin · Simulate feed browsing' })).toBeVisible()
  await expect(dialog.getByText('Opens a new muted window using Feed launch fixture.')).toBeVisible()
  await expect(dialog.getByLabel('Duration in seconds')).toHaveValue('300')
  await expect(dialog.getByLabel('Skip ads')).toHaveValue('false')
  await expect(dialog.getByLabel('Session ID')).toHaveCount(0)
  await fs.mkdir(path.resolve('artifacts'), { recursive: true }); await chrome.screenshot({ path: path.resolve('artifacts/social-plugin-settings.png') })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await state()).model.sessions.find((session: any) => session.id === client.sessionId).windows.length).toBe(windows)
  let id = await run('launch')
  await dialog.getByLabel('Duration in seconds').fill('5')
  await dialog.getByRole('button', { name: 'Start browsing', exact: true }).click()
  await completed(id)
  let current = await state(), selected = current.model.clients.find((client: any) => client.id === current.clientId)
  let session = current.model.sessions.find((session: any) => session.id === selected.sessionId), window = session.windows.find((window: any) => window.id === selected.windowId)
  expect(session.windows.length).toBe(windows + 1)
  expect(window.id).not.toBe(source.id)
  expect(window.panes[0].profileId).toBe(profile)
  expect(session.windows.find((window: any) => window.id === source.id).panes[0].url).toBe(url + '/')
  expect((await rpc('plugin.runs')).find((run: any) => run.id === id).result).toEqual({ pane: window.panes[0].id, profile, approved: true, url: 'https://example.test/feed', parameters: { seconds: '5', ads: false } })
  expect(await application.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL() === 'about:blank' && contents.isAudioMuted()))).toBe(true)
  await expect(dialog).toHaveCount(0)
  await expect(chrome.getByRole('combobox', { name: 'URL or search' })).toHaveCount(0)
})
