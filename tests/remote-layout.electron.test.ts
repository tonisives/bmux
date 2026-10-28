import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { externalizeDepsPlugin } from 'electron-vite'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { pageVimPlugin } from '../page-vim-build'
import { closeTestApplication } from './electron-fixture'

let fixtureDirectory: string
test.beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-layout-build-'))
  await fs.writeFile(path.join(fixtureDirectory, 'package.json'), '{"type":"module"}')
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(fixtureDirectory, 'node_modules'))
  for (let directory of ['preload', 'renderer', 'native']) await fs.symlink(path.join(process.cwd(), 'out', directory), path.join(fixtureDirectory, directory))
  if (process.platform === 'darwin') await promisify(execFile)('/usr/bin/xcrun', ['clang', '-bundle', '-undefined', 'dynamic_lookup', '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-DNAPI_VERSION=8', '-I', createRequire(import.meta.url)('node-api-headers').include_dir, 'tests/fixtures/native-hit-test.m', '-framework', 'Cocoa', '-o', path.join(fixtureDirectory, 'native-hit-test.node')])
  await build({ configFile: false, logLevel: 'error', plugins: [externalizeDepsPlugin(), pageVimPlugin()], build: { ssr: true, emptyOutDir: false, outDir: path.join(fixtureDirectory, 'main'), rollupOptions: { input: 'tests/fixtures/remote-layout-main.ts', output: { format: 'es', entryFileNames: 'remote-layout-main.js' } } } })
})
test.afterAll(async () => { if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true }) })

test('viewport lock keeps split pages fixed across resizing, client handoff and relaunch', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-viewport-lock-'))
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Viewport lock</title><style>html,body{margin:0;min-width:2400px;min-height:2400px;background:rgb(207,61,89)}</style><h1>Viewport lock</h1>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
  let launch = () => electron.launch({ args: [path.join(fixtureDirectory, 'main/remote-layout-main.js')], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml') } })
  let application = await launch()
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let current = await state(), client = current.model.clients.find((client: { id: string }) => client.id === current.clientId)
    await rpc('activate-client', { client: client.id })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let first = application.context().pages().find(page => page.url() === url)!
    await expect(first.getByRole('heading')).toHaveText('Viewport lock')
    let added = await rpc('split-window', { client: client.id, pane: client.paneId, axis: 'horizontal', url: `${url}second` })
    await expect.poll(() => application.context().pages().some(page => page.url() === `${url}second`)).toBe(true)
    let second = application.context().pages().find(page => page.url() === `${url}second`)!
    await expect(second.getByRole('heading')).toHaveText('Viewport lock')
    let size = (page: typeof first) => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    let content = (pane: string) => chrome.locator(`[data-content-pane-id="${pane}"]`)
    for (let [pane, page] of [[client.paneId, first], [added.id, second]] as const) await expect.poll(async () => {
      let rect = (await content(pane).boundingBox())!, viewport = await size(page)
      return Math.abs(rect.width - viewport.width) <= 1 && Math.abs(rect.height - viewport.height) <= 1
    }).toBe(true)
    let locked = { [client.paneId]: await size(first), [added.id]: await size(second) }
    await application.evaluate(({ Menu }) => {
      let build = Menu.buildFromTemplate
      Menu.buildFromTemplate = template => {
        let menu = build(template)
        if (template.some(item => item.label === 'Duplicate Window')) { (globalThis as any).viewportMenu = menu; menu.popup = () => undefined }
        return menu
      }
    })
    await chrome.locator(`[data-window-id="${client.windowId}"]`).click({ button: 'right' })
    await expect.poll(() => application.evaluate(() => (globalThis as any).viewportMenu?.items.map((item: Electron.MenuItem) => item.label))).toContain('Lock Viewport')
    expect(await application.evaluate(() => {
      let items = (globalThis as any).viewportMenu.items as Electron.MenuItem[]
      let index = items.findIndex(item => item.label === 'Lock Window')
      return { before: items[index - 1].type, after: items[index + 2].type, icons: items.slice(index, index + 2).map(item => item.icon && typeof item.icon !== 'string' ? !item.icon.isEmpty() : false), distinct: (items[index].icon as Electron.NativeImage).toDataURL() !== (items[index + 1].icon as Electron.NativeImage).toDataURL() }
    })).toEqual({ before: 'separator', after: 'separator', icons: [true, true], distinct: true })
    await application.evaluate(() => (globalThis as any).viewportMenu.items.find((item: Electron.MenuItem) => item.label === 'Lock Viewport').click())
    let windowState = async () => (await state()).model.sessions.flatMap((session: any) => session.windows).find((window: any) => window.id === client.windowId)
    await expect.poll(async () => (await windowState()).lockedViewports).toEqual(locked)
    let tab = chrome.locator(`[data-window-id="${client.windowId}"]`)
    await expect(tab.getByRole('img', { name: 'Viewport locked', exact: true })).toBeVisible()
    await rpc('lock-window', { window: client.windowId })
    await expect(tab.getByRole('img', { name: 'Locked', exact: true })).toBeVisible()
    await expect(tab.getByRole('img', { name: 'Viewport locked', exact: true })).toBeVisible()
    await rpc('toggle-window-pin', { window: client.windowId })
    for (let icon of await tab.getByRole('img').all()) {
      let rect = (await icon.boundingBox())!, bounds = (await tab.boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x)
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width)
    }
    await chrome.screenshot({ path: info.outputPath('window-lock-icons.png') })
    await rpc('toggle-window-pin', { window: client.windowId })
    await rpc('unlock-window', { window: client.windowId })
    await application.evaluate(() => {
      let runtime = (globalThis as any).remoteLayoutRuntime, original = runtime.setBounds
      runtime.setBounds = (id: number, bounds: unknown) => { (globalThis as any).viewportBounds = bounds; original(id, bounds) }
    })
    let nativeResize = (width: number, height: number) => application.evaluate(({ BaseWindow }, size) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setSize(size.width, size.height), { width, height })
    await nativeResize(840, 560)
    for (let [pane, page] of [[client.paneId, first], [added.id, second]] as const) {
      await expect.poll(() => size(page)).toEqual(locked[pane])
      await expect.poll(() => content(pane).evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true)
    }
    let native = () => application.evaluate(({ BaseWindow }, url) => {
      let visit = (parent: Electron.View): any => {
        for (let view of parent.children) {
          if ('webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url) return { page: view.getBounds(), clip: parent.getBounds() }
          let found = visit(view)
          if (found) return found
        }
      }
      return BaseWindow.getAllWindows().map(window => visit(window.contentView)).find(Boolean)
    }, url)
    try {
      await expect.poll(async () => {
        let area = await content(client.paneId).evaluate(element => ({ width: element.clientWidth, height: element.clientHeight })), bounds = await native()
        return Math.abs(bounds.clip.width - area.width) <= 1 && Math.abs(bounds.clip.height - area.height) <= 1
      }).toBe(true)
      await first.mouse.move(100, 100)
      await first.mouse.wheel(0, 80)
      await expect.poll(() => first.evaluate(() => scrollY)).toBe(80)
      expect(await content(client.paneId).evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual({ x: 0, y: 0 })
      await first.evaluate(() => scrollTo(0, 0))
      await expect.poll(() => first.evaluate(() => scrollY)).toBe(0)
      await first.keyboard.down('Shift')
      try { await first.mouse.wheel(60, 70) }
      finally { await first.keyboard.up('Shift') }
      await expect.poll(() => content(client.paneId).evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual({ x: 60, y: 70 })
      expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
      await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: -60, y: -70 })
      await application.evaluate((_electron, pane) => (globalThis as any).remoteLayoutRuntime.execute({ method: 'eval', args: { pane, expression: '1', agentId: 'viewport-gesture-test' } }), client.paneId)
      await expect.poll(async () => (await state()).lockedAgentPanes).toContain(client.paneId)
      let shield: Page | undefined
      await expect.poll(async () => {
        for (let page of application.context().pages().filter(page => page.url().includes('Agent%20input%20lock'))) if (await page.title() === 'Agent input lock') { shield = page; return true }
        return false
      }).toBe(true)
      await expect(shield!.getByRole('status')).toBeVisible()
      await shield!.mouse.move(100, 100)
      await shield!.keyboard.down('Shift')
      try { await shield!.mouse.wheel(20, 30) }
      finally { await shield!.keyboard.up('Shift') }
      await expect.poll(() => content(client.paneId).evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual({ x: 80, y: 100 })
      await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: -80, y: -100 })
      expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
      await rpc('agent.input-lock.override', { pane: client.paneId, enabled: true })
    } catch (error) {
      let reported = await application.evaluate(({ BaseWindow }) => ({ bounds: (globalThis as any).viewportBounds, windows: BaseWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), bounds: window.getBounds() })) }))
      let details = { native: await native(), reported, state: await state(), scroll: await content(client.paneId).evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop, width: element.clientWidth, height: element.clientHeight })) }
      await fs.writeFile(info.outputPath('viewport-scroll.json'), JSON.stringify(details, null, 2))
      throw error
    }
    let other = await rpc('attach-session', { session: client.sessionId })
    await expect.poll(() => application.context().pages().filter(page => page.url().endsWith('/renderer/index.html')).length).toBe(2)
    let otherChrome = application.context().pages().find(page => page !== chrome && page.url().endsWith('/renderer/index.html'))!
    await rpc('select-window', { client: other.id, window: client.windowId })
    await rpc('activate-client', { client: other.id })
    await application.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()!.setSize(1000, 650))
    await expect.poll(async () => (await state()).focusedClientId).toBe(other.id)
    for (let [pane, page] of [[client.paneId, first], [added.id, second]] as const) await expect.poll(() => size(page)).toEqual(locked[pane])
    let third = await otherChrome.evaluate(async ({ pane, client, url }) => (window as any).bmux.command({ method: 'split-window', args: { client, pane, axis: 'vertical', url } }), { pane: added.id, client: other.id, url: `${url}third` })
    await expect.poll(async () => !!(await windowState()).lockedViewports[third.id]).toBe(true)
    await otherChrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
    let prompt = otherChrome.getByRole('combobox', { name: 'Command', exact: true })
    await prompt.fill('unlock-viewport')
    await expect(otherChrome.getByRole('option').filter({ hasText: 'unlock-viewport' }).first()).toBeVisible()
    await prompt.press('Enter')
    await expect.poll(async () => (await windowState()).lockedViewports).toBeUndefined()
    await expect.poll(async () => {
      let rect = (await otherChrome.locator(`[data-content-pane-id="${client.paneId}"]`).boundingBox())!, viewport = await size(first)
      return Math.abs(rect.width - viewport.width) <= 1 && Math.abs(rect.height - viewport.height) <= 1
    }).toBe(true)
    let unlockedSize = await size(first)
    await otherChrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
    await prompt.fill('lock-viewport'); await prompt.press('Enter')
    await expect.poll(async () => Object.keys((await windowState()).lockedViewports ?? {}).length).toBe(3)
    let saved = (await windowState()).lockedViewports
    expect(saved[client.paneId]).toEqual(unlockedSize)
    await rpc('break-pane', { client: other.id, pane: client.paneId, floating: true })
    let floating: Page | undefined
    await expect.poll(async () => {
      for (let page of application.context().pages().filter(page => page.url().endsWith(`#float=${client.paneId}`))) {
        if (await page.evaluate(async () => (await (window as any).bmux.state()).clientId) === other.id) { floating = page; return true }
      }
      return false
    }).toBe(true)
    await rpc('float.bounds', { client: other.id, pane: client.paneId, x: 80, y: 80, width: 320, height: 240, commit: true })
    let floatingViewport = floating!.locator('[data-remote-viewport]')
    await expect.poll(() => size(first)).toEqual(saved[client.paneId])
    await expect.poll(async () => {
      let area = await floatingViewport.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight })), bounds = await native()
      return Math.abs(bounds.clip.width - area.width) <= 1 && Math.abs(bounds.clip.height - area.height) <= 1
    }).toBe(true)
    await first.mouse.move(100, 100)
    await first.keyboard.down('Shift')
    try { await first.mouse.wheel(50, 60) }
    finally { await first.keyboard.up('Shift') }
    await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: -50, y: -60 })
    await otherChrome.screenshot({ path: info.outputPath('locked-split-viewport.png') })
    await closeTestApplication(application)
    application = await launch()
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await expect.poll(async () => (await windowState()).lockedViewports).toEqual(saved)
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    first = application.context().pages().find(page => page.url() === url)!
    await expect(first.getByRole('heading')).toHaveText('Viewport lock')
    await expect.poll(() => size(first)).toEqual(saved[client.paneId])
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})

for (let position of ['top', 'bottom']) test(`remote viewport stays inside the native content area with ${position} status bar`, async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-layout-'))
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Remote layout</title><style>html,body{margin:0;width:100%;height:100%;background:rgb(207,61,89)}</style><h1>Remote layout</h1>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await fs.writeFile(path.join(directory, 'config.yaml'), `statusBar: ${position}\nkeyboard: {}\nbrowser:\n  autoUpdateFilters: false\n`)
  let application = await test.step('Launch the isolated remote layout fixture', () => electron.launch({ args: [path.join(fixtureDirectory, 'main/remote-layout-main.js')], timeout: 20000, env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml') } }))
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('heading')).toHaveText('Remote layout')
    let ids = await chrome.evaluate(async () => {
      let state = await (window as any).bmux.state(), client = state.model.clients.find((client: { id: string }) => client.id === state.clientId)
      return { client: client.id, session: client.sessionId, pane: client.paneId }
    })
    let content = chrome.locator(`[data-content-pane-id="${ids.pane}"]`)
    let nativeBounds = () => application.evaluate(({ BaseWindow }, url) => {
      let visit = (parent: Electron.View, origin = { x: 0, y: 0 }): any => {
        for (let view of parent.children) {
          let bounds = view.getBounds(), global = { ...bounds, x: origin.x + bounds.x, y: origin.y + bounds.y }
          if ('webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url) return { page: global, clip: parent === window.contentView ? global : { ...parent.getBounds(), x: origin.x, y: origin.y } }
          let found = visit(view, global)
          if (found) return found
        }
      }
      let window = BaseWindow.getAllWindows().find(window => window.isVisible())!
      return visit(window.contentView)
    }, url)
    await expect.poll(async () => {
      let rect = (await content.boundingBox())!, bounds = await nativeBounds()
      return Math.abs(bounds.page.width - rect.width) <= 1 && Math.abs(bounds.page.height - rect.height) <= 1
    }).toBe(true)
    let locked = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    let windowId = await chrome.evaluate(async () => {
      let state = await (window as any).bmux.state()
      return state.model.clients.find((client: { id: string }) => client.id === state.clientId).windowId
    })
    await chrome.evaluate(window => (globalThis as any).bmux.command({ method: 'lock-viewport', args: { window } }), windowId)
    let lockedLease = await application.evaluate((_electron, session) => (globalThis as any).remoteLayoutRuntime.remote.acquire(session, 'layout-test', false), ids.session)
    let resizeError = await application.evaluate(async (_electron, { pane, generation }) => {
      try { await (globalThis as any).remoteLayoutRuntime.remote.resize('layout-test', generation, pane, 640, 480) }
      catch (error) { return (error as Error).message }
    }, { pane: ids.pane, generation: lockedLease.generation })
    expect(resizeError).toBe('Viewport is locked; unlock it before resizing')
    await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setSize(840, 560))
    await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(locked)
    await application.evaluate((_electron, session) => (globalThis as any).remoteLayoutRuntime.remote.release(session, 'layout-test'), ids.session)
    await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(locked)
    await chrome.evaluate(window => (globalThis as any).bmux.command({ method: 'unlock-viewport', args: { window } }), windowId)
    await expect.poll(async () => {
      let rect = (await content.boundingBox())!, bounds = await nativeBounds()
      return Math.abs(bounds.page.width - rect.width) <= 1 && Math.abs(bounds.page.height - rect.height) <= 1
    }).toBe(true)
    await test.step('Focus the native layout fixture before acquiring control', async () => {
      let windowId = await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find(window => window.isVisible())!.id)
      await application.evaluate(({ app, BaseWindow }, id) => {
        setImmediate(() => { app.focus({ steal: true }); let window = BaseWindow.fromId(id)!; window.show(); window.focus() })
      }, windowId)
      await expect.poll(() => application.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)!.isFocused(), windowId)).toBe(true)
      await expect.poll(() => chrome.evaluate(async () => (await (window as any).bmux.state()).focusedClientId)).toBe(ids.client)
    })
    let lease = await application.evaluate((_electron, session) => (globalThis as any).remoteLayoutRuntime.remote.acquire(session, 'layout-test', false), ids.session)
    for (let size of [{ width: 480, height: 240 }, { width: 1920, height: 1080 }]) {
      await application.evaluate(async (_electron, { pane, generation, size }) => (globalThis as any).remoteLayoutRuntime.remote.resize('layout-test', generation, pane, size.width, size.height), { pane: ids.pane, generation: lease.generation, size })
      await application.evaluate(({ BaseWindow }, size) => BaseWindow.getAllWindows().find(window => window.isVisible())!.setSize(size.width === 480 ? 900 : 1000, size.width === 480 ? 650 : 700), size)
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
      await expect.poll(async () => {
        let rect = (await content.boundingBox())!, bounds = await nativeBounds()
        if (size.width < rect.width && size.height < rect.height) return Math.abs(bounds.page.x + bounds.page.width / 2 - rect.x - rect.width / 2) <= 1 && Math.abs(bounds.page.y + bounds.page.height / 2 - rect.y - rect.height / 2) <= 1
        return bounds.clip.x >= rect.x - 1 && bounds.clip.y >= rect.y - 1 && bounds.clip.x + bounds.clip.width <= rect.x + rect.width + 1 && bounds.clip.y + bounds.clip.height <= rect.y + rect.height + 1
      }).toBe(true)
      if (size.width > 1000) {
        try {
          await expect.poll(() => content.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true)
        } catch (error) {
          let renderer = await content.evaluate(async (element, ids) => {
            let state = await (window as any).bmux.state(), style = getComputedStyle(element)
            return { focusedClient: state.focusedClientId, control: state.remoteControl?.[ids.session], size: state.remoteSizes?.[ids.pane], width: element.clientWidth, height: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, overflow: style.overflow, remoteWidth: style.getPropertyValue('--remote-width'), remoteHeight: style.getPropertyValue('--remote-height') }
          }, ids)
          let windows = await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(window => ({ id: window.id, focused: window.isFocused(), visible: window.isVisible(), bounds: window.getContentBounds() })))
          await fs.writeFile(info.outputPath('overflow-state.json'), JSON.stringify({ renderer, windows, native: await nativeBounds() }, null, 2))
          throw error
        }
        await content.evaluate(element => { element.scrollLeft = 100; element.scrollTop = 120 })
        await expect.poll(async () => {
          let rect = (await content.boundingBox())!, bounds = await nativeBounds()
          return { x: Math.round(bounds.page.x - rect.x), y: Math.round(bounds.page.y - rect.y) }
        }).toEqual({ x: -100, y: -120 })
      }
      if (process.platform === 'darwin') {
        let exec = promisify(execFile)
        let windowInfo = JSON.parse((await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics'); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))).find(window => window.kCGWindowOwnerPID === ${application.process().pid} && window.kCGWindowLayer === 0));`])).stdout)
        let status = (await chrome.getByRole('contentinfo', { name: 'Browser status' }).boundingBox())!
        let address = (await chrome.getByRole('group', { name: 'Pane address', exact: true }).boundingBox())!
        let rect = (await content.boundingBox())!
        let points = [status, address, rect].map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }))
        let target = await chrome.evaluate(() => `{${innerWidth}, ${innerHeight}}`)
        let sessions = (await chrome.getByRole('button', { name: 'Sessions', exact: true }).boundingBox())!
        let controls = [sessions, address, rect].map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }))
        await test.step('Native URL and Sessions controls receive mouse input', async () => {
          await expect.poll(() => application.evaluate((_electron, points) => (globalThis as any).remoteLayoutHits(points), controls)).toEqual([target, target, `{${size.width}, ${size.height}}`])
        }, { timeout: 10000 })
        points.push({ x: rect.x + 8, y: rect.y + 8 })
        let screenshot = info.outputPath(`remote-${position}-${size.width}.png`)
        await expect(async () => {
          await exec('/usr/sbin/screencapture', ['-x', '-o', '-l', String(windowInfo.kCGWindowNumber), screenshot])
          let colors = await application.evaluate(({ BaseWindow, nativeImage }, { screenshot, points, frame }) => {
            let origin = BaseWindow.getAllWindows().find(window => window.isVisible())!.getContentBounds()
            let image = nativeImage.createFromPath(screenshot), size = image.getSize(), pixels = image.toBitmap(), scale = size.width / frame.Width
            return points.map(point => {
              let offset = (Math.round((origin.y + point.y - frame.Y) * scale) * size.width + Math.round((origin.x + point.x - frame.X) * scale)) * 4
              return [pixels[offset + 2], pixels[offset + 1], pixels[offset]]
            })
          }, { screenshot, points, frame: windowInfo.kCGWindowBounds })
          expect(colors[0][0]).toBeLessThan(100)
          expect(colors[1][0]).toBeLessThan(100)
          expect(colors[2]).toEqual([207, 61, 89])
          if (size.width === 480) expect(colors[3]).toEqual([17, 19, 24])
        }).toPass({ timeout: 5000 })
      }
    }
    await application.evaluate((_electron, session) => (globalThis as any).remoteLayoutRuntime.remote.release(session, 'layout-test'), ids.session)
    await expect.poll(async () => {
      let rect = (await content.boundingBox())!, bounds = await nativeBounds()
      return Math.abs(bounds.page.width - rect.width) <= 1 && Math.abs(bounds.page.height - rect.height) <= 1
    }).toBe(true)
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
