import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { stringify } from 'yaml'

let directory: string, application: ElectronApplication, chrome: Page, page: Page, url: string, server: http.Server
let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
let state = () => chrome.evaluate(() => (window as any).bmux.state())
let activate = async () => { let current = await state(); await expect.poll(async () => { await rpc('activate-client', { client: current.clientId }); return (await state()).focusedClientId }).toBe(current.clientId) }
let prompt = () => chrome.getByRole('combobox', { name: 'Command', exact: true })
let open = async () => { await activate(); await chrome.getByRole('button', { name: 'Command prompt', exact: true }).click(); await expect(prompt()).toBeFocused() }
let nativeVisible = () => application.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some(view => 'webContents' in view && (view as any).webContents.getURL() === url && view.getBounds().height > 300)), url)
let closeShortcut = async (key: string) => {
  await activate()
  await rpc('focus-page', { client: (await state()).clientId })
  await application.evaluate(async ({ webContents }, key) => {
    for (let event of [{ keyCode: 'x', modifiers: ['control'] }, { keyCode: key, modifiers: key === 'Q' ? ['shift'] : [] }]) {
      let contents = webContents.getFocusedWebContents()!
      contents.sendInputEvent({ type: 'keyDown', ...event } as Electron.KeyboardInputEvent)
      contents.sendInputEvent({ type: 'keyUp', ...event } as Electron.KeyboardInputEvent)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }, key)
}

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-command-search-'))
  await fs.mkdir(path.join(directory, 'plugins/fixture'), { recursive: true })
  await fs.writeFile(path.join(directory, 'plugins/fixture/plugin.yaml'), stringify({ schema_version: 1, id: 'fixture', name: 'Fixture plugin', version: '1', actions: [{ id: 'greet', title: 'Fixture greeting', command: ['node', '-e', 'process.exit(0)'], capabilities: [] }] }))
  await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: { prefix: 'Ctrl+X', shortcuts: { 'Cmd+Alt+D': 'browser-tools', 'Cmd+Alt+P': 'plugin:fixture/greet' }, prefixBindings: { q: 'close-pane', Q: 'close-window' } }, browser: { autoUpdateFilters: false }, plugins: { fixture: { enabled: true } } }))
  server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Command search fixture</title><style>body{background:#e8eef8;color:#173353;font:24px sans-serif;padding:32px}</style><h1>Command search fixture</h1><p>A visible native page behind the command finder.</p>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${(server.address() as any).port}/fixture`
  let installed = process.env.BMUX_TEST_INSTALLED === '1'
  application = await electron.launch({ ...(installed ? { executablePath: path.resolve(process.env.BMUX_OUTPUT_DIR || 'build', 'bmux.app/Contents/MacOS/bmux') } : {}), args: installed ? [] : [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
  chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
  await activate(); await chrome.getByRole('button', { name: 'Address', exact: true }).click()
  let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true }); await address.fill(url); await address.press('Enter')
  await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
  page = application.context().pages().find(page => page.url() === url)!
  await expect(page.locator('h1')).toBeVisible()
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
})
test.beforeEach(async () => {
  await chrome.keyboard.press('Escape'); await chrome.keyboard.press('Escape')
  let current = await state(); await rpc('select-window', { client: current.clientId, window: current.model.sessions[0].windows[0].id }); await activate()
})
test.afterAll(async () => { await application?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (directory) await fs.rm(directory, { recursive: true, force: true }) })

test('command finder accepts fuzzy selection and restores the native page', async () => {
  await expect.poll(nativeVisible).toBe(true)
  await open()
  await expect(chrome.getByRole('listbox', { name: 'Commands', exact: true })).toBeVisible()
  await prompt().fill('brtls')
  let selected = chrome.getByRole('option', { selected: true })
  await expect(selected).toContainText('browser-tools'); await expect(selected).toContainText('Cmd+Alt+D')
  await chrome.screenshot({ path: path.resolve('artifacts/command-finder.png') })
  await prompt().press('Enter')
  await expect(chrome.getByRole('dialog', { name: 'Browser tools', exact: true })).toBeVisible()
  await chrome.getByRole('button', { name: 'Close', exact: true }).click(); await activate()
  await expect.poll(nativeVisible).toBe(true)
  await expect(page.locator('h1')).toHaveText('Command search fixture')
  let config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'statusBar: bottom\n' + await fs.readFile(config, 'utf8'))
  await expect.poll(async () => (await state()).statusBar).toBe('bottom')
  await open(); await prompt().fill('brtls')
  let finder = chrome.getByRole('region', { name: 'Command finder', exact: true }), status = chrome.getByRole('contentinfo', { name: 'Browser status' })
  await expect.poll(async () => { let bounds = (await finder.boundingBox())!; return bounds.y + bounds.height - (await status.boundingBox())!.y }).toBeLessThanOrEqual(1)
  await chrome.screenshot({ path: path.resolve('artifacts/command-finder-bottom.png') })
  await prompt().press('Escape'); await expect.poll(nativeVisible).toBe(true)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
})

test('command arguments, completion, history, and keyboard result selection work together', async () => {
  await open(); await prompt().fill('new-window -n "two words"'); await prompt().press('Enter')
  await expect(chrome.getByRole('button', { name: '1:two words*', exact: true })).toBeVisible()
  await open(); await prompt().press('Control+r'); await expect(prompt()).toHaveValue('new-window -n "two words"')
  await prompt().press('Control+s'); await expect(prompt()).toHaveValue('')
  await prompt().fill('new-session'); await prompt().press('Tab'); await expect(prompt()).toHaveValue('new-session -s ')
  await prompt().press('Control+s'); await expect(prompt()).toHaveValue('new-session -s ')
  await prompt().press('Control+r'); await prompt().press('Control+s'); await expect(prompt()).toHaveValue('new-session -s ')
  expect((await state()).model.sessions).toHaveLength(1)
  await prompt().fill('dark')
  let first = await prompt().getAttribute('aria-activedescendant')
  await prompt().press('Control+n'); expect(await prompt().getAttribute('aria-activedescendant')).not.toBe(first)
  await prompt().press('Control+p'); await expect(prompt()).toHaveAttribute('aria-activedescendant', first!)
  await prompt().press('ArrowDown'); await prompt().press('Tab'); await expect(prompt()).toHaveValue('dark on')
  await prompt().fill('dark mode'); await expect(chrome.getByRole('option', { selected: true })).toContainText('Toggle dark mode')
  await prompt().fill('brtls'); await prompt().press('Shift+Enter'); await expect(chrome.getByRole('status')).toContainText('Unknown command')
  await prompt().fill('zzzzunmatched'); await expect(chrome.getByText('No matching commands. Enter runs the text you typed.', { exact: true })).toBeVisible()
  await prompt().press('Enter'); await expect(chrome.getByRole('status')).toContainText('Unknown command')
  await prompt().press('Escape'); await expect(prompt()).toHaveCount(0)
})

test('enabled plugin actions appear in fuzzy command results and execute', async () => {
  await open(); await prompt().fill('fixture greeting')
  await expect(chrome.getByRole('option', { selected: true })).toContainText('plugin run fixture/greet')
  await expect(chrome.getByRole('option', { selected: true })).toContainText('Cmd+Alt+P')
  await prompt().press('Enter')
  await expect.poll(async () => (await rpc('plugin.runs')).find((run: any) => run.pluginId === 'fixture')?.status).toBe('completed')
})

test('close-pane shortcut immediately removes the selected pane', async () => {
  let current = await state(), window = current.model.sessions[0].windows[0], original = window.panes[0]
  let pane = await rpc('split-window', { pane: original.id, client: current.clientId })
  await activate(); await rpc('focus-page', { client: current.clientId })
  await application.evaluate(async ({ webContents }) => {
    for (let event of [{ keyCode: 'x', modifiers: ['control'] }, { keyCode: 'q', modifiers: [] }]) {
      let contents = webContents.getFocusedWebContents()!
      contents.sendInputEvent({ type: 'keyDown', ...event } as Electron.KeyboardInputEvent)
      contents.sendInputEvent({ type: 'keyUp', ...event } as Electron.KeyboardInputEvent)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  })
  await expect(chrome.getByRole('textbox', { name: 'Close pane confirmation', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await state()).model.sessions[0].windows[0].panes.some((item: { id: string }) => item.id === pane.id)).toBe(false)
})

test('closing the last pane removes its window and Q confirms only above two windows', async () => {
  let current = await state(), session = current.model.sessions[0]
  for (let window of session.windows.slice(1)) await rpc('kill-window', { window: window.id, confirm: true })
  let create = () => rpc('new-window', { session: session.id, client: current.clientId })
  let window = await create()
  await closeShortcut('q')
  await expect.poll(async () => (await state()).model.sessions[0].windows.some((item: any) => item.id === window.id)).toBe(false)
  await create()
  await closeShortcut('Q')
  await expect.poll(async () => (await state()).model.sessions[0].windows.length).toBe(1)
  await create(); await create()
  await closeShortcut('Q')
  let confirmation = chrome.getByRole('textbox', { name: 'Close window confirmation', exact: true })
  await expect(confirmation).toBeFocused()
  expect((await state()).model.sessions[0].windows.length).toBe(3)
  await confirmation.press('n')
  expect((await state()).model.sessions[0].windows.length).toBe(3)
  await closeShortcut('Q')
  await confirmation.press('y')
  await expect.poll(async () => (await state()).model.sessions[0].windows.length).toBe(2)
  let remaining = (await state()).model.sessions[0].windows[1]
  await rpc('select-window', { client: current.clientId, window: remaining.id })
  await closeShortcut('Q')
  await expect.poll(async () => (await state()).model.sessions[0].windows.length).toBe(1)
})

test('slash searches help commands and active shortcuts; Escape clears before closing', async () => {
  await chrome.getByRole('button', { name: 'Help', exact: true }).click()
  let help = chrome.getByRole('dialog', { name: 'Help', exact: true })
  await expect(help).toBeVisible(); await help.getByRole('button', { name: 'Close', exact: true }).focus(); await chrome.keyboard.press('/')
  let search = help.getByRole('textbox', { name: 'Search help', exact: true }); await expect(search).toBeFocused()
  await search.fill('browser tools')
  await expect(help.getByText('Cmd+Alt+D', { exact: true })).toBeVisible()
  await expect(help.getByText('browser-tools', { exact: true }).first()).toBeVisible()
  await expect(help.getByText('reload', { exact: true })).toHaveCount(0)
  await chrome.screenshot({ path: path.resolve('artifacts/help-search.png') })
  await search.fill('Ctrl X'); await expect(help.getByText('Ctrl+X then ?', { exact: true })).toBeVisible()
  await search.fill('zzzzunmatched'); await expect(help.getByText('No matching help entries.', { exact: true })).toBeVisible()
  await search.press('Escape'); await expect(help).toBeVisible(); await expect(search).toHaveCount(0)
  await chrome.keyboard.press('/'); await expect(search).toBeFocused(); await expect(search).toHaveValue('')
  await search.press('Escape'); await chrome.keyboard.press('Escape'); await expect(help).toHaveCount(0)
  await activate(); await expect.poll(nativeVisible).toBe(true)
})

test('tab picker focuses the active tab, navigates without switching, and selects on Enter', async () => {
  let current = await state(), pane = current.model.sessions[0].windows[0].panes[0]
  let original = pane.activeTabId, created: string[] = []
  let picker = chrome.getByRole('group', { name: 'Choose tab', exact: true }), rows = picker.getByRole('button')
  let activeTab = async () => (await state()).model.sessions[0].windows[0].panes[0].activeTabId
  let tabs = [original]
  try {
    for (let index = 1; index <= 12; index++) {
      let tab = await rpc('tab.create', { pane: pane.id, url: `${url}?tab=${index}` })
      created.push(tab.id); tabs.push(tab.id)
    }
    await rpc('tab.select', { tab: tabs[6] })
    await open(); await prompt().fill('tabs'); await prompt().press('Enter')
    await expect(rows).toHaveCount(13)
    await expect(rows.nth(6)).toBeFocused()
    await expect(rows.nth(6)).toHaveAttribute('aria-current', 'true')
    for (let [key, index] of [['ArrowDown', 7], ['ArrowUp', 6], ['Home', 0], ['ArrowUp', 0], ['End', 12], ['ArrowDown', 12], ['PageUp', 2], ['PageDown', 12]] as const) {
      await chrome.keyboard.press(key)
      await expect(rows.nth(index)).toBeFocused()
      expect(await activeTab()).toBe(tabs[6])
    }
    await chrome.screenshot({ path: path.resolve('artifacts/tab-picker.png') })
    await chrome.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    expect(await activeTab()).toBe(tabs[6])
    await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(`${url}?tab=6`)
    await activate(); await chrome.getByRole('button', { name: 'Tabs', exact: true }).click()
    await expect(rows.nth(6)).toBeFocused()
    // Background list updates must preserve focus and the active tab.
    await rpc('tab.close', { tab: tabs[1] }); created = created.filter(id => id !== tabs[1])
    await expect(rows).toHaveCount(12)
    await expect(rows.nth(5)).toBeFocused()
    expect(await activeTab()).toBe(tabs[6])
    await chrome.keyboard.press('End'); await chrome.keyboard.press('Enter')
    await expect(picker).toHaveCount(0)
    await expect.poll(activeTab).toBe(tabs[12])
    await expect.poll(() => application.evaluate(({ BaseWindow, webContents }, target) => {
      let attached = BaseWindow.getAllWindows().filter(window => window.isVisible()).some(window => window.contentView.children.some(view => 'webContents' in view && (view as any).webContents.getURL() === target && view.getBounds().height > 300))
      return { attached, focusedUrl: webContents.getFocusedWebContents()?.getURL() }
    }, `${url}?tab=12`)).toEqual({ attached: true, focusedUrl: `${url}?tab=12` })
  } finally {
    await chrome.keyboard.press('Escape')
    await rpc('tab.select', { tab: original })
    for (let tab of created) await rpc('tab.close', { tab })
  }
  // A single-tab pane uses the same picker and keeps its native page on selection.
  await activate(); await chrome.getByRole('button', { name: 'Tabs', exact: true }).click()
  await expect(rows).toHaveCount(1); await expect(rows.first()).toBeFocused()
  await chrome.keyboard.press('PageDown'); await chrome.keyboard.press('Enter')
  await expect(picker).toHaveCount(0); expect(await activeTab()).toBe(original)
  await expect.poll(nativeVisible).toBe(true)
  await expect.poll(() => application.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
})
