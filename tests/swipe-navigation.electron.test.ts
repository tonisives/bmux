import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { closeTestApplication } from './electron-fixture'

let application: ElectronApplication, chrome: Page, directory: string, server: http.Server, origin: string
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let fixture = `<!doctype html><title>Swipe fixture</title><style>
  html { transform:translateY(0); }
  body { margin:0; height:2500px; background:#d9e7ee; }
  #scroller { width:240px; height:100px; overflow:auto; }
  #scroller div { width:2000px; height:80px; background:#557766; }
  #cancel { width:240px; height:100px; background:#bb7755; }
  #contain { width:240px; height:100px; overscroll-behavior-x:contain; }
  #fixed { position:fixed; right:20px; top:20px; width:30px; height:30px; background:#557766; }
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
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(fixture) })
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

  let swipe = async (deltas: [number, number][], target?: string) => {
    await page.evaluate(() => { (window as any).displacements = []; })
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
  expect(await page.evaluate(() => Math.min(...(window as any).displacements))).toBeLessThanOrEqual(-70)
  await swipe([[100, 0], [100, 0]])
  await expect(page).toHaveURL(`${origin}/three`)

  let fixedRight = await page.locator('#fixed').evaluate(element => element.getBoundingClientRect().right)
  await page.locator('#vertical').evaluate(element => { element.scrollTop = 100 })
  // A horizontal start must keep its direction despite later vertical drift,
  // including over a nested scroll view that is away from either scroll edge.
  await swipe([[-3, 1], [-9, 4], [-38, 20], [-20, 35]], '#vertical')
  // Continue a sub-threshold gesture while checking native paint. These small
  // wheel events model a held swipe; readiness is established by page geometry.
  let holding = true
  let hold = (async () => {
    while (holding) {
      await page.mouse.wheel(-1, 0)
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  })()
  try {
    await expect.poll(() => page.evaluate(() => document.documentElement.getBoundingClientRect().left)).toBeGreaterThanOrEqual(70)
    let displacement = await page.evaluate(baseline => ({ heading: document.querySelector('h1')!.getBoundingClientRect().left, fixed: document.querySelector('#fixed')!.getBoundingClientRect().right - baseline }), fixedRight)
    expect(displacement.heading).toBeGreaterThanOrEqual(70)
    expect(displacement.fixed).toBeCloseTo(displacement.heading, 1)
    expect(await page.locator('#vertical').evaluate(element => element.scrollTop)).toBe(100)
    expect(await page.evaluate(() => scrollY)).toBe(0)
    let width = await page.evaluate(() => innerWidth)
    await expect(async () => {
      let frame = await application.evaluate(async ({ webContents }, { url, width }) => {
        let image = (await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.capturePage()).resize({ width })
        let pixels = image.toBitmap(), stride = image.getSize().width
        let colors = [20, 220].map(x => { let index = (120 * stride + x) * 4; return [pixels[index + 2], pixels[index + 1], pixels[index]] })
        return { png: image.toPNG(), colors }
      }, { url: page.url(), width })
      await fs.writeFile(info.outputPath('swipe-preview.png'), Buffer.from(frame.png))
      expect(frame.colors).toEqual([[0xd9, 0xe7, 0xee], [0x55, 0x77, 0x66]])
    }).toPass({ timeout: 3000 })
  } finally { holding = false; await hold }
  await unchanged(`${origin}/three`)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)')
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
