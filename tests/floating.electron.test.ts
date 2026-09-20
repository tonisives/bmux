import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { observeNativeFocus, recordNativeFocus, sendNativeKeys } from './native-focus'

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
let expectCoveredCorners = async (pageUrl: string, screenshotPath: string, insideColor = [0xd9, 0xe7, 0xee]) => {
  await expect(async () => {
    await promisify(execFile)('/usr/sbin/screencapture', ['-x', screenshotPath])
    let colors = await application.evaluate(({ BaseWindow, nativeImage, screen }, { pageUrl, screenshotPath }) => {
      let window = BaseWindow.getAllWindows().find(window => window.isVisible())!
      let page = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === pageUrl)!
      let bounds = page.getBounds(), origin = window.getContentBounds()
      let image = nativeImage.createFromPath(screenshotPath), size = image.getSize(), pixels = image.toBitmap()
      let display = screen.getPrimaryDisplay().bounds, scale = size.width / display.width
      let color = (x: number, y: number) => {
        let offset = (Math.floor((origin.y + bounds.y + y - display.y) * scale) * size.width + Math.floor((origin.x + bounds.x + x - display.x) * scale)) * 4
        return [pixels[offset + 2], pixels[offset + 1], pixels[offset]]
      }
      return {
        corners: [[0, 0], [bounds.width - 1, 0], [0, bounds.height - 1], [bounds.width - 1, bounds.height - 1]].map(([x, y]) => color(x, y)),
        well: [[-2, bounds.height / 2], [bounds.width + 1, bounds.height / 2], [bounds.width / 2, -3], [bounds.width / 2, bounds.height + 2]].map(([x, y]) => color(x, y)),
        inside: color(bounds.width / 2, bounds.height - 3),
      }
    }, { pageUrl, screenshotPath })
    for (let color of colors.corners) expect(color).toEqual([0x11, 0x13, 0x18])
    for (let color of colors.well) expect(color).toEqual([0x11, 0x13, 0x18])
    expect(colors.inside).toEqual(insideColor)
  }).toPass({ timeout: 5000 })
}
let launch = async () => {
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await observeNativeFocus(application)
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await expect.poll(async () => (await state()).model.clients.length).toBe(1)
}
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-floating-'))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard:\n  shortcuts:\n    Cmd+W: close-pane-or-window\nbrowser:\n  autoUpdateFilters: false\n')
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

test('floating corners stay covered over composited pages after repainting', async ({}, info) => {
  let current = await state(), client = current.model.clients[0]
  let floating = await rpc('new-pane', { pane: client.paneId, client: client.id })
  let floatingFrame = await frame(floating.id)
  let address = floatingFrame.getByRole('textbox', { name: 'Address', exact: true })
  await address.fill(`${url}/composited`); await address.press('Enter')
  await rpc('wait', { tab: floating.activeTabId, selector: '#counter' })
  let paint = () => rpc('eval', { tab: floating.activeTabId, expression: `(() => {
    let canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483647;transform:translateZ(0)';
    document.body.append(canvas);
    let gl = canvas.getContext('webgl');
    if (!gl) throw new Error('WebGL unavailable');
    let draw = () => { gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(draw) };
    draw();
    return true;
  })()` })
  await paint()
  await rpc('activate-client', { client: client.id })
  await expectCoveredCorners(`${url}/composited`, info.outputPath('floating-webgl.png'), [255, 0, 255])
  await rpc('float.bounds', { client: client.id, pane: floating.id, x: 150, y: 100, width: 530, height: 360, commit: true })
  await rpc('client.overlay', { client: client.id, visible: true })
  await expect.poll(async () => !!(await state()).snapshots[floating.activeTabId]).toBe(true)
  await rpc('client.overlay', { client: client.id, visible: false })
  await expect(floatingFrame.locator('img')).toBeVisible()
  await expectCoveredCorners(`${url}/composited`, info.outputPath('floating-webgl-resized.png'), [255, 0, 255])
  await rpc('reload', { tab: floating.activeTabId })
  await rpc('wait', { tab: floating.activeTabId, selector: '#counter' })
  await paint()
  await expectCoveredCorners(`${url}/composited`, info.outputPath('floating-webgl-reloaded.png'), [255, 0, 255])
  let otherOrigin = url.replace('127.0.0.1', 'localhost')
  await rpc('navigate', { tab: floating.activeTabId, url: `${otherOrigin}/composited` })
  await rpc('wait', { tab: floating.activeTabId, selector: '#counter' })
  await paint()
  await expectCoveredCorners(`${otherOrigin}/composited`, info.outputPath('floating-webgl-new-origin.png'), [255, 0, 255])
  await rpc('kill-pane', { pane: floating.id, confirm: true })
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
  let knobControl = firstFrame.getByRole('button', { name: 'Move floating pane' })
  let knob = await knobControl.boundingBox()
  let backButton = await firstFrame.getByRole('button', { name: 'Back' }).boundingBox()
  let reloadButton = await firstFrame.getByRole('button', { name: 'Reload' }).boundingBox()
  let floatingAddressBox = await firstFrame.getByRole('textbox', { name: 'Address', exact: true }).boundingBox()
  let dragSpace = await firstFrame.locator('[data-drag-space]').boundingBox()
  let closeButton = await firstFrame.getByRole('button', { name: 'Close floating pane' }).boundingBox()
  expect(knob!.y + knob!.height / 2).toBe(floatingAddressBox!.y + floatingAddressBox!.height / 2)
  expect(closeButton!.y + closeButton!.height / 2).toBe(floatingAddressBox!.y + floatingAddressBox!.height / 2)
  expect([knob, backButton, reloadButton, closeButton].map(box => [box?.width, box?.height])).toEqual(Array(4).fill([30, 30]))
  let knobBackground = await knobControl.evaluate(element => getComputedStyle(element).backgroundColor)
  await knobControl.hover()
  expect(await knobControl.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(knobBackground)
  expect(dragSpace!.width).toBeGreaterThanOrEqual(40)
  let textWidth = await firstFrame.getByRole('textbox', { name: 'Address', exact: true }).evaluate(element => {
    let input = element as HTMLInputElement, canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
    context.font = getComputedStyle(input).font
    return context.measureText(input.value).width
  })
  expect(dragSpace!.x - floatingAddressBox!.x - textWidth).toBeLessThan(12)
  expect(await firstFrame.locator('header').count()).toBe(0)
  expect(await rpc('eval', { tab: right.activeTabId, expression: 'window.identity' })).toBe(identity)
  expect(await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(systemWindows)
  await rpc('activate-client', { client: client.id })
  let before = (await views())[0], rect = before.children.find(view => view.url.endsWith(`#float=${right.id}`))!.bounds
  await expect.poll(async () => (await views())[0].children.find(view => view.url === `${url}/right`)?.bounds).toEqual({ x: rect.x + 6, y: rect.y + 38, width: rect.width - 12, height: rect.height - 46 })
  await drag(before.bounds.x + rect.x + dragSpace!.x + 2, before.bounds.y + rect.y + dragSpace!.y + dragSpace!.height / 2, 180, 100)
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].floating[0].x).toBe(rect.x + 180)
  let moved = (await views())[0].children.find(view => view.url.endsWith(`#float=${right.id}`))!.bounds
  let above = await firstFrame.locator('[data-drag-above]').boundingBox()
  await drag(before.bounds.x + moved.x + above!.x + 10, before.bounds.y + moved.y + above!.y + above!.height / 2, 20, 10)
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].floating[0].x).toBe(moved.x + 20)
  moved = (await views())[0].children.find(view => view.url.endsWith(`#float=${right.id}`))!.bounds
  await drag(before.bounds.x + moved.x + moved.width - 3, before.bounds.y + moved.y + moved.height - 3, -100, -80)
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].floating[0].width).toBe(moved.width - 100)
  await expectCoveredCorners(`${url}/right`, info.outputPath('floating-resized-corners.png'))

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
  await expectCoveredCorners(`${url}/right`, info.outputPath('floating-stacked-corners.png'))
  let link = await application.context().pages().find(page => page.url() === `${url}/right`)!.locator('a').boundingBox()
  let hoveredWindow = (await views())[0], hoveredPage = hoveredWindow.children.find(view => view.url === `${url}/right`)!
  await nativeMouse([{ type: 5, x: hoveredWindow.bounds.x + hoveredPage.bounds.x + link!.x + 10, y: hoveredWindow.bounds.y + hoveredPage.bounds.y + link!.y + 10 }])
  await expect.poll(async () => (await views())[0].children.some(view => view.url.endsWith('#link-preview') && view.visible)).toBe(true)
  await expectCoveredCorners(`${url}/right`, info.outputPath('floating-link-preview-corners.png'))
  await nativeMouse([{ type: 5, x: hoveredWindow.bounds.x + 5, y: hoveredWindow.bounds.y + 5 }])

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

test('configured Command+W closes a selected float before its window', async () => {
  let current = await state(), client = current.model.clients[0]
  let session = await rpc('new-session', { name: 'close-floating', profile: 'bot' })
  await rpc('switch-client', { client: client.id, session: session.id })
  let window = session.windows[0], tiled = window.panes[0]
  let floating = await rpc('new-pane', { pane: tiled.id, client: client.id })
  await rpc('focus-page', { client: client.id })
  await sendNativeKeys(application, [{ keyCode: 'w', modifiers: ['meta'] }])
  await expect.poll(async () => (await rpc('list-windows', { session: session.id }))[0].panes.some((pane: { id: string }) => pane.id === floating.id)).toBe(false)
  expect((await rpc('list-windows', { session: session.id }))[0].id).toBe(window.id)
  await rpc('select-pane', { client: client.id, pane: tiled.id })
  await rpc('focus-page', { client: client.id })
  await sendNativeKeys(application, [{ keyCode: 'w', modifiers: ['meta'] }])
  await expect.poll(async () => (await rpc('list-sessions')).some((item: { id: string }) => item.id === session.id)).toBe(false)
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

test('reopens a closed float at its remembered position and adapts after window resizing', async () => {
  let current = await state(), client = current.model.clients[0], session = current.model.sessions.find((item: any) => item.id === client.sessionId)
  let originalWindowId = client.windowId
  let memoryWindow = await rpc('new-window', { session: session.id, name: 'floating-memory' })
  await rpc('select-window', { client: client.id, window: memoryWindow.id })
  let tiled = (await state()).model.sessions.flatMap((item: any) => item.windows).find((item: any) => item.id === memoryWindow.id).panes[0]
  let first = await rpc('new-pane', { pane: tiled.id, client: client.id })
  let before = (await state()).model.clients.find((item: any) => item.id === client.id)
  let remembered = { x: 500, y: 260, width: 420, height: 310 }
  await rpc('float.bounds', { client: client.id, pane: first.id, ...remembered, commit: true })
  await rpc('kill-pane', { pane: first.id, confirm: true })
  let reopened = await rpc('new-pane', { pane: tiled.id, client: client.id })
  await expect.poll(async () => (await state()).model.sessions.flatMap((item: any) => item.windows).find((item: any) => item.id === memoryWindow.id).floating.find((item: any) => item.paneId === reopened.id)).toMatchObject(remembered)
  await rpc('kill-pane', { pane: reopened.id, confirm: true })

  let systemWindow = await application.evaluate(({ BaseWindow }) => {
    let window = BaseWindow.getAllWindows().find(window => window.isVisible())!
    let bounds = window.getBounds()
    window.setBounds({ ...bounds, width: bounds.width - 240, height: bounds.height - 140 })
    return bounds
  })
  await expect.poll(async () => (await state()).model.clients.find((item: any) => item.id === client.id).width).toBeLessThan(before.width)
  let resized = (await state()).model.clients.find((item: any) => item.id === client.id)
  let sourceHeight = before.height - 28, resizedHeight = resized.height - 28
  let expected = {
    x: Math.round(remembered.x / (before.width - remembered.width) * (resized.width - remembered.width)),
    y: Math.round(remembered.y / (sourceHeight - remembered.height) * (resizedHeight - remembered.height)),
    width: remembered.width,
    height: remembered.height,
  }
  let scaled = await rpc('new-pane', { pane: tiled.id, client: client.id })
  await expect.poll(async () => (await state()).model.sessions.flatMap((item: any) => item.windows).find((item: any) => item.id === memoryWindow.id).floating.find((item: any) => item.paneId === scaled.id)).toMatchObject(expected)
  await application.evaluate(({ BaseWindow }, bounds) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setBounds(bounds), systemWindow)
  await rpc('select-window', { client: client.id, window: originalWindowId })
  await rpc('kill-window', { window: memoryWindow.id, confirm: true })
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

test('page context menu falls back to the hovered target and main frame', async () => {
  let current = await state(), client = current.model.clients[0], pane = current.model.sessions[0].windows[0].panes[0]
  await rpc('select-pane', { client: client.id, pane: pane.id })
  await rpc('navigate', { tab: pane.activeTabId, url: `${url}/hovered-script-link` })
  await rpc('wait', { tab: pane.activeTabId, selector: '#script-link' })
  let page = application.context().pages().find(page => page.url() === `${url}/hovered-script-link`)!
  await page.locator('#script-link').hover()
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
    await application.evaluate(({ webContents }, pageUrl) => {
      let contents = webContents.getAllWebContents().find(item => item.getURL() === pageUrl)!
      ;(contents as any).emit('context-menu', { preventDefault: () => undefined }, { linkURL: '', x: -100, y: -100, frame: undefined, selectionText: '', isEditable: false })
    }, `${url}/hovered-script-link`)
    await expect.poll(() => application.evaluate(() => (globalThis as any).floatingMenu?.items.some((item: any) => item.label === 'Open Link in Floating Pane'))).toBe(true)
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
