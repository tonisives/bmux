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
  body { margin:0; height:2500px; background:#d9e7ee; }
  #scroller { width:240px; height:100px; overflow:auto; }
  #scroller div { width:2000px; height:80px; background:#557766; }
  #cancel { width:240px; height:100px; background:#bb7755; }
  #contain { width:240px; height:100px; overscroll-behavior-x:contain; }
</style><h1>Swipe fixture</h1><div id="scroller"><div></div></div><div id="cancel">Page gesture</div><div id="contain">Contained</div><script>
  window.wheels = 0; window.lastWheel = 0;
  window.addEventListener('wheel', () => { window.wheels++; window.lastWheel = performance.now(); }, { passive:true });
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
  await rpc('navigate', { tab: pane, url: `${origin}/two` })
  await rpc('navigate', { tab: pane, url: `${origin}/three` })
  let other = await rpc('split-window', { pane, url: `${origin}/other` })
  await rpc('wait', { tab: other.id, selector: 'h1' })
  await rpc('select-pane', { client: client.id, pane: other.id })
  await rpc('activate-client', { client: client.id })
  await expect.poll(() => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().some(window => window.isFocused() && window.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url && view.getBounds().width > 250 && view.getBounds().height > 350)), `${origin}/three`)).toBe(true)
  let page = application.context().pages().find(page => page.url() === `${origin}/three`)!
  await expect(page.locator('h1')).toHaveText('Swipe fixture')
  let png = await application.evaluate(async ({ webContents }, url) => (await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.capturePage()).toPNG(), page.url())
  await fs.writeFile(info.outputPath('swipe-page.png'), Buffer.from(png))

  let swipe = async (deltas: [number, number][], target?: string) => {
    if (target) await page.locator(target).hover()
    else await page.mouse.move(280, 30)
    for (let [x, y] of deltas) await page.mouse.wheel(x, y)
  }
  let unchanged = async (url: string) => {
    await page.waitForFunction(() => (window as any).wheels > 0 && performance.now() - (window as any).lastWheel > 400)
    expect(page.url()).toBe(url)
  }
  await swipe([[-80, 0], [-80, 0], [-80, 0], [-30, 0], [-5, 0]])
  await expect(page).toHaveURL(`${origin}/two`)
  expect((await state()).model.clients.find((item: { id: string }) => item.id === client.id).paneId).toBe(other.id)
  expect((await state()).model.sessions[0].windows[0].panes.find((item: { id: string }) => item.id === other.id).url).toBe(`${origin}/other`)
  await swipe([[100, 0], [100, 0]])
  await expect(page).toHaveURL(`${origin}/three`)

  await swipe([[-70, 0]])
  await unchanged(`${origin}/three`)
  await swipe([[-220, 0], [180, 0]])
  await unchanged(`${origin}/three`)
  await swipe([[0, 180], [-240, 0]])
  await unchanged(`${origin}/three`)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
  await page.evaluate(() => scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)

  await swipe([[250, 0]], '#scroller')
  await unchanged(`${origin}/three`)
  await expect.poll(() => page.locator('#scroller').evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  // Reaching a widget's edge during this burst still belongs to the widget.
  await swipe([[-250, 0], [-250, 0]], '#scroller')
  await unchanged(`${origin}/three`)
  await swipe([[-250, 0]], '#cancel')
  await unchanged(`${origin}/three`)
  await swipe([[-250, 0]], '#contain')
  await unchanged(`${origin}/three`)
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaX: -250 })))
  await unchanged(`${origin}/three`)

  await swipe([[-250, 0]])
  await expect(page).toHaveURL(`${origin}/two`)
  await swipe([[-250, 0]])
  await expect(page).toHaveURL(`${origin}/one`)
  await swipe([[-250, 0]])
  await unchanged(`${origin}/one`)
})
