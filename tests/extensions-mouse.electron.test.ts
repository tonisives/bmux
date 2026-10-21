import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'

let exec = promisify(execFile)
test('unified extensions controls and virtual mouse clicks respect profile protection and social pacing', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-extensions-mouse-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let recording: Promise<void> | undefined, stopped = false
  let frames: { file: string; at: number }[] = [], chapters: { title: string; at: number }[] = [], pointerCues: { at: number; x: number; y: number }[] = []
  let destination = path.resolve('artifacts/extensions-mouse-demo'), started = 0
  let crop: { x: number; y: number; width: number; height: number } | undefined
  let record = process.env.BMUX_RECORD_DEMO === '1'
  let hold = async (ms = 1400) => { if (record) await new Promise(resolve => setTimeout(resolve, ms)) }
  let chapter = async (title: string) => { console.log(title); chapters.push({ title, at: (Date.now() - started) / 1000 }); await hold(700) }
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><meta charset="utf-8"><title>Mouse movement demo</title><style>body{background:#171b20;color:#e1e5e9;font:20px system-ui;padding:60px}h1{font-size:32px}nav{display:flex;gap:180px;margin:100px 0}a{color:#bdcdb0;background:#29312a;padding:24px;text-decoration:none}output{color:#b6c6a8}</style><h1>Extensions and virtual mouse</h1><p>Local fixture · automated link clicks</p><nav><a id="first" href="#first">First link</a><a id="second" href="#second">Second link</a></nav><output>No clicks yet</output><script>window.events=[];for(let type of ['mousemove','click'])document.addEventListener(type,event=>{window.events.push({type,x:event.clientX,y:event.clientY,trusted:event.isTrusted,at:performance.now()});if(type==='click'){event.preventDefault();document.querySelector('output').textContent=event.target.textContent+' clicked'}})</script>`)
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = 'https://x.com/bmux-demo'
    let fixture = await (await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}`)).text()
    let plugin = path.join(directory, 'plugins/demo'), extension = path.join(directory, 'extension')
    await fs.mkdir(plugin, { recursive: true }); await fs.mkdir(extension)
    await fs.writeFile(path.join(plugin, 'plugin.yaml'), stringify({ schema_version: 1, id: 'demo', name: 'Demo page tools', version: '1', actions: [{ id: 'click', title: 'Click second link', command: ['node', './click.mjs'], capabilities: ['browser.write'] }] }))
    await fs.writeFile(path.join(plugin, 'click.mjs'), `import {execFileSync} from 'node:child_process';execFileSync(process.env.BMUX_CLI,['plugin','host','click','--stdin'],{input:JSON.stringify({selector:'#second'}),stdio:['pipe','pipe','pipe']});`)
    await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Demo extension', version: '1.0', content_scripts: [{ matches: ['https://x.com/*'], js: ['content.js'] }] }))
    await fs.writeFile(path.join(extension, 'content.js'), 'document.documentElement.dataset.demoExtension="enabled"')
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ browser: { adblock: false, autoUpdateFilters: false }, keyboard: {}, plugins: { demo: { enabled: true } } }))
    application = await electron.launch({ args: [process.cwd(), '--no-proxy-server'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    await application.context().route(url, route => route.fulfill({ contentType: 'text/html', body: fixture }))
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state()), client = state.model.clients.find((item: any) => item.id === state.clientId), pane = client.paneId
    let cli = async (method: string, args: Record<string, unknown>) => {
      let result = await exec(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20000 })
      let value = JSON.parse(result.stdout)
      expect(value.ok, value.error).toBe(true)
      return value.result
    }
    await rpc('activate-client', { client: client.id })
    await application.evaluate(({ BaseWindow, screen }) => { let area = screen.getPrimaryDisplay().workArea; BaseWindow.getFocusedWindow()?.setBounds({ x: area.x + 20, y: area.y + 20, width: Math.min(1280, area.width - 40), height: Math.min(800, area.height - 40) }) })
    await rpc('extension.load', { profile: 'profile_default', path: extension })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.locator('h1')).toHaveText('Extensions and virtual mouse')
    await expect(page.locator('html')).toHaveAttribute('data-demo-extension', 'enabled')
    await expect.poll(() => application!.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.some((view: any) => view.webContents?.getURL() === url && view.getBounds().height > 100)), url)).toBe(true)
    if (record) {
      await exec('/usr/bin/caffeinate', ['-u', '-t', '1'])
      await fs.mkdir(path.join(destination, 'frames'), { recursive: true })
      crop = await application.evaluate(({ BaseWindow, screen }) => {
        let bounds = BaseWindow.getFocusedWindow()!.getBounds(), scale = screen.getPrimaryDisplay().scaleFactor
        return { x: Math.round(bounds.x * scale), y: Math.round(bounds.y * scale), width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) }
      })
      await chrome.exposeFunction('recordDemoClick', (x: number, y: number) => { if (!stopped) pointerCues.push({ at: (Date.now() - started) / 1000, x, y }) })
      await chrome.evaluate(() => document.addEventListener('mousedown', event => { void (window as any).recordDemoClick(event.clientX, event.clientY) }, true))
      started = Date.now()
      recording = (async () => {
        while (!stopped) {
          let file = `${String(frames.length).padStart(5, '0')}.jpg`, before = Date.now()
          await exec('/usr/sbin/screencapture', ['-x', '-m', '-tjpg', path.join(destination, 'frames', file)])
          frames.push({ file, at: ((before + Date.now()) / 2 - started) / 1000 })
          await new Promise(resolve => setTimeout(resolve, 60))
        }
      })()
    }
    await chapter('Extensions beside each pane profile')
    let extensions = chrome.getByRole('button', { name: 'Extensions', exact: true })
    expect(await extensions.evaluate(button => !!button.parentElement?.querySelector('button[aria-label*="profile" i]'))).toBe(true)
    await expect(chrome.locator('header').getByRole('button', { name: 'Extensions', exact: true })).toHaveCount(0)
    await extensions.click()
    let panel = chrome.getByRole('dialog', { name: 'Extensions', exact: true }), toggle = panel.getByRole('switch', { name: 'Enable Demo extension', exact: true })
    await expect(toggle).toBeChecked(); await hold()
    await toggle.click(); await expect(toggle).not.toBeChecked(); await hold()
    await toggle.click(); await expect(toggle).toBeChecked()
    await chapter('Plugins in the same view')
    await panel.getByRole('tab', { name: 'Plugins', exact: true }).click()
    let pluginToggle = panel.getByRole('switch', { name: 'Enable Demo page tools', exact: true })
    await expect(pluginToggle).toBeChecked(); await hold()
    await pluginToggle.click(); await expect(pluginToggle).not.toBeChecked(); await hold()
    await pluginToggle.click(); await expect(pluginToggle).toBeChecked()
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await chapter('Anti-bot mouse movement and two-second delay')
    await chrome.getByRole('button', { name: /^Profile: default/ }).click()
    let profile = chrome.getByRole('dialog', { name: 'Profile', exact: true })
    await profile.getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    let movement = profile.getByRole('switch', { name: 'Simulate mouse movement', exact: true })
    await expect(movement).toBeChecked()
    await expect(profile.getByRole('spinbutton', { name: 'Social site delay (seconds)' })).toHaveValue('2')
    await movement.scrollIntoViewIfNeeded()
    await hold(2400)
    await profile.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => { (window as any).events = [] })
    await chapter('Virtual pointer moves between automated link clicks')
    await cli('click', { pane, selector: '#first' })
    await expect(page.locator('output')).toHaveText('First link clicked')
    await cli('click', { pane, selector: '#second' })
    await expect(page.locator('output')).toHaveText('Second link clicked')
    let events = await page.evaluate(() => (window as any).events), clicks = events.filter((event: any) => event.type === 'click')
    expect(events.filter((event: any) => event.type === 'mousemove').length).toBeGreaterThanOrEqual(40)
    expect(clicks).toHaveLength(2); expect(clicks.every((event: any) => event.trusted)).toBe(true)
    expect(clicks[1].at - clicks[0].at).toBeGreaterThanOrEqual(1900)
    await hold(1700)
    if (record) { stopped = true; await recording; await fs.writeFile(path.join(destination, 'capture.json'), JSON.stringify({ source: 'Native Tart guest recording; disposable profile and local social-site fixture', crop, frames, chapters, pointerCues, duration: (frames.at(-1)?.at ?? 0) + .1 }, null, 2)) }
    // Plugin clicks and raw CDP clicks share the same animated input path.
    await page.evaluate(() => { (window as any).events = [] })
    let run = await rpc('plugin.run', { action: 'demo/click' })
    await expect.poll(async () => (await rpc('plugin.runs')).find((item: any) => item.id === run.id)?.status, { timeout: 20000 }).toBe('completed')
    expect(await page.evaluate(() => (window as any).events.filter((event: any) => event.type === 'mousemove').length)).toBeGreaterThanOrEqual(20)
    let point = await page.locator('#first').evaluate(element => { let r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await page.evaluate(() => { (window as any).events = [] })
    for (let type of ['mousePressed', 'mouseReleased']) await cli('cdp', { pane, method: 'Input.dispatchMouseEvent', params: { type, ...point, button: 'left', clickCount: 1 } })
    expect(await page.evaluate(() => (window as any).events.filter((event: any) => event.type === 'mousemove').length)).toBeGreaterThanOrEqual(20)
    await chrome.getByRole('button', { name: /^Profile: default/ }).click()
    await profile.getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    await movement.click(); await expect(movement).not.toBeChecked()
    await expect.poll(async () => (await chrome.evaluate(() => (window as any).bmux.state())).automationSafety.limits.profileLimits.profile_default.simulateMouseMovement).toBe(false)
    await profile.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => { (window as any).events = [] })
    await cli('click', { pane, selector: '#first' })
    expect(await page.evaluate(() => (window as any).events.filter((event: any) => event.type === 'mousemove').length)).toBe(0)
    expect((await fs.readFile(path.join(directory, 'config.yaml'), 'utf8'))).toContain('simulateMouseMovement: false')
    let other = await rpc('profile.create', { name: 'Second pane' })
    await rpc('split-window', { pane, profile: other.id })
    await expect(chrome.getByRole('button', { name: 'Extensions', exact: true })).toHaveCount(2)
    await chrome.getByRole('button', { name: 'Profile: default', exact: true }).locator('..').getByRole('button', { name: 'Extensions', exact: true }).click()
    await panel.getByRole('tab', { name: 'Chrome extensions', exact: true }).click()
    await expect(panel).toContainText('Profile: default')
    await expect(toggle).toBeChecked()
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await chrome.getByRole('button', { name: 'Choose pane profile: Second pane', exact: true }).locator('..').getByRole('button', { name: 'Extensions', exact: true }).click()
    await expect(panel).toContainText('Profile: Second pane')
    await expect(panel.getByRole('button', { name: /^Enable Demo extension/ })).toBeVisible()

  } finally {
    stopped = true; await recording
    if (record && started) await fs.writeFile(path.join(destination, 'capture.json'), JSON.stringify({ source: 'Native Tart guest recording; disposable profile and local social-site fixture', crop, frames, chapters, pointerCues, duration: (frames.at(-1)?.at ?? 0) + .1 }, null, 2))
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
