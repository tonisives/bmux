import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { closeTestApplication } from './electron-fixture'
import { sendNativeKeys } from './native-focus'

test('background page limit unloads older applications and restores them without changing selection', async () => {
  test.setTimeout(120000)
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-page-budget-'))
  let holdOldRestore = false
  let heldOld = new Set<http.ServerResponse>()
  let server = http.createServer((request, response) => {
    if (holdOldRestore && request.url === '/old') {
      heldOld.add(response)
      response.once('close', () => heldOld.delete(response))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Set-Cookie': 'fixture=retained; Path=/' })
    response.end('<!doctype html><title>Page budget fixture</title><h1>Page budget fixture</h1><input id="draft" value=""><div contenteditable="true"></div><div id="rich-draft" contenteditable="true"></div><script>window.loadedAt=Date.now()</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\nagentFeedback:\n  inputUnlockMs: 0\n  actionDelayMinMs: 0\n  actionDelayMaxMs: 0\nmemory:\n  maxLoadedBackgroundPages: 0\n')
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}): Promise<any> => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId)
    await rpc('activate-client', { client: client.id })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${origin}/visible`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/visible`)).toBe(true)
    let visiblePage = application.context().pages().find(page => page.url() === `${origin}/visible`)!
    await expect(visiblePage.locator('h1')).toHaveText('Page budget fixture')
    let create = async (name: string, profile?: string) => {
      let window = await rpc('new-window', { session: client.sessionId, url: `${origin}/${name}`, ...(profile ? { profile } : {}) })
      await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/${name}`)).toBe(true)
      let page = application!.context().pages().find(page => page.url() === `${origin}/${name}`)!
      await expect(page.locator('h1')).toHaveText('Page budget fixture')
      return { window, pane: window.panes[0], page }
    }
    let old = await create('old')
    await rpc('navigate', { pane: old.pane.id, url: `${origin}/old-second` })
    await expect.poll(() => old.page.url()).toBe(`${origin}/old-second`)
    let bot = await create('background-profile', 'bot')
    let kept = await create('kept')
    await rpc('pane.keep-alive', { pane: kept.pane.id, enabled: true })
    let edited = await create('edited')
    await edited.page.locator('#draft').fill('Unsaved draft')
    let rich = await create('edited-rich')
    await rich.page.locator('#rich-draft').fill('Unsaved rich text')
    let newest = await create('newest')
    let selection = (await state()).model.clients
    await rpc('settings.set', { key: 'memory.maxLoadedBackgroundPages', value: 5 })
    let live = async (pane: string) => (await rpc('memory')).current.panes.find((item: any) => item.paneId === pane).webContentsId
    await expect.poll(() => live(old.pane.id)).toBeNull()
    expect(await live(bot.pane.id)).not.toBeNull()
    expect(await live(newest.pane.id)).not.toBeNull()
    let busy = rpc('eval', { pane: bot.pane.id, expression: 'new Promise(resolve => { window.releaseBudget = () => resolve("finished") })' })
    await expect.poll(async () => (await rpc('memory')).current.panes.find((item: any) => item.paneId === bot.pane.id).busy).toBe(true)
    await rpc('settings.set', { key: 'memory.maxLoadedBackgroundPages', value: 3 })
    await expect.poll(() => live(newest.pane.id)).toBeNull()
    expect(await live(bot.pane.id)).not.toBeNull()
    await bot.page.evaluate(() => (window as any).releaseBudget())
    expect(await busy).toBe('finished')
    // Finishing a command does not change selection; the periodic budget check
    // unloads the now inactive background-profile page as well.
    await rpc('settings.set', { key: 'memory.maxLoadedBackgroundPages', value: 3 })
    await expect.poll(() => live(bot.pane.id), { timeout: 35000 }).toBeNull()
    expect(await live(kept.pane.id)).not.toBeNull()
    expect(await live(edited.pane.id)).not.toBeNull()
    expect(await live(rich.pane.id)).not.toBeNull()
    expect(await live(client.paneId)).not.toBeNull()
    expect((await state()).model.clients).toEqual(selection)
    await expect(edited.page.locator('#draft')).toHaveValue('Unsaved draft')
    await expect(rich.page.locator('#rich-draft')).toHaveText('Unsaved rich text')
    expect((await rpc('list-panes', { window: old.window.id }))[0].runtimeState).toBe('unloaded')

    // Agent access restores history and cookies even when all budget slots are protected.
    expect(await rpc('eval', { pane: old.pane.id, expression: '({url:location.href,cookie:document.cookie})' })).toEqual({ url: `${origin}/old-second`, cookie: 'fixture=retained' })
    await rpc('back', { pane: old.pane.id })
    await expect.poll(async () => (await rpc('list-panes', { window: old.window.id }))[0].url).toBe(`${origin}/old`)
    expect((await state()).model.clients).toEqual(selection)

    // Explicit navigation from an unloaded page retains the previous history.
    await rpc('settings.set', { key: 'memory.maxLoadedBackgroundPages', value: 3 })
    await expect.poll(() => live(old.pane.id), { timeout: 35000 }).toBeNull()
    await rpc('navigate', { pane: old.pane.id, url: `${origin}/old-third` })
    await rpc('back', { pane: old.pane.id })
    await expect.poll(async () => (await rpc('list-panes', { window: old.window.id }))[0].url).toBe(`${origin}/old`)

    // Selecting an unloaded page starts restoration. A new navigation must
    // interrupt even a server that never answers the restored request.
    await rpc('settings.set', { key: 'memory.maxLoadedBackgroundPages', value: 3 })
    await expect.poll(() => live(old.pane.id), { timeout: 35000 }).toBeNull()
    holdOldRestore = true
    await rpc('select-window', { client: client.id, window: old.window.id })
    await expect.poll(() => heldOld.size).toBeGreaterThan(0)
    await rpc('navigate', { pane: old.pane.id, url: `${origin}/old-third` })
    expect(await rpc('eval', { pane: old.pane.id, expression: 'location.href' })).toBe(`${origin}/old-third`)
    holdOldRestore = false
    for (let response of heldOld) response.destroy()
    await rpc('back', { pane: old.pane.id })
    await expect.poll(async () => (await rpc('list-panes', { window: old.window.id }))[0].url).toBe(`${origin}/old`)
    await rpc('select-window', { client: client.id, window: client.windowId })
    expect((await state()).model.clients).toEqual(selection)

    // The setting is editable through the existing Memory panel and applies live.
    await rpc('settings.set', { key: 'memory.maxLoadedBackgroundPages', value: 0 })
    await rpc('focus-ui', { client: client.id })
    await sendNativeKeys(application, [{ keyCode: ',', modifiers: ['meta'] }])
    let panel = chrome.getByRole('dialog', { name: 'Settings', exact: true })
    await panel.getByRole('tab', { name: 'Memory', exact: true }).click()
    let limit = panel.locator('[name="memory.maxLoadedBackgroundPages"]')
    await expect(limit).toHaveValue('0')
    await limit.selectOption('4')
    await expect.poll(async () => (await state()).memory.maxLoadedBackgroundPages).toBe(4)
    await panel.screenshot({ path: test.info().outputPath('memory-page-limit.png') })
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
