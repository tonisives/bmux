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

test('agent scrolls animate and share an action lock across panes and profiles on the same domain', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-agent-scroll-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(`<!doctype html><title>Agent scroll fixture</title><style>body{margin:0;min-height:6000px;background:linear-gradient(#e8eef8,#7194ba);font:20px system-ui}h1{padding:100px 30px}button{position:fixed;top:24px;left:24px;padding:12px}</style><h1>Smooth agent scrolling</h1><button>Record action</button><script>window.positions=[];window.clicks=[];addEventListener('scroll',()=>positions.push({y:scrollY,at:Date.now()}));document.querySelector('button').onclick=()=>clicks.push(Date.now());</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://example.com:${(server.address() as { port: number }).port}`
  try {
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ vimEditing: false, browser: { adblock: false, autoUpdateFilters: false }, keyboard: {}, automation: { safety: { enabled: false } } }))
    application = await electron.launch({ args: [process.cwd(), '--no-proxy-server', '--host-resolver-rules=MAP example.com 127.0.0.1, MAP www.example.com 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let cli = async (method: string, args: Record<string, unknown>) => {
      let result = await exec(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'scroll-agent' }, timeout: 20000 })
      let value = JSON.parse(result.stdout); expect(value.ok, value.error).toBe(true); return value.result
    }
    let state = await chrome.evaluate(() => (window as any).bmux.state()), client = state.model.clients.find((item: any) => item.id === state.clientId), pane = client.paneId
    await rpc('activate-client', { client: client.id })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${url}/first`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}/first`)).toBe(true)
    let first = application.context().pages().find(page => page.url() === `${url}/first`)!
    let profile = await rpc('profile.create', { name: 'Other agent' })
    let otherUrl = `${url.replace('example.com', 'www.example.com')}/second`
    let other = await rpc('split-window', { pane, profile: profile.id, url: otherUrl })
    await expect.poll(() => application!.context().pages().some(page => page.url() === otherUrl)).toBe(true)
    let second = application.context().pages().find(page => page.url() === otherUrl)!
    await expect(first.locator('h1')).toBeVisible(); await expect(second.locator('button')).toBeVisible()
    await expect.poll(() => application!.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some((view: any) => view.webContents?.getURL() === url && view.getBounds().height > 100)), first.url())).toBe(true)
    await first.evaluate(() => { (window as any).positions = [] })
    let scrolling = cli('scroll', { pane, action: 'scroll-half-down' })
    await expect.poll(() => first.evaluate(() => scrollY)).toBeGreaterThan(0)
    let clicking = cli('click', { pane: other.id, selector: 'button' })
    await Promise.all([scrolling, clicking])
    let positions = await first.evaluate(() => (window as any).positions as { y: number; at: number }[])
    expect(positions.length).toBeGreaterThan(3)
    expect(positions.at(-1)!.y).toBeCloseTo(await first.evaluate(() => Math.round(innerHeight / 2)), -1)
    let clickedAt = await second.evaluate(() => (window as any).clicks[0] as number)
    expect(clickedAt - positions.at(-1)!.at).toBeGreaterThanOrEqual(800)
    await expect(first.locator('#bmux-virtual-mouse')).toBeVisible()
    let before = await first.evaluate(() => scrollY)
    await first.evaluate(() => { (window as any).positions = [] })
    let point = await first.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }))
    await cli('cdp', { pane, method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 400 } })
    expect(await first.evaluate(() => scrollY)).toBeCloseTo(before + 400, -1)
    expect(await first.evaluate(() => (window as any).positions.length)).toBeGreaterThan(3)
    expect(await first.evaluate(() => Date.now() - (window as any).positions.at(-1).at)).toBeGreaterThanOrEqual(800)
    await cli('scroll', { pane, action: 'scroll-top' })
    expect(await first.evaluate(() => scrollY)).toBe(0)
    await first.emulateMedia({ reducedMotion: 'reduce' })
    await cli('scroll', { pane, action: 'scroll-bottom' })
    expect(await first.evaluate(() => Math.abs(scrollY - (document.scrollingElement!.scrollHeight - innerHeight)))).toBeLessThan(2)
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
