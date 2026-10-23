import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'

let exec = promisify(execFile)

test('four panes show independent agent cursors and five-second command labels', async ({}, testInfo) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-command-feedback-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(`<!doctype html><title>Four-pane fixture</title><style>body{margin:0;min-height:6000px;background:linear-gradient(#bbcde3,#7194ba);font:20px system-ui}h1{padding:30px;font-size:24px}button{position:fixed;left:100px;top:120px;width:100px;height:50px}</style><h1>${request.headers.host}</h1><button onclick="this.textContent='Clicked'">Action</button>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let port = (server.address() as { port: number }).port
  let urls = ['one', 'two', 'three', 'four'].map(host => `http://${host}.example.test:${port}/`)
  try {
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ vimEditing: false, browser: { adblock: false, autoUpdateFilters: false }, keyboard: {}, automation: { safety: { enabled: false } } }))
    application = await electron.launch({ args: [process.cwd(), '--no-proxy-server', '--host-resolver-rules=MAP *.example.test 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let cli = async (method: string, args: Record<string, unknown>) => {
      let result = await exec(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'feedback-agent' }, timeout: 20000 })
      let value = JSON.parse(result.stdout); expect(value.ok, value.error).toBe(true); return value.result
    }
    let selection = async () => {
      let state = await chrome.evaluate(() => (window as any).bmux.state())
      return state.model.clients.find((item: any) => item.id === state.clientId)
    }
    let client = await selection(), panes = [client.paneId]
    await rpc('activate-client', { client: client.id })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(urls[0]); await address.press('Enter')
    panes.push((await rpc('split-window', { pane: panes[0], axis: 'horizontal', url: urls[1] })).id)
    panes.push((await rpc('split-window', { pane: panes[0], axis: 'vertical', url: urls[2] })).id)
    panes.push((await rpc('split-window', { pane: panes[1], axis: 'vertical', url: urls[3] })).id)
    await rpc('select-pane', { pane: panes[0], client: client.id })
    await expect.poll(() => application!.context().pages().filter(page => urls.includes(page.url())).length).toBe(4)
    let pages = urls.map(url => application!.context().pages().find(page => page.url() === url)!)
    for (let page of pages) await expect(page.locator('button')).toBeVisible()
    for (let page of pages) await page.evaluate(() => {
      let attach = Element.prototype.attachShadow
      Element.prototype.attachShadow = function (options) {
        let root = attach.call(this, options)
        if (this.id === 'bmux-virtual-mouse') (window as any).cursorShadow = root
        return root
      }
    })
    let nativeViews = () => application!.evaluate(({ BaseWindow }, urls) => BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).filter((view: any) => view.getVisible() && urls.includes(view.webContents?.getURL())).map((view: any) => ({ url: view.webContents.getURL(), bounds: view.getBounds() })), urls)
    await expect.poll(async () => { let views = await nativeViews(); return views.length === 4 && views.every(view => view.bounds.width >= 200 && view.bounds.height >= 170) }).toBe(true)
    let selectedBefore = await selection(), pointerBefore = await application.evaluate(({ screen }) => screen.getCursorScreenPoint())
    let points = panes.map((_pane, index) => ({ x: 70 + index * 20, y: 140 }))
    await Promise.all(panes.map((pane, index) => index < 3
      ? cli('cdp', { pane, method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', ...points[index], deltaX: 0, deltaY: 333 + index * 111 } })
      : cli('click', { pane, ...points[index] })))
    let expectedLabels = ['scroll down 333 px', 'scroll down 444 px', 'scroll down 555 px', 'click (130, 140)']
    let overlays = () => application!.evaluate(async ({ BaseWindow }) => Promise.all(BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).filter((view: any) => view.getVisible() && view.webContents?.getTitle() === 'Agent input lock').map(async (view: any) => ({ bounds: view.getBounds(), labels: await view.webContents.executeJavaScript("Array.from(document.querySelectorAll('#agent-commands div'), node => node.textContent)") as string[] }))))
    await expect.poll(async () => (await overlays()).flatMap(overlay => overlay.labels).sort()).toEqual([...expectedLabels].sort())
    let views = await nativeViews(), locks = await overlays()
    for (let index = 0; index < 4; index++) {
      let pointer = pages[index].locator('#bmux-virtual-mouse')
      await expect(pointer).toBeVisible()
      await expect(pointer).toHaveCSS('transform', `matrix(1, 0, 0, 1, ${points[index].x}, ${points[index].y})`)
      expect(locks.find(lock => lock.labels.includes(expectedLabels[index]))!.bounds).toEqual(views.find(view => view.url === urls[index])!.bounds)
    }
    await expect(pages[3].locator('button')).toHaveText('Clicked')
    expect(await selection()).toMatchObject({ paneId: selectedBefore.paneId, windowId: selectedBefore.windowId })
    expect(await application.evaluate(({ screen }) => screen.getCursorScreenPoint())).toEqual(pointerBefore)
    await fs.mkdir(testInfo.outputDir, { recursive: true })
    await exec('/usr/sbin/screencapture', ['-x', testInfo.outputPath('four-pane-agent-feedback.png')])
    await expect.poll(async () => (await overlays()).flatMap(overlay => overlay.labels), { timeout: 6500 }).toEqual([])
    for (let page of pages) await expect(page.locator('#bmux-virtual-mouse')).toBeVisible()
    // Command feedback belongs to bmux's overlay, outside the site's DOM.
    for (let page of pages) await expect(page.locator('#agent-commands')).toHaveCount(0)
    let page = pages[3], target = await page.evaluate(() => ({ x: innerWidth - 60, y: innerHeight - 70 }))
    let clicking = cli('click', { pane: panes[3], ...target })
    try {
      await page.waitForFunction(() => {
        let root = (window as any).cursorShadow
        return getComputedStyle(root.querySelector('svg')).opacity === '1' && root.querySelector('polyline').getAttribute('points')?.split(' ').length > 6 && root.querySelector('svg:last-child').getAnimations().length === 0
      }, undefined, { polling: 16 })
      expect(await page.evaluate(() => (window as any).cursorShadow.querySelector('svg:last-child').getAnimations().length)).toBe(0)
      await exec('/usr/sbin/screencapture', ['-x', testInfo.outputPath('pink-cursor-trail.png')])
      await page.waitForFunction(() => (window as any).cursorShadow.querySelector('span').getAnimations().some((animation: Animation) => animation.playState === 'running'), undefined, { polling: 16 })
      let halo = await page.evaluate(() => {
        let pulse = (window as any).cursorShadow.querySelector('span'), animation = pulse.getAnimations()[0]
        animation.pause(); animation.currentTime = 450
        return { width: pulse.getBoundingClientRect().width, opacity: Number(getComputedStyle(pulse).opacity) }
      })
      expect(halo.width).toBeGreaterThan(60); expect(halo.opacity).toBeGreaterThan(.4)
      await exec('/usr/sbin/screencapture', ['-x', testInfo.outputPath('pink-cursor-click-halo.png')])
    } finally { await clicking }
    await page.evaluate(() => {
      let root = (window as any).cursorShadow
      root.querySelector('span').getAnimations().forEach((animation: Animation) => animation.cancel())
      let rotation = root.querySelector('svg:last-child').getAnimations()[0]
      rotation.pause(); rotation.currentTime = 1800
    })
    await exec('/usr/sbin/screencapture', ['-x', testInfo.outputPath('pink-cursor-idle.png')])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => page.evaluate(() => (window as any).cursorShadow.getAnimations().length)).toBe(0)
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
