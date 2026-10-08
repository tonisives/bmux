import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)
let wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('capture five feature walkthroughs in the disposable Tart guest', async () => {
  if (process.env.BMUX_TEST_NATIVE !== '1') throw new Error('Use the public Tart runner')
  let root = process.cwd(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-articles-'))
  let output = path.join(root, 'artifacts', 'feature-articles')
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard:\n  shortcuts:\n    j: { action: scroll-down, when: pane-not-editing }\n    k: { action: scroll-up, when: pane-not-editing }\n    Shift+G: { action: scroll-bottom, when: pane-not-editing }\n  sequences:\n    gg: { action: scroll-top, when: pane-not-editing }\n')
  let html = await fs.readFile(new URL('./features.html', import.meta.url), 'utf8')
  let server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let app = await electron.launch({ args: [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  let cli = async (method: string, args: Record<string, unknown> = {}) => {
    let result = await exec(process.execPath, [path.join(root, 'bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 30000 })
    let data = JSON.parse(result.stdout); if (!data.ok) throw new Error(data.error); return data.result
  }
  let shots: { feature: string; file: string; caption: string }[] = []
  try {
    await expect.poll(() => app.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = app.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = await cli('state'), client = state.model.clients[0], window = state.model.sessions[0].windows[0], pane = window.panes[0]
    await cli('rename-session', { session: state.model.sessions[0].id, name: 'feature guide' })
    await cli('rename-window', { window: window.id, name: 'review' })
    await cli('activate-client', { client: client.id })
    await app.evaluate(({ BaseWindow, screen }) => { let area = screen.getPrimaryDisplay().workArea; for (let win of BaseWindow.getAllWindows()) if (win.isVisible()) win.setBounds({ x: area.x + 10, y: area.y + 10, width: Math.min(1200, area.width - 20), height: Math.min(820, area.height - 20) }) })
    await exec('/usr/bin/caffeinate', ['-u', '-t', '1'])
    let keys = async (...values: { keyCode: string; modifiers?: string[] }[]) => {
      await app.evaluate(async ({ webContents }, values) => {
        let target = webContents.getFocusedWebContents(); if (!target) throw new Error('No focused view')
        for (let event of values) { target.sendInputEvent({ type: 'keyDown', ...event }); target.sendInputEvent({ type: 'keyUp', ...event }); await new Promise(resolve => setTimeout(resolve, 60)) }
      }, values)
    }
    let capture = async (feature: string, caption: string) => {
      await wait(500)
      let file = `${feature}-${shots.filter(shot => shot.feature === feature).length + 1}.png`
      await exec('/usr/sbin/screencapture', ['-x', path.join(output, file)], { timeout: 10000 })
      expect((await fs.stat(path.join(output, file))).size).toBeGreaterThan(5000)
      shots.push({ feature, file, caption })
      console.log(`Captured ${file}: ${caption}`)
    }
    let command = async (text: string) => {
      await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click()
      let input = chrome.getByRole('combobox', { name: 'Command', exact: true })
      await input.fill(text); await input.press('Enter')
    }
    await cli('focus-page', { client: client.id })
    await keys({ keyCode: 'l', modifiers: ['meta'] })
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await cli('wait', { pane: pane.id, selector: 'h1' })
    let page = app.context().pages().find(page => page.url() === `${url}/`)!
    await capture('floating-panes', 'Start with the review page')
    let split = await cli('split-window', { pane: pane.id, url: `${url}/reference` })
    await cli('wait', { pane: split.id, selector: 'h1' })
    await capture('floating-panes', 'Split panes keep both pages visible')
    await cli('break-pane', { pane: split.id, floating: true })
    await cli('move-pane', { pane: split.id, x: 580, y: 180 })
    await cli('resize-pane', { pane: split.id, width: 560, height: 490 })
    await capture('floating-panes', 'Float the reference above your workspace')
    await cli('join-pane', { pane: split.id, destination: pane.id, axis: 'horizontal' })
    await capture('floating-panes', 'Return the same pane to a split')
    await cli('kill-pane', { pane: split.id, confirm: true })
    await cli('select-pane', { client: client.id, pane: pane.id }); await cli('focus-page', { client: client.id })
    await keys({ keyCode: 'Alt', modifiers: ['alt'] }, { keyCode: 'Alt', modifiers: ['alt'] })
    await expect(page.locator('[data-bmux-click-mode]')).toHaveCount(1)
    await capture('click-mode', 'Double-tap Option to show click hints')
    await keys({ keyCode: 'f' })
    await expect(page.locator('[data-bmux-click-mode]')).toHaveAttribute('data-bmux-click-selected', 'float')
    await capture('click-mode', 'Choose f before typing the link hint')
    await keys({ keyCode: 'a' })
    await expect.poll(async () => (await cli('state')).model.sessions[0].windows[0].panes.length).toBe(2)
    await capture('click-mode', 'The selected link opens in a floating pane')
    let float = (await cli('state')).model.sessions[0].windows[0].panes.find((item: { id: string }) => item.id !== pane.id)
    await cli('kill-pane', { pane: float.id, confirm: true })
    await cli('select-pane', { client: client.id, pane: pane.id })
    await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
    let profile = chrome.getByRole('dialog', { name: 'Profile', exact: true })
    await profile.getByLabel('Protocol', { exact: true }).selectOption('http')
    await profile.getByLabel('Host', { exact: true }).fill('127.0.0.1')
    await profile.getByLabel('Port', { exact: true }).fill(String((server.address() as { port: number }).port))
    await profile.getByLabel('Proxy requires authentication').uncheck()
    await profile.getByRole('heading', { name: 'Connection', exact: true }).scrollIntoViewIfNeeded()
    await capture('profile-proxies', 'Configure a local demonstration endpoint')
    await profile.getByRole('button', { name: 'Save proxy', exact: true }).click()
    await expect.poll(async () => (await cli('state')).model.profiles[0].proxy?.host).toBe('127.0.0.1')
    await profile.getByRole('button', { name: 'Close', exact: true }).click()
    await chrome.getByRole('button', { name: 'Proxy for default', exact: true }).click()
    await capture('profile-proxies', 'The profile has its own proxy panel')
    let proxyPanel = chrome.getByRole('dialog', { name: 'Proxy', exact: true })
    await proxyPanel.getByRole('button', { name: 'Use system connection', exact: true }).click()
    await capture('profile-proxies', 'Return this profile to the system connection')
    await proxyPanel.getByRole('button', { name: 'Close', exact: true }).click()
    await cli('navigate', { pane: pane.id, url: `${url}/search?q=browser&limit=20` })
    await cli('wait', { pane: pane.id, selector: 'h1' })
    await cli('focus-page', { client: client.id }); await keys({ keyCode: 'd', modifiers: ['meta'] })
    let bookmark = chrome.getByRole('dialog', { name: 'Bookmark', exact: true })
    await bookmark.getByLabel('Title', { exact: true }).fill('Release search')
    await capture('bookmarks', 'Save a reusable search with Command+D')
    await bookmark.getByRole('button', { name: 'Save bookmark', exact: true }).click()
    await command('bookmarks')
    await chrome.getByRole('textbox', { name: 'Search bookmarks', exact: true }).fill('Release')
    await capture('bookmarks', 'Find the saved page by its title')
    await chrome.getByRole('button', { name: 'Customize Release search', exact: true }).click()
    await chrome.getByRole('spinbutton', { name: 'limit', exact: true }).fill('40')
    await capture('bookmarks', 'Edit query parameters before opening')
    await chrome.getByRole('button', { name: 'Open', exact: true }).click()
    await capture('bookmarks', 'Open the customized bookmark')
    await cli('navigate', { pane: pane.id, url }); await cli('wait', { pane: pane.id, selector: '#notes' })
    await cli('focus-page', { client: client.id })
    await capture('vim-navigation', 'Configured Vim bindings apply to page content')
    await keys({ keyCode: 'G', modifiers: ['shift'] })
    await expect.poll(() => cli('eval', { pane: pane.id, expression: 'scrollY' })).toBeGreaterThan(500)
    await capture('vim-navigation', 'Shift+G moves to the bottom of the page')
    await keys({ keyCode: 'g' }, { keyCode: 'g' })
    await expect.poll(() => cli('eval', { pane: pane.id, expression: 'scrollY' })).toBe(0)
    let typingPage = app.context().pages().filter(page => page.url() === `${url}/` && page !== chrome).at(-1)!
    let notes = typingPage.locator('#notes')
    await notes.click()
    for (let key of 'j and k stay text') await notes.press(key === ' ' ? 'Space' : key)
    await expect.poll(() => cli('eval', { pane: pane.id, expression: 'document.querySelector("#notes").value' })).toBe('j and k stay text')
    await capture('vim-navigation', 'The same keys type normally inside a text field')
  } finally {
    await fs.writeFile(path.join(output, 'captures.json'), JSON.stringify({ capturedAt: new Date().toISOString(), source: 'Tart guest; native window captures; local fixtures; proxy endpoint is a fixture, not a real regional connection', shots }, null, 2))
    await app.close(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true })
  }
})
