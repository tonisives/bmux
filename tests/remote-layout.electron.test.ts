import { test, expect, _electron as electron } from '@playwright/test'
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
        await expect.poll(() => content.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true)
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
        await expect.poll(() => application.evaluate((_electron, points) => points.slice(0, 2).map(point => (globalThis as any).remoteLayoutHit(point.x, point.y)), points)).toEqual([target, target])
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
