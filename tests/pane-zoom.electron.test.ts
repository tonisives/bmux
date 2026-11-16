import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication, waitForControlStatus } from './electron-fixture'
import { observeNativeFocus, recordNativeFocus, sendNativeKeys } from './native-focus'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('pane zoom keeps the locked viewport dock at the top right of a 4x4 grid and accepts Cmd+Z through an agent shield', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-pane-zoom-'))
  let config = path.join(directory, 'config.yaml')
  await fs.writeFile(config, 'keyboard: {}\nagentFeedback:\n  inputUnlockMs: 60000\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Pane zoom fixture</title><button id="surface">Page content</button><textarea aria-label="Notes"></textarea>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let failed = true
  try {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
    await observeNativeFocus(application)
    let cli = async (...args: string[]) => {
      let { stdout } = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'pane-zoom-fixture' }, timeout: 15000 })
      let response = JSON.parse(stdout)
      expect(response.ok, response.error).toBe(true)
      return response.result
    }
    await waitForControlStatus(cli)
    expect((await cli('diagnostics', '--no-start')).pid).toBe(application.process().pid)
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
    await rpc('activate-client', { client: client.id })
    await rpc('navigate', { pane: client.paneId, url })
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#surface')).toBeVisible()
    for (let index = 1; index < 16; index++) await rpc('split-window', { pane: client.paneId, url: `${url}${index}` })
    await rpc('select-layout', { window: client.windowId, layout: 'tiled' })
    await expect.poll(async () => (await state()).nativePagePanes.length).toBe(16)
    for (let fixture of application.context().pages().filter(page => page.url().startsWith(url))) await expect(fixture.locator('#surface')).toBeVisible()
    await rpc('lock-viewport', { window: client.windowId, width: 1512, height: 900 })
    let dockId: number | undefined
    await expect.poll(async () => {
      dockId = await application!.evaluate(async ({ webContents }, pane) => {
        for (let contents of webContents.getAllWebContents().filter(contents => contents.getURL().endsWith('#plugin-overlay'))) {
          if ((await contents.executeJavaScript('window.bmux.overlayState()'))?.paneId === pane) return contents.id
        }
      }, client.paneId)
      return dockId
    }).toBeTruthy()
    let content = chrome.locator(`[data-content-pane-id="${client.paneId}"]`)
    let paneWidth = () => content.evaluate(element => element.getBoundingClientRect().width)
    let cmdZ = async () => {
      await expect.poll(() => application!.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()?.isVisible())).toBe(true)
      if (process.platform === 'darwin') await promisify(execFile)('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down'])
      else await sendNativeKeys(application!, [{ keyCode: 'z', modifiers: ['meta'] }])
    }
    let zoomed = async () => (await state()).model.clients.find((item: any) => item.id === client.id).zoomedPaneId ?? null
    let expectDock = async () => {
      await expect.poll(async () => {
        let pane = await content.boundingBox()
        let dock = await application!.evaluate(({ BaseWindow, WebContentsView }, id) => {
          for (let window of BaseWindow.getAllWindows()) for (let view of window.contentView.children) {
            if (view instanceof WebContentsView && view.webContents.id === id && view.getVisible()) return view.getBounds()
          }
        }, dockId)
        if (!pane || !dock) return false
        let right = pane.x + pane.width - dock.x - dock.width, top = dock.y - pane.y
        return right >= -1 && right <= 13 && top >= -1 && top <= 13
      }).toBe(true)
    }
    await expect.poll(paneWidth).toBeLessThan((await chrome.evaluate(() => innerWidth)) / 3)
    await expectDock()
    for (let attempt = 0; attempt < 2; attempt++) {
      await rpc('select-pane', { client: client.id, pane: client.paneId })
      await rpc('focus-page', { client: client.id })
      await expect.poll(() => application!.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
      await expect.poll(async () => (await state()).model.clients.find((item: any) => item.id === client.id).paneId).toBe(client.paneId)
      await rpc('toggle-pane-zoom', { client: client.id })
      await expect.poll(zoomed).toBe(client.paneId)
      await expect.poll(paneWidth).toBeGreaterThan((await chrome.evaluate(() => innerWidth)) * .9)
      await expectDock()
      if (attempt === 0 && process.platform === 'darwin') {
        await fs.mkdir('artifacts', { recursive: true })
        await promisify(execFile)('/usr/sbin/screencapture', ['-x', 'artifacts/pane-zoom-viewport-dock.png'])
      }
      await rpc('toggle-pane-zoom', { client: client.id })
      await expect.poll(zoomed).toBeNull()
      await expect.poll(paneWidth).toBeLessThan((await chrome.evaluate(() => innerWidth)) / 3)
      await expectDock()
    }
    // Keep an editor focused underneath the shield: only the shield is outside editing.
    await page.getByRole('textbox', { name: 'Notes' }).focus()
    await cli('eval', '-t', client.paneId, 'document.title', '--no-start')
    await expect.poll(async () => (await state()).lockedAgentPanes).toContain(client.paneId)
    await rpc('select-pane', { client: client.id, pane: client.paneId })
    await rpc('focus-page', { client: client.id })
    await expect.poll(async () => (await state()).model.clients.find((item: any) => item.id === client.id).paneId).toBe(client.paneId)
    await expect.poll(() => application!.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getTitle())).toBe('Agent input lock')
    for (let attempt = 0; attempt < 2; attempt++) {
      await test.step(`Native zoom cycle ${attempt + 1}`, async () => {
        await cmdZ()
        await expect.poll(zoomed).toBe(client.paneId)
        await expectDock()
        await expect.poll(() => application!.context().pages().filter(page => page.url().startsWith(url)).length).toBeLessThan(16)
        await expect.poll(() => application!.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getTitle())).toBe('Agent input lock')
        await cmdZ()
        await expect.poll(zoomed).toBeNull()
        await expectDock()
        await expect.poll(async () => (await state()).nativePagePanes.length).toBe(16)
        for (let fixture of application!.context().pages().filter(page => page.url().startsWith(url))) await expect(fixture.locator('#surface')).toBeVisible()
        await expect.poll(async () => (await state()).model.clients.find((item: any) => item.id === client.id).paneId).toBe(client.paneId)
        await expect.poll(() => application!.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getTitle())).toBe('Agent input lock')
      })
    }
    await rpc('agent.input-lock.override', { pane: client.paneId, enabled: true })
    await expect.poll(async () => (await state()).lockedAgentPanes).not.toContain(client.paneId)
    await rpc('unlock-viewport', { window: client.windowId })
    await rpc('focus-page', { client: client.id })
    await page.getByRole('textbox', { name: 'Notes' }).click()
    await page.keyboard.type('draft')
    await page.keyboard.press('Backspace')
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('draf')
    await expect(page.getByRole('textbox', { name: 'Notes' })).toBeFocused()
    await rpc('select-pane', { client: client.id, pane: client.paneId })
    await rpc('focus-page', { client: client.id })
    await expect.poll(() => application!.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(url)
    await cmdZ()
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('draft')
    expect(await zoomed()).toBeNull()
    failed = false
  } finally {
    if (application) await recordNativeFocus(application, info, failed)
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
