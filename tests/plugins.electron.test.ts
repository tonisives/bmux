import { test, expect, _electron as electron } from '@playwright/test'
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
let completed = async (id: string, status = 'completed') => { await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.id === id)?.status).toBe(status) }
let script = `import { execFileSync } from 'node:child_process';
let host = (method,args={}) => JSON.parse(execFileSync(process.env.BMUX_CLI,['plugin','host',method,'--stdin'],{input:JSON.stringify(args),encoding:'utf8',stdio:['pipe','pipe','pipe']})).result;
let context = host('context'), action = process.argv[2];
if (action === 'pick') {
 let selected = host('ui',{kind:'pick',title:'Fixture login',items:[{id:'first',label:'First user'},{id:'second',label:'Second user'}]});
 host('fill',{origin:new URL(context.url).origin,fields:[{selector:'#username',value:selected},{selector:'#password',value:'disposable-test-password'}]}); host('result',{filled:true});
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
} else if (action === 'title') { host('result',{title:host('eval',{expression:'document.title'})}); }
`
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-plugin-ui-'))
  let folder = path.join(directory, 'plugins/test'); await fs.mkdir(folder, { recursive: true })
  await fs.cp(path.resolve('examples/plugins/local.page-tools'), path.join(directory, 'plugins/local.page-tools'), { recursive: true })
  await fs.writeFile(path.join(folder, 'run.mjs'), script)
  let action = (id: string) => ({ id, title: id, command: ['node', './run.mjs', id], capabilities: ['browser.read', 'browser.write', 'ui'], timeout_seconds: 40 })
  await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Fixture plugin', version: '1', actions: ['pick', 'stale', 'slow', 'wait', 'hidden', 'title'].map(action).concat([{ ...action('password'), parameters: [{ name: 'password', title: 'Fixture password', kind: 'password', required: true }] } as any]), hooks: [{ ...action('ready'), event: 'page-ready', matches: ['http://127.0.0.1:*/*'] }, { ...action('changed'), event: 'url-change', matches: ['http://127.0.0.1:*/*'] }] }))
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: { shortcuts: { 'Cmd+Shift+L': 'plugin:test/pick' } }, plugins: { test: { enabled: true, hooks: true }, 'local.page-tools': { enabled: true } } }))
  server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Plugin fixture</title><h1>Plugin fixture</h1><input id="username" autocomplete="username"><input id="password" type="password"><input id="hidden" type="hidden"><p id="note">Native page content</p>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}`
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_DEBUG: '1' } })
  await observeNativeFocus(application)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  let current = await state(); await rpc('activate-client', { client: current.clientId })
})
test.afterAll(async () => {
  await application?.close().catch(() => undefined)
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})
test.afterEach(async ({}, info) => { await recordNativeFocus(application, info) })
test.beforeEach(async ({}, info) => {
  let current = await state(), first = current.model.sessions[0].windows[0]
  await rpc('select-window', { client: current.clientId, window: first.id }); await activate()
  if (!info.title.startsWith('typed URLs')) {
    await rpc('navigate', { tab: first.panes[0].activeTabId, url })
    await rpc('wait', { tab: first.panes[0].activeTabId, selector: '#username' })
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
  await chrome.getByRole('button', { name: 'Jump to heading', exact: true }).click()
  let picker = chrome.getByRole('textbox', { name: 'Jump to heading', exact: true })
  await expect(picker).toBeFocused(); await picker.press('Enter')
  await expect.poll(async () => (await rpc('plugin.runs')).find((item: any) => item.pluginId === 'local.page-tools' && item.actionId === 'heading')?.status).toBe('completed')
  await activate()
  let annotation = await rpc('plugin.run', { action: 'local.page-tools/annotate' })
  let note = chrome.getByRole('textbox', { name: 'Note', exact: true }); await note.fill('Fixture annotation'); await note.press('Enter'); await completed(annotation.id)
  let tab = (await state()).model.sessions[0].windows[0].panes[0].activeTabId
  expect(await rpc('eval', { tab, expression: 'document.querySelector("aside").textContent' })).toBe('Fixture annotation')
})
test('navigation rejects stale fills and hidden fields; plugin waits do not block shortcuts or attachment', async () => {
  await activate()
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0], tab = pane.activeTabId
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
