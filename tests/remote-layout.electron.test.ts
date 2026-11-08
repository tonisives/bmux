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
  let pendingImages = new Set<http.ServerResponse>()
  let server = http.createServer((request, response) => {
    if (request.url === '/pending-image') { pendingImages.add(response); response.on('close', () => pendingImages.delete(response)); return }
    response.setHeader('Content-Security-Policy', "style-src-elem 'nonce-fixture'; style-src-attr 'unsafe-inline'")
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Viewport lock</title><style nonce="fixture">html,body{margin:0;min-width:2400px;min-height:2400px;background:rgb(207,61,89)}</style><h1>Viewport lock</h1><div id="horizontal" style="position:absolute;left:20px;top:160px;width:260px;height:80px;overflow:auto"><div style="width:1800px;height:40px">Horizontal content</div></div>' + (request.url === '/pending' ? '<img src="/pending-image">' : ''))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard:\n  shortcuts:\n    Ctrl+L: pane-right\nbrowser:\n  autoUpdateFilters: false\n')
  let launch = () => electron.launch({ args: [path.join(fixtureDirectory, 'main/remote-layout-main.js')], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml') } })
  let application = await launch()
  let applicationProcess = application.process()
  let processErrors = ''
  applicationProcess.stderr?.on('data', data => { processErrors += data.toString() })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let current = await state(), client = current.model.clients.find((client: { id: string }) => client.id === current.clientId)
    let nativeWindowId = (await rpc('diagnostics')).windows.find((window: { id: string }) => window.id === client.id).nativeId
    await application.evaluate((_electron, id) => { (globalThis as any).remoteLayoutWindowId = id }, nativeWindowId)
    await rpc('activate-client', { client: client.id })
    await application.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)!.setSize(1000, 500), nativeWindowId)
    await expect.poll(() => chrome.evaluate(() => innerWidth)).toBe(1000)
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
    let controlPage = async (pane: string) => {
      let found: typeof first | undefined
      await expect.poll(async () => {
        for (let page of application.context().pages().filter(page => page.url().endsWith('#plugin-overlay'))) {
          let overlay = await page.evaluate(() => (window as any).bmux.overlayState()).catch(() => undefined)
          if (overlay?.paneId === pane) { found = page; return true }
        }
        return false
      }).toBe(true)
      let tab = found!.getByRole('tab', { name: 'Locked viewport', exact: true })
      if (await tab.getAttribute('aria-selected') !== 'true') await tab.click()
      return found!
    }
    let controlBounds = (pane: string) => application.evaluate(async ({ BaseWindow, WebContentsView }, pane) => {
      for (let window of BaseWindow.getAllWindows()) for (let view of window.contentView.children) if (view instanceof WebContentsView && view.webContents.getURL().endsWith('#plugin-overlay')) {
        let overlay = await view.webContents.executeJavaScript('window.bmux.overlayState()')
        if (overlay?.paneId === pane) return view.getBounds()
      }
      return null
    }, pane)
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
    let nativeResize = (width: number, height: number) => application.evaluate(({ BaseWindow }, size) => BaseWindow.fromId(size.nativeWindowId)!.setSize(size.width, size.height), { width, height, nativeWindowId })
    await nativeResize(840, 360)
    for (let [pane, page] of [[client.paneId, first], [added.id, second]] as const) {
      await expect.poll(() => size(page)).toEqual(locked[pane])
      await expect.poll(() => content(pane).evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true)
    }
    let native = (pageUrl = url) => application.evaluate(({ BaseWindow }, url) => {
      let visit = (parent: Electron.View, root = parent): any => {
        for (let view of parent.children) {
          if ('webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url) return { page: view.getBounds(), clip: parent.getBounds(), clipped: parent !== root }
          let found = visit(view, root)
          if (found) return found
        }
      }
      return BaseWindow.getAllWindows().map(window => visit(window.contentView)).find(Boolean)
    }, pageUrl)
    try {
      await expect.poll(async () => {
        let area = await content(client.paneId).evaluate(element => ({ width: element.clientWidth, height: element.clientHeight })), bounds = await native()
        return Math.abs(bounds.clip.width - area.width) <= 1 && Math.abs(bounds.clip.height - area.height) <= 1
      }).toBe(true)
      await first.mouse.move(100, 100)
      await first.mouse.wheel(0, 80)
      await expect.poll(() => first.evaluate(() => scrollY)).toBe(80)
      expect(await content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 0, y: 0 })
      await first.evaluate(() => scrollTo(0, 0))
      await expect.poll(() => first.evaluate(() => scrollY)).toBe(0)
      if (process.platform === 'darwin') {
        await chrome.evaluate(() => {
          ;(globalThis as any).viewportWheels = []
          window.addEventListener('wheel', event => (globalThis as any).viewportWheels.push({ x: event.clientX, y: event.clientY, dx: event.deltaX, dy: event.deltaY, shift: event.shiftKey, target: (event.target as HTMLElement).outerHTML.slice(0, 300) }), { capture: true, passive: true })
        })
        let scroll = async (outside: boolean) => {
          let rect = (await content(client.paneId).boundingBox())!
          let scrolling = outside ? content(client.paneId) : first.locator('html')
          await scrolling.evaluate(element => {
            element.setAttribute('data-scroll-complete', 'false')
            let target = element === document.documentElement ? document : element
            target.addEventListener('scrollend', () => element.setAttribute('data-scroll-complete', 'true'), { once: true })
          })
          let target = await application.evaluate((_electron, point) => (globalThis as any).remoteLayoutScroll(point), { x: rect.x + 100, y: outside ? rect.y + rect.height - 20 : rect.y + 100 })
          await fs.writeFile(info.outputPath(`native-wheel-${outside ? 'outside' : 'page'}.json`), JSON.stringify({ target, rect }))
          await expect(scrolling).toHaveAttribute('data-scroll-complete', 'true')
          if (outside) {
            await expect.poll(() => content(client.paneId).evaluate(element => (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)))).toBeGreaterThan(0)
            expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
          } else {
            await expect.poll(() => first.evaluate(() => scrollX)).toBeGreaterThan(0)
            expect(await first.evaluate(() => scrollY)).toBe(0)
            expect(await content(client.paneId).evaluate(element => (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)))).toBe(0)
          }
          expect(await content(client.paneId).evaluate(element => (element.scrollTop - Number(element.dataset.panOriginY ?? 0)))).toBe(0)
          await first.evaluate(() => scrollTo(0, 0))
          await expect.poll(() => first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
          await content(client.paneId).evaluate(element => element.scrollTo(Number(element.dataset.panOriginX ?? 0), Number(element.dataset.panOriginY ?? 0)))
          await expect.poll(async () => (await native()).page.x).toBe(0)
        }
        await scroll(false)
        await nativeResize(840, 650)
        await expect.poll(() => content(client.paneId).evaluate(element => element.clientHeight > Number.parseFloat(getComputedStyle(element).getPropertyValue('--remote-height')) + 40)).toBe(true)
        // Shift over the gutter keeps ordinary browser overflow scrolling.
        // Hand gestures over the actual page are covered below.
        await nativeResize(840, 360)
        await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: 0, y: 0 })
      }
      await first.mouse.move(100, 100)
      await first.keyboard.down('Shift')
      // CDP takes resolved axes; the native wheel above covers Shift conversion.
      try { await first.mouse.wheel(40, 0) }
      finally { await first.keyboard.up('Shift') }
      await expect.poll(() => first.evaluate(() => scrollX)).toBe(40)
      expect(await first.evaluate(() => scrollY)).toBe(0)
      expect(await content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 0, y: 0 })
      await first.evaluate(() => scrollTo(0, 0))
      await expect.poll(() => first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
      let scroller = first.locator('#horizontal')
      await scroller.hover()
      await first.keyboard.down('Shift')
      try { await first.mouse.wheel(40, 0) }
      finally { await first.keyboard.up('Shift') }
      await expect.poll(() => scroller.evaluate(element => (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)))).toBe(40)
      expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
      expect(await content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 0, y: 0 })
      // Native content can retain focus while chrome's selected pane is stale.
      // Clicking that already-focused view does not emit another focus event.
      await rpc('select-pane', { client: client.id, pane: client.paneId })
      await rpc('select-pane', { client: client.id, pane: added.id, focus: false })
      await expect(chrome.locator(`[data-pane-id="${added.id}"]`)).toHaveAttribute('data-focused-pane', 'true')
      await first.mouse.click(100, 100)
      await expect(chrome.locator(`[data-pane-id="${client.paneId}"]`)).toHaveAttribute('data-focused-pane', 'true')
      await rpc('select-pane', { client: client.id, pane: added.id, focus: false })
      await first.keyboard.press('Control+l')
      await expect(chrome.locator(`[data-pane-id="${added.id}"]`)).toHaveAttribute('data-focused-pane', 'true')
      await first.mouse.click(100, 100)
      await expect(chrome.locator(`[data-pane-id="${client.paneId}"]`)).toHaveAttribute('data-focused-pane', 'true')
      let handPage = await controlPage(client.paneId)
      let hand = handPage.getByRole('button', { name: 'Pan viewport', exact: true })
      await expect(hand).toBeVisible()
      let anchoredControl = await controlBounds(client.paneId)
      await hand.hover()
      await expect(hand).toHaveAttribute('title', 'Pan viewport')
      for (let modifier of ['Alt', 'Meta']) {
        await first.keyboard.down(modifier)
        await first.mouse.move(120, 120)
        await first.mouse.down()
        await first.mouse.move(80, 80)
        expect(await controlBounds(client.paneId)).toEqual(anchoredControl)
        await first.mouse.up()
        await first.keyboard.up(modifier)
        await expect.poll(() => content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 40, y: 40 })
        expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
        await content(client.paneId).evaluate(element => element.scrollTo(Number(element.dataset.panOriginX ?? 0), Number(element.dataset.panOriginY ?? 0)))
        await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: 0, y: 0 })
      }
      await first.keyboard.down('Alt')
      await first.mouse.move(100, 100)
      await first.mouse.wheel(0, 100)
      await expect.poll(async () => (await state()).model.sessions.flatMap((s: any) => s.windows.flatMap((w: any) => w.panes)).find((p: any) => p.id === client.paneId).zoom).toBeLessThan(1)
      await first.mouse.wheel(0, -200)
      await expect.poll(async () => (await state()).model.sessions.flatMap((s: any) => s.windows.flatMap((w: any) => w.panes)).find((p: any) => p.id === client.paneId).zoom).toBeGreaterThan(1)
      await first.keyboard.up('Alt')
      await rpc('zoom', { tab: client.paneId, factor: 1 })
      await expect.poll(() => content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 0, y: 0 })
      await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'true')
      await handPage.screenshot({ path: info.outputPath('viewport-hand-pressed.png') })
      await first.mouse.move(100, 100)
      await first.mouse.wheel(20, 30)
      await expect.poll(() => content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 20, y: 30 })
      await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'false')
      await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'true')
      await first.keyboard.press('Escape')
      await expect(hand).toHaveAttribute('aria-pressed', 'false')
      await chrome.screenshot({ path: info.outputPath('viewport-hand-control.png') })
      await content(client.paneId).evaluate(element => element.scrollTo(Number(element.dataset.panOriginX ?? 0), Number(element.dataset.panOriginY ?? 0)))
      await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: 0, y: 0 })
      await nativeResize(840, 650)
      await expect.poll(() => content(client.paneId).evaluate(element => element.clientHeight > Number.parseFloat(getComputedStyle(element).getPropertyValue('--remote-height')) + 40)).toBe(true)
      await expect.poll(async () => {
        let area = await content(client.paneId).evaluate(element => ({ width: element.clientWidth, height: element.clientHeight })), bounds = await native()
        return bounds.clip.width === area.width && bounds.clip.height === area.height
      }).toBe(true)
      await chrome.evaluate(() => {
        let trace: unknown[] = (globalThis as any).gutterTrace = []
        for (let type of ['pointerdown', 'pointerup', 'pointermove', 'gotpointercapture', 'lostpointercapture', 'blur', 'focus']) window.addEventListener(type, event => {
          let e = event as PointerEvent
          trace.push({ type, id: e.pointerId, alt: e.altKey, meta: e.metaKey, button: e.button, x: e.clientX, y: e.clientY, target: (e.target as HTMLElement)?.outerHTML?.slice(0, 200) })
        }, true)
      })
      await application.evaluate(({ webContents }) => {
        let trace: unknown[] = (globalThis as any).nativeGutterTrace = []
        for (let contents of webContents.getAllWebContents()) {
          contents.on('before-mouse-event', (_event, mouse) => trace.push({ id: contents.id, url: contents.getURL(), mouse }))
          contents.on('focus', () => trace.push({ id: contents.id, focus: true }))
          contents.on('blur', () => trace.push({ id: contents.id, blur: true }))
        }
      })
      let gutter = (await content(client.paneId).boundingBox())!
      let resetPan = async () => {
        await content(client.paneId).evaluate(element => element.scrollTo(Number(element.dataset.panOriginX ?? 0), Number(element.dataset.panOriginY ?? 0)))
        await expect.poll(async () => (await native()).page.x).toBe(0)
      }
      let collapse = async () => { await handPage.getByRole('button', { name: 'Minimize page overlay', exact: true }).click(); await expect(handPage.getByRole('tab', { name: 'Locked viewport', exact: true })).toHaveAttribute('aria-selected', 'false') }
      await collapse()
      for (let modifier of ['Alt', 'Meta', 'toggle']) {
        if (modifier === 'toggle') {
          await controlPage(client.paneId)
          await hand.click()
          await expect(hand).toHaveAttribute('aria-pressed', 'true')
          await expect.poll(async () => (await state()).viewportPanModes).toContain(client.paneId)
          await expect(chrome.locator(`[data-pane-id="${client.paneId}"]`)).toHaveCSS('cursor', 'grab')
          await collapse()
        } else await chrome.keyboard.down(modifier)
        let start = { x: gutter.x + 180, y: gutter.y + gutter.height - 24 }
        let finish = { x: gutter.x + 140, y: gutter.y + gutter.height / 2 }
        if (process.platform === 'darwin') {
          let input = (phase: number, point: { x: number; y: number }) => application.evaluate((_electron, event) => (globalThis as any).remoteLayoutMouse(event), { ...point, phase, modifier: modifier === 'Alt' ? 1 : modifier === 'Meta' ? 2 : 0 })
          await input(0, start)
          await input(1, start)
          try {
            await expect.poll(() => chrome.locator(`[data-pane-id="${client.paneId}"]`).evaluate(element => { let id = (globalThis as any).gutterTrace?.findLast((event: any) => event.type === 'pointerdown')?.id; return id !== undefined && element.hasPointerCapture(id) }), { message: `${modifier} gutter drag captures the pointer` }).toBe(true)
            await input(2, finish)
            await expect.poll(() => content(client.paneId).evaluate(element => (element.scrollLeft - Number(element.dataset.panOriginX ?? 0))), { message: `${modifier} native gutter drag pans across the page` }).toBe(40)
          } finally { await input(3, finish) }
        } else {
          await chrome.mouse.move(start.x, start.y)
          await chrome.mouse.down()
          await chrome.mouse.move(finish.x, finish.y)
          await chrome.mouse.up()
        }
        if (modifier !== 'toggle') await chrome.keyboard.up(modifier)
        await expect.poll(() => content(client.paneId).evaluate(element => (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)))).toBe(40)
        expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
        if (modifier === 'toggle') {
          await expect.poll(async () => (await state()).viewportPanModes).toContain(client.paneId)
          await chrome.keyboard.press('Escape')
          await expect.poll(async () => (await state()).viewportPanModes).not.toContain(client.paneId)
        }
        await resetPan()
      }
      await nativeResize(840, 360)
      await application.evaluate((_electron, pane) => (globalThis as any).remoteLayoutRuntime.execute({ method: 'eval', args: { pane, expression: '1', agentId: 'viewport-gesture-test' } }), client.paneId)
      await expect.poll(async () => (await state()).lockedAgentPanes).toContain(client.paneId)
      let shield: Page | undefined
      await expect.poll(async () => {
        for (let page of application.context().pages().filter(page => page.url().includes('Agent%20input%20lock'))) if (await page.title() === 'Agent input lock') { shield = page; return true }
        return false
      }).toBe(true)
      await expect(shield!.locator('body')).toBeVisible()
      await expect((await controlPage(client.paneId)).getByRole('tab', { name: 'Agent control', exact: true })).toBeVisible()
      await shield!.mouse.move(100, 100)
      await shield!.keyboard.down('Meta')
      try { await shield!.mouse.wheel(20, 30) }
      finally { await shield!.keyboard.up('Meta') }
      await expect.poll(() => content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 20, y: 30 })
      await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: -20, y: -30 })
      expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
      await rpc('agent.input-lock.override', { pane: client.paneId, enabled: true })
      await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
      await hand.click()
      await expect(hand).toHaveAttribute('aria-pressed', 'false')
    } catch (error) {
      await fs.writeFile(info.outputPath('chrome-wheels.json'), JSON.stringify(await chrome.evaluate(() => (globalThis as any).viewportWheels ?? [])))
      await fs.writeFile(info.outputPath('gutter-events.json'), JSON.stringify({ dom: await chrome.evaluate(() => (globalThis as any).gutterTrace), native: await application.evaluate(() => (globalThis as any).nativeGutterTrace) }))
      if (process.platform === 'darwin') await fs.writeFile(info.outputPath('native-tree.txt'), await application.evaluate(() => (globalThis as any).remoteLayoutTree()))
      let reported = await application.evaluate(({ BaseWindow }) => ({ bounds: (globalThis as any).viewportBounds, windows: BaseWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), bounds: window.getBounds() })) }))
      let details = { native: await native(), reported, state: await state(), scroll: await content(client.paneId).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)), width: element.clientWidth, height: element.clientHeight })) }
      await fs.writeFile(info.outputPath('viewport-scroll.json'), JSON.stringify(details, null, 2))
      throw error
    }
    for (let pane of [client.paneId, added.id]) await content(pane).evaluate(element => element.scrollTo(Number(element.dataset.panOriginX ?? 0), Number(element.dataset.panOriginY ?? 0)))
    await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: 0, y: 0 })
    await nativeResize(1280, 850)
    for (let [pane, page] of [[client.paneId, first], [added.id, second]] as const) {
      await expect.poll(() => size(page)).toEqual(locked[pane])
      await expect.poll(() => content(pane).evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 0, y: 0 })
      await expect.poll(() => content(pane).evaluate(element => element.clientWidth >= Number.parseFloat(getComputedStyle(element).getPropertyValue('--remote-width')) && element.clientHeight >= Number.parseFloat(getComputedStyle(element).getPropertyValue('--remote-height')))).toBe(true)
    }
    await expect.poll(async () => {
      let bounds = await native()
      return bounds.clipped && bounds.page.x >= 0 && bounds.page.y >= 0 && bounds.page.x + bounds.page.width <= bounds.clip.width && bounds.page.y + bounds.page.height <= bounds.clip.height
    }).toBe(true)
    await chrome.screenshot({ path: info.outputPath('grown-locked-viewport.png') })
    // A page that fits still pans, with room to bring its header and footer
    // to the middle instead of stopping at the native viewport edge.
    let fittedHand = (await controlPage(client.paneId)).getByRole('button', { name: 'Pan viewport', exact: true })
    if (process.platform === 'darwin') {
      await application.evaluate(({ BaseWindow, screen }, id) => {
        let window = BaseWindow.fromId(id)!
        let area = screen.getPrimaryDisplay().workArea
        window.setPosition(area.x, area.y)
      }, nativeWindowId)
      await rpc('activate-client', { client: client.id })
      await expect.poll(() => application.evaluate(({ BaseWindow }, id) => BaseWindow.getFocusedWindow()?.id === id, nativeWindowId)).toBe(true)
      let button = (await controlBounds(client.paneId))!
      let handRect = (await fittedHand.boundingBox())!, zoom = await fittedHand.page().evaluate(() => (window as any).bmux.overlayState().then((overlay: any) => overlay.zoom))
      let point = { x: button.x + (handRect.x + handRect.width / 2) * zoom, y: button.y + (handRect.y + handRect.height / 2) * zoom }
      await expect.poll(() => application.evaluate((_electron, points) => (globalThis as any).remoteLayoutHits(points), [point])).toEqual([`{${button.width}, ${button.height}}`])
      let input = (phase: number) => application.evaluate((_electron, event) => (globalThis as any).remoteLayoutMouse(event), { ...point, phase, modifier: 0, direct: true })
      for (let phase of [0, 1, 3]) await input(phase)
    } else await fittedHand.click()
    try { await expect(fittedHand).toHaveAttribute('aria-pressed', 'true') }
    catch (error) {
      await fs.writeFile(info.outputPath('native-control-input.json'), JSON.stringify({
        button: await fittedHand.evaluate(button => ({ rect: button.getBoundingClientRect().toJSON(), pressed: button.getAttribute('aria-pressed') })),
        native: await application.evaluate(({ BaseWindow, screen, WebContentsView }) => ({
          target: (globalThis as any).remoteLayoutWindowId,
          events: (globalThis as any).nativeGutterTrace,
          cursor: screen.getCursorScreenPoint(),
          windows: BaseWindow.getAllWindows().map(window => ({ id: window.id, bounds: window.getBounds(), focused: window.isFocused(), views: window.contentView.children.map(view => ({ bounds: view.getBounds(), url: view instanceof WebContentsView ? view.webContents.getURL() : '' })) })),
        })),
      }))
      throw error
    }
    await expect.poll(() => first.locator('#bmux-viewport-pan').evaluate(element => {
      let surface = element.shadowRoot!.querySelector('div')!
      return { position: getComputedStyle(surface).position, height: surface.getBoundingClientRect().height > 0, pointer: getComputedStyle(surface).pointerEvents }
    })).toEqual({ position: 'absolute', height: true, pointer: 'auto' })
    await first.mouse.move(120, 120); await first.mouse.down(); await first.mouse.move(100, 100); await first.mouse.up()
    await expect.poll(() => content(client.paneId).evaluate(element => ({ x: element.scrollLeft - Number(element.dataset.panOriginX), y: element.scrollTop - Number(element.dataset.panOriginY) }))).toEqual({ x: 20, y: 20 })
    let stationaryHand = await controlBounds(client.paneId)
    await content(client.paneId).evaluate(element => element.scrollTo(0, 0))
    await expect.poll(async () => {
      let bounds = await native()
      return { x: bounds.page.x, y: bounds.page.y }
    }).toEqual(await content(client.paneId).evaluate(element => ({ x: Math.round(element.clientWidth / 2), y: Math.round(element.clientHeight / 2) })))
    expect(await controlBounds(client.paneId)).toEqual(stationaryHand)
    await content(client.paneId).evaluate(element => element.scrollTo(element.scrollWidth, element.scrollHeight))
    await expect.poll(async () => {
      let bounds = await native()
      return { x: bounds.page.x + bounds.page.width, y: bounds.page.y + bounds.page.height }
    }).toEqual(await content(client.paneId).evaluate(element => ({ x: element.clientWidth - Math.round(element.clientWidth / 2), y: element.clientHeight - Math.round(element.clientHeight / 2) })))
    expect(await controlBounds(client.paneId)).toEqual(stationaryHand)
    await first.keyboard.press('Escape')
    await content(client.paneId).evaluate(element => element.scrollTo(Number(element.dataset.panOriginX), Number(element.dataset.panOriginY)))
    let other = await rpc('attach-session', { session: client.sessionId })
    await expect.poll(() => application.context().pages().filter(page => page.url().endsWith('/renderer/index.html')).length).toBe(2)
    let otherChrome = application.context().pages().find(page => page !== chrome && page.url().endsWith('/renderer/index.html'))!
    await rpc('select-window', { client: other.id, window: client.windowId })
    await rpc('activate-client', { client: other.id })
    await application.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()!.setSize(1000, 650))
    await expect.poll(async () => (await state()).focusedClientId).toBe(other.id)
    await expect(chrome.locator(`[data-content-pane-id="${client.paneId}"] img[alt="Page preview"]`)).toBeVisible()
    await expect(otherChrome.locator(`[data-content-pane-id="${client.paneId}"] img[alt="Page preview"]`)).toBeHidden()
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
    expect((await windowState()).lockedViewports[client.paneId]).toEqual(unlockedSize)
    for (let args of [{ width: 1512 }, { width: 0, height: 900 }, { width: 1512.5, height: 900 }, { width: 20000, height: 900 }]) await expect(rpc('lock-viewport', { window: client.windowId, ...args })).rejects.toThrow('Provide both')
    await rpc('lock-viewport', { window: client.windowId, width: '1512', height: '900' })
    await expect.poll(async () => Object.values((await windowState()).lockedViewports).every((size: any) => size.width === 1512 && size.height === 900)).toBe(true)
    await expect.poll(() => application.context().pages().some(page => page.url() === `${url}third`)).toBe(true)
    let thirdPage = application.context().pages().find(page => page.url() === `${url}third`)!
    for (let [pane, page, zoom] of [[client.paneId, first, .5], [added.id, second, 1], [third.id, thirdPage, 2], [client.paneId, first, .5845]] as const) {
      await rpc('zoom', { tab: pane, factor: zoom })
      await expect.poll(() => size(page)).toEqual({ width: 1512, height: 900 })
      await expect.poll(async () => { let bounds = await native(page.url()); return { width: bounds.page.width, height: bounds.page.height } }).toEqual({ width: Math.round(1512 * zoom), height: Math.round(900 * zoom) })
      await expect.poll(() => page.evaluate(() => matchMedia('(min-width: 1512px)').matches && !matchMedia('(min-width: 1513px)').matches)).toBe(true)
      await expect.poll(() => content(pane).evaluate(element => ({
        width: Number.parseFloat(getComputedStyle(element).getPropertyValue('--remote-width')),
        height: Number.parseFloat(getComputedStyle(element).getPropertyValue('--remote-height')),
      }))).toEqual({ width: Math.round(1512 * zoom), height: Math.round(900 * zoom) })
      let button = (await controlPage(pane)).getByRole('button', { name: 'Pan viewport', exact: true })
      await expect(button).toBeVisible()
      await expect.poll(async () => {
        let rect = (await button.boundingBox())!
        return { width: Math.round(rect.width), height: Math.round(rect.height) }
      }).toEqual({ width: 32, height: 32 })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(button).toHaveCSS('background-color', 'rgb(194, 206, 185)')
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'false')
    }
    await first.reload()
    await expect.poll(() => size(first)).toEqual({ width: 1512, height: 900 })
    await rpc('viewport.pan-mode', { pane: client.paneId, enabled: true })
    await expect.poll(() => first.evaluate(() => document.querySelector('#bmux-viewport-pan')?.shadowRoot?.querySelector('div')?.style.pointerEvents)).toBe('auto')
    await first.mouse.move(100, 100)
    await first.mouse.wheel(20, 30)
    await expect.poll(() => otherChrome.locator(`[data-content-pane-id="${client.paneId}"]`).evaluate(element => ({ x: element.scrollLeft - Number((element as HTMLElement).dataset.panOriginX), y: element.scrollTop - Number((element as HTMLElement).dataset.panOriginY) }))).toEqual({ x: 20, y: 30 })
    expect(await first.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
    await rpc('viewport.pan-mode', { pane: client.paneId, enabled: false })
    await otherChrome.screenshot({ path: info.outputPath('viewport-controls-zoom.png') })
    for (let pane of [client.paneId, added.id, third.id]) await rpc('zoom', { tab: pane, factor: 1 })
    await expect.poll(() => size(first)).toEqual({ width: 1512, height: 900 })
    let settingsPage = await controlPage(third.id)
    let settingsButton = settingsPage.getByRole('tab', { name: 'Locked viewport', exact: true })
    let settingsForm = settingsPage.getByRole('form', { name: 'Viewport settings', exact: true })
    let openSettings = async () => { if (await settingsButton.getAttribute('aria-selected') !== 'true') await settingsButton.click(); await expect(settingsForm).toBeVisible() }
    await rpc('zoom', { tab: third.id, factor: .5 })
    await expect(settingsButton).toHaveAttribute('aria-selected', 'true')
    await expect(settingsForm).toBeVisible()
    await expect(settingsForm.getByLabel('Width', { exact: true })).toHaveValue('1512')
    await expect(settingsForm.getByLabel('Scale (%)', { exact: true })).toHaveValue('50')
    await settingsForm.getByLabel('Width', { exact: true }).fill('0')
    await settingsForm.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(settingsForm).toBeVisible()
    expect((await windowState()).lockedViewports[third.id]).toEqual({ width: 1512, height: 900 })
    await settingsForm.getByLabel('Width', { exact: true }).fill('1280')
    await settingsForm.getByLabel('Height', { exact: true }).fill('800')
    await settingsForm.getByLabel('Scale (%)', { exact: true }).fill('125')
    await settingsForm.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(settingsForm).toBeHidden()
    await expect(settingsButton).toHaveAttribute('aria-selected', 'false')
    await expect.poll(() => size(thirdPage)).toEqual({ width: 1280, height: 800 })
    expect((await windowState()).lockedViewports[third.id]).toEqual({ width: 1280, height: 800 })
    await expect.poll(() => size(first)).toEqual({ width: 1512, height: 900 })
    await openSettings()
    for (let [label, width, height] of [
      ['MacBook Pro 16″ · 1728 × 1117', '1728', '1117'],
      ['iMac 24″ · 2240 × 1260', '2240', '1260'],
      ['iPhone 17 · 402 × 874', '402', '874'],
      ['iPhone 17 Pro Max · 440 × 956', '440', '956'],
      ['MacBook Pro 14″ · 1512 × 982', '1512', '982'],
    ]) {
      await settingsForm.getByLabel('Scale (%)', { exact: true }).fill('125')
      await settingsForm.getByLabel('Viewport preset', { exact: true }).selectOption({ label })
      await expect(settingsForm.getByLabel('Width', { exact: true })).toHaveValue(width)
      await expect(settingsForm.getByLabel('Height', { exact: true })).toHaveValue(height)
      await expect(settingsForm.getByLabel('Scale (%)', { exact: true })).toHaveValue('100')
    }
    await expect(settingsForm.getByLabel('Scale (%)', { exact: true })).toHaveValue('100')
    await settingsPage.screenshot({ path: info.outputPath('viewport-settings-popup.png') })
    await settingsForm.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(settingsForm).toBeHidden()
    await expect(settingsButton).toHaveAttribute('aria-selected', 'false')
    await expect.poll(() => size(thirdPage)).toEqual({ width: 1512, height: 982 })
    await openSettings()
    let recent = settingsForm.getByLabel('Viewport preset', { exact: true }).locator('optgroup[label="Recently used"] option')
    await expect(recent).toHaveText(['1512 × 982 · 100%', '1280 × 800 · 125%'])
    await settingsForm.getByLabel('Viewport preset', { exact: true }).selectOption('recent:1')
    await expect(settingsForm.getByLabel('Width', { exact: true })).toHaveValue('1280')
    await expect(settingsForm.getByLabel('Scale (%)', { exact: true })).toHaveValue('125')
    await settingsForm.getByLabel('Width', { exact: true }).fill('999')
    await settingsForm.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(settingsForm).toBeHidden()
    await expect(settingsButton).toHaveAttribute('aria-selected', 'false')
    await openSettings()
    await expect(settingsForm.getByLabel('Width', { exact: true })).toHaveValue('1512')
    await settingsPage.keyboard.press('Escape')
    await expect(settingsForm).toBeHidden()
    await expect(settingsButton).toHaveAttribute('aria-selected', 'false')
    await thirdPage.goto(`${url}pending`, { waitUntil: 'domcontentloaded' })
    await expect.poll(() => pendingImages.size).toBeGreaterThan(0)
    await expect((await controlPage(third.id)).getByRole('button', { name: 'Pan viewport', exact: true })).toBeVisible()
    expect(await thirdPage.evaluate(() => document.readyState)).toBe('interactive')
    for (let response of pendingImages) response.end()
    let saved = (await windowState()).lockedViewports
    expect(saved[client.paneId]).toEqual({ width: 1512, height: 900 })
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
    await expect.poll(() => first.evaluate(() => scrollX)).toBeGreaterThan(0)
    expect(await floatingViewport.evaluate(element => ({ x: (element.scrollLeft - Number(element.dataset.panOriginX ?? 0)), y: (element.scrollTop - Number(element.dataset.panOriginY ?? 0)) }))).toEqual({ x: 0, y: 0 })
    await expect.poll(async () => { let bounds = await native(); return { x: bounds.page.x, y: bounds.page.y } }).toEqual({ x: 0, y: 0 })
    await otherChrome.screenshot({ path: info.outputPath('locked-split-viewport.png') })
    await closeTestApplication(application, applicationProcess)
    application = await launch()
    applicationProcess = application.process()
    applicationProcess.stderr?.on('data', data => { processErrors += data.toString() })
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    await expect.poll(async () => (await windowState()).lockedViewports).toEqual(saved)
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    first = application.context().pages().find(page => page.url() === url)!
    await expect(first.getByRole('heading')).toHaveText('Viewport lock')
    await expect.poll(() => size(first)).toEqual(saved[client.paneId])
  } finally {
    await info.attach('electron-stderr', { body: processErrors, contentType: 'text/plain' })
    await closeTestApplication(application, applicationProcess)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
      await expect.poll(async () => {
        let native = await application.evaluate(({ BaseWindow }) => { let { width, height } = BaseWindow.getAllWindows().find(window => window.isVisible())!.getContentBounds(); return { width, height } })
        return JSON.stringify(await chrome.evaluate(() => ({ width: innerWidth, height: innerHeight }))) === JSON.stringify(native)
      }).toBe(true)
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
      await expect.poll(async () => {
        let rect = (await content.boundingBox())!, bounds = await nativeBounds()
        let area = await content.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }))
        if (size.width < area.width && size.height < area.height) return Math.abs(bounds.page.x + bounds.page.width / 2 - rect.x - area.width / 2) <= 1 && Math.abs(bounds.page.y + bounds.page.height / 2 - rect.y - area.height / 2) <= 1
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
        await expect.poll(() => content.evaluate(element => Number((element as HTMLElement).dataset.panOriginX) === Math.round(element.clientWidth / 2) && Number((element as HTMLElement).dataset.panOriginY) === Math.round(element.clientHeight / 2))).toBe(true)
        await content.evaluate(element => { element.scrollLeft = Number(element.dataset.panOriginX ?? 0) + 100; element.scrollTop = Number(element.dataset.panOriginY ?? 0) + 120 })
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
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
