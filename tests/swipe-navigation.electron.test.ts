import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
let exec = promisify(execFile)
import { closeTestApplication } from './electron-fixture'

let application: ElectronApplication, chrome: Page, directory: string, server: http.Server, origin: string
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let fixture = `<!doctype html><title>Swipe fixture</title><style>
  html { overflow-x:hidden; }
  body { margin:0; height:2500px; background:#d9e7ee; }
  #scroller { width:240px; height:100px; overflow:auto; }
  #scroller div { width:2000px; height:80px; background:#557766; }
  #cancel { width:240px; height:100px; background:#bb7755; }
  #contain { width:240px; height:100px; overscroll-behavior-x:contain; }
  #fixed { position:fixed; left:0; top:0; width:100%; height:40px; background:#557766; z-index:10; }
  #vertical { position:absolute; left:280px; top:100px; width:200px; height:160px; overflow:auto; }
  #vertical div { height:1500px; background:#99aabb; }
</style><h1>Swipe fixture</h1><div id="fixed"></div><div id="scroller"><div></div></div><div id="vertical"><div></div></div><div id="cancel">Page gesture</div><div id="contain">Contained</div><script>
  window.wheels = 0; window.lastWheel = 0;
  window.displacements = [];
  let sample = () => {
    window.displacements.push(document.documentElement.getBoundingClientRect().left);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  window.addEventListener('wheel', () => { window.wheels++; window.lastWheel = performance.now(); }, { capture:true, passive:true });
  document.querySelector('#cancel').addEventListener('wheel', event => event.preventDefault(), { passive:false });
</script>`

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-swipe-'))
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard:\n  shortcuts:\n    Cmd+W: close-pane-or-window\nbrowser:\n  autoUpdateFilters: false\n')
  server = http.createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(fixture.replace('#d9e7ee', request.url === '/preview-one' ? '#cc4455' : '#d9e7ee')) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
})

test.afterAll(async () => {
  await closeTestApplication(application)
  server?.closeAllConnections()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('macOS swipe navigation targets its pane, navigates once and preserves page scrolling', async ({}, info) => {
  test.skip(process.platform !== 'darwin')
  let current = await state(), client = current.model.clients[0], pane = client.paneId
  // Enter a real local URL through the browser controls and verify native paint.
  await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
  await address.fill(`${origin}/one`); await address.press('Enter')
  await rpc('wait', { tab: pane, selector: 'h1' })
  // Finish the address submission's native focus handoff before building history.
  // Its page-ready selector alone can resolve while that submission is pending.
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${origin}/one`)
  await rpc('navigate', { tab: pane, url: `${origin}/two` })
  await rpc('navigate', { tab: pane, url: `${origin}/three` })
  await expect.poll(async () => (await state()).navigation[pane].entries.map((entry: { url: string }) => entry.url)).toEqual([`${origin}/one`, `${origin}/two`, `${origin}/three`])
  let other = await rpc('split-window', { pane, url: `${origin}/other` })
  await rpc('wait', { tab: other.id, selector: 'h1' })
  await rpc('select-pane', { client: client.id, pane: other.id })
  await rpc('activate-client', { client: client.id })
  await rpc('focus-page', { client: client.id })
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${origin}/other`)
  await expect.poll(async () => (await state()).model.clients.find((item: { id: string }) => item.id === client.id).paneId).toBe(other.id)
  await expect.poll(() => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().some(window => window.isFocused() && window.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url && view.getBounds().width > 250 && view.getBounds().height > 350)), `${origin}/three`)).toBe(true)
  let page = application.context().pages().find(page => page.url() === `${origin}/three`)!
  await expect(page.locator('h1')).toHaveText('Swipe fixture')
  let png = await application.evaluate(async ({ webContents }, url) => (await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.capturePage()).toPNG(), page.url())
  await fs.writeFile(info.outputPath('swipe-page.png'), Buffer.from(png))

  await application.evaluate(({ webContents }, url) => {
    let contents = webContents.getAllWebContents().find(item => item.getURL() === url)!
    ;(contents as any).swipeOffsets = []
    contents.on('console-message', details => {
      if (!details.message.startsWith('bmux-swipe:')) return
      let value = JSON.parse(details.message.slice(details.message.indexOf('{')))
      if (value.kind === 'preview') (contents as any).swipeOffsets.push(value.offset)
    })
  }, page.url())
  let offsets = () => application.evaluate(({ webContents }, url) => (webContents.getAllWebContents().find(item => item.getURL() === url) as any).swipeOffsets as number[], page.url())
  let swipe = async (deltas: [number, number][], target?: string) => {
    await page.evaluate(() => { (window as any).displacements = []; })
    await application.evaluate(({ webContents }, url) => { (webContents.getAllWebContents().find(item => item.getURL() === url) as any).swipeOffsets = [] }, page.url())
    if (target) await page.locator(target).hover()
    else await page.mouse.move(280, 30)
    for (let [x, y] of deltas) await page.mouse.wheel(x, y)
  }
  let unchanged = async (url: string) => {
    await page.waitForFunction(expected => location.href !== expected || (window as any).wheels > 0 && performance.now() - (window as any).lastWheel > 400, url)
    expect(page.url()).toBe(url)
    await expect.poll(() => page.evaluate(() => document.documentElement.getBoundingClientRect().left)).toBe(0)
  }
  let didNotMove = async () => expect(await page.evaluate(() => (window as any).displacements.every((x: number) => x === 0))).toBe(true)
  // Duplicate delivery must never turn one swipe into two history traversals.
  await application.evaluate(({ webContents }, url) => {
    let contents = webContents.getAllWebContents().find(item => item.getURL() === url)!
    let repeated = new Set<string>()
    contents.on('console-message', details => {
      if (!details.message.startsWith('bmux-swipe:') || repeated.has(details.message)) return
      repeated.add(details.message)
      contents.emit('console-message', details)
    })
  }, page.url())
  await swipe([[-80, 0], [-80, 0], [-80, 0], [-30, 0], [-5, 0]])
  await expect(page).toHaveURL(`${origin}/two`)
  // Native history navigation can focus the page being navigated. Its sibling
  // must retain its own URL regardless of the client's resulting selection.
  expect((await state()).model.sessions[0].windows[0].panes.find((item: { id: string }) => item.id === other.id).url).toBe(`${origin}/other`)
  await swipe([[70, 0]])
  await unchanged(`${origin}/two`)
  expect(Math.min(...await offsets())).toBeLessThanOrEqual(-70)
  await swipe([[100, 0], [100, 0]])
  await expect(page).toHaveURL(`${origin}/three`)

  let fixedRight = await page.locator('#fixed').evaluate(element => element.getBoundingClientRect().right)
  await page.locator('#vertical').evaluate(element => { element.scrollTop = 100 })
  await swipe([[-3, 1], [-9, 4], [-38, 20], [-20, 35]], '#vertical')
  let holding = true
  let hold = (async () => {
    while (holding) { await page.mouse.wheel(-1, 0); await new Promise(resolve => setTimeout(resolve, 40)) }
  })()
  try {
    await expect.poll(async () => Math.max(...await offsets())).toBeGreaterThanOrEqual(70)
    // The image moves, while the actual layout and fixed-header containing block
    // remain unchanged. A scrolled site must not lose its fixed app bar.
    expect(await page.locator('#fixed').evaluate(element => element.getBoundingClientRect().right)).toBe(fixedRight)
    expect(await page.locator('#vertical').evaluate(element => element.scrollTop)).toBe(100)
    expect(await page.evaluate(() => scrollY)).toBe(0)
    await exec('/usr/sbin/screencapture', ['-x', info.outputPath('swipe-preview.png')])
  } finally { holding = false; await hold }
  await unchanged(`${origin}/three`)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).transform)).toBe('none')
  await swipe([[-3, 80], [-30, 80]], '#vertical')
  await unchanged(`${origin}/three`)
  await didNotMove()
  await expect.poll(() => page.locator('#vertical').evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  let scrolled = await page.locator('#vertical').evaluate(element => element.scrollTop)
  await page.evaluate(() => { (window as any).displacements = [] })
  await rpc('cdp', { tab: pane, method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 380, y: 180, deltaX: -240, deltaY: 60 } })
  await unchanged(`${origin}/three`)
  await didNotMove()
  await expect.poll(() => page.locator('#vertical').evaluate(element => element.scrollTop)).toBeGreaterThan(scrolled)
  await swipe([[-220, 0], [180, 0]])
  await unchanged(`${origin}/three`)
  await swipe([[0, 180], [-240, 0]])
  await unchanged(`${origin}/three`)
  await didNotMove()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
  await page.evaluate(() => scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)

  await swipe([[250, 0]], '#scroller')
  await unchanged(`${origin}/three`)
  await didNotMove()
  await expect.poll(() => page.locator('#scroller').evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  // Reaching a widget's edge during this burst still belongs to the widget.
  await swipe([[-250, 0], [-250, 0]], '#scroller')
  await unchanged(`${origin}/three`)
  await didNotMove()
  await swipe([[-250, 0]], '#cancel')
  await unchanged(`${origin}/three`)
  await didNotMove()
  await page.locator('#cancel').evaluate(element => element.addEventListener('wheel', event => event.stopPropagation()))
  await swipe([[-250, 0]], '#cancel')
  await unchanged(`${origin}/three`)
  await didNotMove()
  await page.evaluate(() => window.addEventListener('wheel', event => {
    if ((event.target as Element).closest('#vertical')) event.preventDefault()
  }, { passive: false }))
  await swipe([[-250, 0]], '#vertical')
  await unchanged(`${origin}/three`)
  await didNotMove()
  await swipe([[-250, 0]], '#contain')
  await unchanged(`${origin}/three`)
  await didNotMove()
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaX: -250 })))
  await unchanged(`${origin}/three`)

  await swipe([[-250, 0]])
  await expect(page).toHaveURL(`${origin}/two`)
  await swipe([[-250, 0]])
  await expect(page).toHaveURL(`${origin}/one`)
  await swipe([[-250, 0]])
  await unchanged(`${origin}/one`)
  await didNotMove()
})

test('native trackpad holds a scrolled page and fixed header over a private history snapshot until release', async ({}, info) => {
  test.skip(process.platform !== 'darwin')
  let source = path.join(directory, 'scroll.c'), executable = path.join(directory, 'scroll')
  await fs.writeFile(source, `#include <ApplicationServices/ApplicationServices.h>
    #include <stdlib.h>
    #include <string.h>
    int main(int argc, char **argv) {
      if (argc != 6) return 1;
      CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, atoi(argv[3]), atoi(argv[2]));
      int phase = !strcmp(argv[1], "begin") ? kCGScrollPhaseBegan : !strcmp(argv[1], "change") ? kCGScrollPhaseChanged : !strcmp(argv[1], "cancel") ? kCGScrollPhaseCancelled : kCGScrollPhaseEnded;
      CGEventSetIntegerValueField(event, kCGScrollWheelEventScrollPhase, phase);
      CGEventSetLocation(event, CGPointMake(atof(argv[4]), atof(argv[5])));
      CGEventPost(kCGHIDEventTap, event);
      CFRelease(event);
      return 0;
    }`)
  await exec('/usr/bin/clang', [source, '-framework', 'ApplicationServices', '-o', executable])
  let current = await state(), client = current.model.clients[0], pane = client.paneId
  await rpc('navigate', { tab: pane, url: `${origin}/preview-one` })
  await rpc('select-pane', { client: client.id, pane })
  await rpc('activate-client', { client: client.id })
  await rpc('focus-page', { client: client.id })
  let page = application.context().pages().find(page => page.url() === `${origin}/preview-one`)!
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(page.url())
  await page.evaluate(() => scrollTo(0, 400))
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400)
  let location = await application.evaluate(({ BaseWindow }, url) => {
    let window = BaseWindow.getAllWindows().find(window => window.isFocused())!
    let view = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url)!
    let bounds = view.getBounds(), origin = window.getContentBounds()
    return { x: origin.x + bounds.x + 100, y: origin.y + bounds.y + 180 }
  }, page.url())
  let wheel = (phase: 'begin' | 'change' | 'end' | 'cancel', x = 0, y = 0) => exec(executable, [String(phase), String(x), String(y), String(location.x), String(location.y)])
  await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics'); $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 5, $.CGPointMake(${location.x}, ${location.y}), 0));`])
  // A real vertical gesture settles on the first page before following a link.
  await wheel('begin', 0, -5); await wheel('end')
  await page.waitForFunction(() => (window as any).wheels > 0 && performance.now() - (window as any).lastWheel > 450)
  await rpc('navigate', { tab: pane, url: `${origin}/preview-two` })
  await expect(page).toHaveURL(`${origin}/preview-two`)
  await rpc('focus-page', { client: client.id })
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${origin}/preview-two`)
  await page.evaluate(() => scrollTo(0, 400))
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400)
  await wheel('begin', 70, -6)
  // No more wheel events while fingers rest: this exceeds the old idle timeout.
  await page.waitForFunction(() => (window as any).wheels > 0 && performance.now() - (window as any).lastWheel > 1200)
  let screenshotPath = info.outputPath('native-held-swipe.png')
  let colors = async () => {
    await exec('/usr/sbin/screencapture', ['-x', screenshotPath])
    return application.evaluate(({ BaseWindow, nativeImage, screen }, { url, screenshotPath }) => {
      let window = BaseWindow.getAllWindows().find(window => window.isFocused())!
      let view = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url)!
      let bounds = view.getBounds(), origin = window.getContentBounds()
      let image = nativeImage.createFromPath(screenshotPath), size = image.getSize(), pixels = image.toBitmap()
      let display = screen.getPrimaryDisplay().bounds, scale = size.width / display.width
      let color = (x: number, y: number) => {
        let index = (Math.floor((origin.y + bounds.y + y - display.y) * scale) * size.width + Math.floor((origin.x + bounds.x + x - display.x) * scale)) * 4
        return [pixels[index + 2], pixels[index + 1], pixels[index]]
      }
      return { previous: color(20, 180), current: color(180, 180), header: color(180, 20), chrome: color(180, -8) }
    }, { url: page.url(), screenshotPath })
  }
  let closeColor = (actual: number[], expected: number[]) => actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThan(8))
  await expect(async () => {
    let sample = await colors()
    closeColor(sample.previous, [0xcc, 0x44, 0x55])
    closeColor(sample.current, [0xd9, 0xe7, 0xee])
    closeColor(sample.header, [0x55, 0x77, 0x66])
    expect(sample.chrome).not.toEqual(sample.current)
  }).toPass({ timeout: 5000 })
  expect(await page.evaluate(() => scrollY)).toBe(400)
  expect(await page.locator('#fixed').evaluate(element => element.getBoundingClientRect().top)).toBe(0)
  // Other sites cannot read the prior page image from their DOM or styles.
  expect(await page.evaluate(() => /data:image/.test(document.documentElement.outerHTML))).toBe(false)
  await wheel('change', -50, -5)
  await wheel('end')
  await page.waitForFunction(() => performance.now() - (window as any).lastWheel > 400)
  expect(page.url()).toBe(`${origin}/preview-two`)
  expect(await page.evaluate(() => scrollY)).toBe(400)
  await wheel('begin', 240, -8)
  await page.waitForFunction(() => performance.now() - (window as any).lastWheel > 500)
  expect(page.url()).toBe(`${origin}/preview-two`)
  await wheel('end')
  await expect(page).toHaveURL(`${origin}/preview-one`)
})
