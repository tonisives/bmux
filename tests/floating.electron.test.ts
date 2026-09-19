import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { observeNativeFocus, recordNativeFocus } from './native-focus'

let application: ElectronApplication, chrome: Page, directory: string, server: http.Server, url: string
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let frame = async (paneId: string) => {
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith(`#float=${paneId}`))).toBe(true)
  let page = application.context().pages().find(page => page.url().endsWith(`#float=${paneId}`))!
  await expect(page.getByRole('textbox', { name: 'Address', exact: true })).toBeVisible()
  return page
}
let views = () => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter(window => window.isVisible()).map(window => ({ id: window.id, bounds: window.getContentBounds(), children: window.contentView.children.flatMap(view => 'webContents' in view ? [{ url: (view as Electron.WebContentsView).webContents.getURL(), bounds: view.getBounds(), visible: view.getVisible() }] : []) })))
let nativeMouse = async (events: { type: number; x: number; y: number }[]) => {
  // Quartz posts to the guest desktop, exercising native view hit testing.
  let script = `ObjC.import('CoreGraphics'); let events = ${JSON.stringify(events)}; events.forEach(e => { let event = $.CGEventCreateMouseEvent(null, e.type, $.CGPointMake(e.x, e.y), 0); $.CGEventPost(0, event); delay(0.08); });`
  await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script])
}
let click = (x: number, y: number) => nativeMouse([{ type: 5, x, y }, { type: 1, x, y }, { type: 2, x, y }])
let drag = (x: number, y: number, dx: number, dy: number) => nativeMouse([{ type: 5, x, y }, { type: 1, x, y }, ...Array.from({ length: 8 }, (_, i) => ({ type: 6, x: x + dx * (i + 1) / 8, y: y + dy * (i + 1) / 8 })), { type: 2, x: x + dx, y: y + dy }])
let launch = async () => {
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await observeNativeFocus(application)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await expect.poll(async () => (await state()).model.clients.length).toBe(1)
}
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-floating-'))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><title>${request.url}</title><style>body{margin:0;height:2000px;background:#d9e7ee;font:20px sans-serif}button,a{display:block;margin:20px;padding:15px}</style><button id="counter" onclick="this.textContent=++window.count">0</button><a href="/linked">Open linked page</a><article><div id="script-link">JavaScript-driven post</div></article><script>window.count=0;window.identity=Math.random();document.addEventListener('mousedown',()=>window.clicked=(window.clicked||0)+1);document.addEventListener('bmux:resolve-context-link',event=>{if(event.detail.target.closest('#script-link'))event.detail.url='/resolved-post'})</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await launch()
  expect((await state()).configError).toBeNull()
})
test.afterEach(async ({}, info) => { await recordNativeFocus(application, info) })
test.afterAll(async () => {
  await application?.close().catch(() => undefined)
  server?.closeAllConnections()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

test('floating panes preserve live pages, stack, drag, resize, dock and restore', async ({}, info) => {
  test.setTimeout(180_000)
  let initial = await state(), client = initial.model.clients[0], window = initial.model.sessions[0].windows[0], tiled = window.panes[0]
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(`${url}/tiled`); await address.press('Enter')
  await rpc('wait', { tab: tiled.activeTabId, selector: '#counter' })
  let right = await rpc('split-window', { pane: tiled.id, url: `${url}/right` })
  await rpc('wait', { tab: right.activeTabId, selector: '#counter' })
  let identity = await rpc('eval', { tab: right.activeTabId, expression: 'window.identity' })
  let systemWindows = await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)
  await rpc('break-pane', { pane: right.id, floating: true, client: client.id })
  let firstFrame = await frame(right.id)
  expect(await rpc('eval', { tab: right.activeTabId, expression: 'window.identity' })).toBe(identity)
  expect(await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(systemWindows)
  await rpc('activate-client', { client: client.id })
  let before = (await views())[0], rect = before.children.find(view => view.url.endsWith(`#float=${right.id}`))!.bounds
  await drag(before.bounds.x + rect.x + 90, before.bounds.y + rect.y + 18, 180, 100)
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].floating[0].x).toBe(rect.x + 180)
  let moved = (await views())[0].children.find(view => view.url.endsWith(`#float=${right.id}`))!.bounds
  await drag(before.bounds.x + moved.x + moved.width - 3, before.bounds.y + moved.y + moved.height - 3, -100, -80)
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].floating[0].width).toBe(moved.width - 100)

  let second = await rpc('new-pane', { pane: tiled.id, client: client.id })
  let secondFrame = await frame(second.id)
  let floatingAddress = secondFrame.getByRole('textbox', { name: 'Address', exact: true })
  await floatingAddress.fill(`${url}/float`); await floatingAddress.press('Enter')
  await rpc('wait', { tab: second.activeTabId, selector: '#counter' })
  await expect.poll(async () => (await views())[0].children.some(view => view.url === `${url}/float` && view.bounds.width > 300)).toBe(true)
  let native = (await views())[0]
  let page = native.children.find(view => view.url === `${url}/float`)!
  await click(native.bounds.x + page.bounds.x + 45, native.bounds.y + page.bounds.y + 40)
  await expect.poll(() => rpc('eval', { tab: second.activeTabId, expression: 'window.count' })).toBe(1)
  expect(await rpc('eval', { tab: tiled.activeTabId, expression: 'window.count' })).toBe(0)
  await rpc('select-pane', { client: client.id, pane: right.id })
  await expect.poll(async () => (await views())[0].children.filter(view => [url + '/right', url + '/float'].includes(view.url)).at(-1)?.url).toBe(url + '/right')
  await firstFrame.screenshot({ path: info.outputPath('floating-frame.png') })
  await promisify(execFile)('/usr/sbin/screencapture', ['-x', info.outputPath('floating-desktop.png')])

  await rpc('toggle-pane-zoom', { client: client.id })
  await expect.poll(async () => (await views())[0].children.filter(view => view.visible && view.url.startsWith(url)).map(view => view.url)).toEqual([url + '/right'])
  await rpc('toggle-pane-zoom', { client: client.id })
  await frame(right.id)
  await rpc('client.overlay', { client: client.id, visible: true })
  expect((await views())[0].children.filter(view => view.visible && (view.url.startsWith(url) || view.url.includes('#float=')))).toHaveLength(0)
  await rpc('client.overlay', { client: client.id, visible: false })
  await rpc('join-pane', { pane: right.id, client: client.id })
  expect(await rpc('eval', { tab: right.activeTabId, expression: 'window.identity' })).toBe(identity)
  let saved = (await state()).model.sessions[0].windows[0].floating
  expect(saved).toHaveLength(1)
  await rpc('save-layout', { window: window.id, name: 'floats' })
  await application.close()
  await launch()
  expect((await state()).model.sessions[0].windows[0].floating).toEqual(saved)
  await frame(second.id)
  let destination = await rpc('new-window', { session: initial.model.sessions[0].id, name: 'destination' })
  await rpc('move-pane', { pane: second.id, window: destination.id })
  let after = await state()
  expect(after.model.sessions[0].windows.find((item: any) => item.id === destination.id).panes.some((pane: any) => pane.id === second.id)).toBe(true)
  expect(after.model.sessions[0].windows[0].floating).toHaveLength(0)
})

test('page context menu opens links in a float using the source profile', async () => {
  let current = await state(), client = current.model.clients[0], window = current.model.sessions[0].windows[0], pane = window.panes[0]
  await rpc('select-window', { client: client.id, window: window.id })
  await rpc('wait', { tab: pane.activeTabId, selector: 'a' })
  // Observe the native menu, then invoke the actual menu item's click handler.
  await application.evaluate(({ Menu }) => {
    let build = Menu.buildFromTemplate
    ;(globalThis as any).restoreFloatingMenu = () => { Menu.buildFromTemplate = build }
    Menu.buildFromTemplate = template => {
      let menu = build(template)
      ;(globalThis as any).floatingMenu = menu
      menu.popup = () => undefined
      return menu
    }
  })
  try {
    let page = application.context().pages().find(page => page.url() === `${url}/tiled`)!
    await page.locator('a').click({ button: 'right' })
    await expect.poll(() => application.evaluate(() => (globalThis as any).floatingMenu?.items.some((item: any) => item.label === 'Open Link in Floating Pane'))).toBe(true)
    await application.evaluate(() => { let item = (globalThis as any).floatingMenu.items.find((item: any) => item.label === 'Open Link in Floating Pane'); item.click() })
    await expect.poll(async () => (await state()).model.sessions[0].windows[0].floating.length).toBe(1)
    let added = (await state()).model.sessions[0].windows[0].panes.at(-1)
    expect(added.profileId).toBe(pane.profileId)
    await rpc('wait', { tab: added.activeTabId, selector: '#counter' })
    expect((await state()).model.sessions[0].windows[0].panes.at(-1).tabs[0].url).toBe(`${url}/linked`)
  } finally { await application.evaluate(() => (globalThis as any).restoreFloatingMenu()) }
})

test('page context menu resolves JavaScript-driven links', async () => {
  let current = await state(), client = current.model.clients[0], pane = current.model.sessions[0].windows[0].panes[0]
  await rpc('select-pane', { client: client.id, pane: pane.id })
  await rpc('navigate', { tab: pane.activeTabId, url: `${url}/script-link` })
  await rpc('wait', { tab: pane.activeTabId, selector: '#script-link' })
  await application.evaluate(({ Menu }) => {
    let build = Menu.buildFromTemplate
    ;(globalThis as any).restoreFloatingMenu = () => { Menu.buildFromTemplate = build }
    Menu.buildFromTemplate = template => {
      let menu = build(template)
      ;(globalThis as any).floatingMenu = menu
      menu.popup = () => undefined
      return menu
    }
  })
  try {
    let page = application.context().pages().find(page => page.url() === `${url}/script-link`)!
    await page.locator('#script-link').click({ button: 'right' })
    await expect.poll(() => application.evaluate(() => (globalThis as any).floatingMenu?.items.some((item: any) => item.label === 'Open Link in Floating Pane'))).toBe(true)
    await application.evaluate(() => { let item = (globalThis as any).floatingMenu.items.find((item: any) => item.label === 'Open Link in Floating Pane'); item.click() })
    await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes.at(-1).tabs[0].url).toBe(`${url}/resolved-post`)
  } finally { await application.evaluate(() => (globalThis as any).restoreFloatingMenu()) }
})

test('only-floating windows support saved layouts, window switching and competing clients', async () => {
  let original = await state(), client = original.model.clients[0]
  let session = await rpc('new-session', { name: 'floating-only', profile: 'bot' })
  let window = session.windows[0], pane = window.panes[0]
  await rpc('switch-client', { client: client.id, session: session.id })
  await rpc('navigate', { tab: pane.activeTabId, url: `${url}/only` })
  await rpc('wait', { tab: pane.activeTabId, selector: '#counter' })
  let identity = await rpc('eval', { tab: pane.activeTabId, expression: 'window.identity' })
  await rpc('break-pane', { client: client.id, pane: pane.id, floating: true })
  await frame(pane.id)
  expect((await rpc('list-windows', { session: session.id }))[0].layout).toBeNull()
  await rpc('save-layout', { window: window.id, name: 'only-floating' })
  let other = await rpc('new-window', { session: session.id, name: 'other' })
  await rpc('select-window', { client: client.id, window: other.id })
  await expect.poll(async () => (await views())[0].children.some(view => view.url.includes('#float='))).toBe(false)
  await rpc('select-window', { client: client.id, window: window.id })
  await frame(pane.id)
  let secondClient = await rpc('attach-session', { session: session.id })
  await rpc('activate-client', { client: secondClient.id })
  await expect.poll(async () => (await views()).flatMap(window => window.children).filter(view => view.url === `${url}/only`).length).toBe(1)
  expect(await rpc('eval', { tab: pane.activeTabId, expression: 'window.identity' })).toBe(identity)
  await expect.poll(async () => !!(await state()).snapshots[pane.activeTabId]).toBe(true)
  await rpc('detach-client', { client: secondClient.id })
  await rpc('activate-client', { client: client.id })
  await rpc('restore-layout', { window: window.id, name: 'only-floating', confirm: true })
  let restored = (await rpc('list-windows', { session: session.id }))[0]
  expect(restored.floating[0].paneId).toBe(restored.panes[0].id)
  expect(restored.panes[0].profileId).toBe('profile_bot')
  expect(restored.panes[0].id).not.toBe(pane.id)
  await frame(restored.panes[0].id)
  await rpc('kill-pane', { pane: restored.panes[0].id })
  expect((await rpc('list-windows', { session: session.id })).map((window: any) => window.id)).toEqual([other.id])
})
