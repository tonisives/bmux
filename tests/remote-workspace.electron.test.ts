import { test, expect, _electron as electron } from '@playwright/test'
import { build } from 'vite'
import { externalizeDepsPlugin } from 'electron-vite'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pageVimPlugin } from '../page-vim-build'
import { closeTestApplication } from './electron-fixture'

let fixtureDirectory: string
test.beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-workspace-build-'))
  await fs.writeFile(path.join(fixtureDirectory, 'package.json'), '{"type":"module"}')
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(fixtureDirectory, 'node_modules'))
  for (let directory of ['preload', 'renderer', 'native']) await fs.symlink(path.join(process.cwd(), 'out', directory), path.join(fixtureDirectory, directory))
  await build({ configFile: false, logLevel: 'error', plugins: [externalizeDepsPlugin(), pageVimPlugin()], build: { ssr: true, emptyOutDir: false, outDir: path.join(fixtureDirectory, 'main'), rollupOptions: { input: 'tests/fixtures/remote-workspace-main.ts', output: { format: 'es', entryFileNames: 'fixture.js' } } } })
})
test.afterAll(async () => { if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true }) })

test('remote workspace shares local layout, keeps client selection independent, and routes OS URLs to Local', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-workspace-test-'))
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Local research</title><style>body{background:#d8eac2}</style><h1>Local research</h1>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await fs.writeFile(path.join(directory, 'config.yaml'), 'browser:\n  autoUpdateFilters: false\n')
  let application = await electron.launch({ args: [path.join(fixtureDirectory, 'main/fixture.js')], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml') } })
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let local = await chrome.evaluate(async () => { let state = await (window as any).bmux.state(); return state.model.clients.find((client: { id: string }) => client.id === state.clientId) })
    let host = await application.evaluate((_electron, client) => { let fixture = (globalThis as any).workspaceFixture; return fixture.open(client).then(() => fixture.snapshot) }, local.id)
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let current = (value: any) => value.model.clients.find((client: { id: string }) => client.id === local.id)
    let projectedPane = `remote:${local.id}:pane:${host.selection.paneId}`
    await expect.poll(async () => current(await state()).paneId).toBe(projectedPane)
    await expect(chrome.locator('[data-window-list] [data-window-id]')).toHaveCount(2)
    await expect(chrome.locator('[data-window-list]')).toContainText('7')
    await expect(chrome.locator('[data-window-list]')).toContainText('9')
    await expect(chrome.locator('[data-pane-id]')).toHaveCount(3)
    await expect(chrome.getByRole('contentinfo', { name: 'Browser status' }).getByRole('group', { name: 'Remote session controls' })).toHaveCount(0)
    await expect(chrome.locator('[data-remote-address]')).toHaveCount(3)
    await expect.poll(() => application.evaluate(() => (globalThis as any).workspaceFixture.media.size)).toBe(2)
    let third = `remote:${local.id}:pane:${host.session.windows[0].panes[2].id}`
    await chrome.evaluate(pane => (window as any).bmux.command({ method: 'select-pane', args: { pane } }), third)
    await expect.poll(() => application.evaluate((_electron, pane) => [...(globalThis as any).workspaceFixture.media.values()].includes(pane), host.session.windows[0].panes[2].id)).toBe(true)
    for (let method of ['new-window', 'new-pane', 'split-window', 'duplicate-window', 'reopen-closed', 'kill-pane']) {
      let error = await chrome.evaluate(async method => { try { await (window as any).bmux.command({ method }); return '' } catch (error) { return String(error) } }, method)
      expect(error, method).toContain('unavailable in remote view')
    }
    let secondClient = await application.evaluate(async () => { let fixture = (globalThis as any).workspaceFixture, localSession = fixture.runtime.model.sessions.find((session: any) => !session.ephemeral); let second = await fixture.runtime.createClient(localSession.id); await fixture.open(second.id, fixture.snapshot.session.windows[1].panes[0].id); return second.id })
    expect(current(await state()).paneId).toBe(third)
    await application.evaluate(() => { let fixture = (globalThis as any).workspaceFixture; fixture.snapshot.session.windows[0].name = 'Renamed on host'; fixture.publish() })
    await expect(chrome.locator('[data-window-list]')).toContainText('Renamed on host')
    expect(current(await state()).paneId).toBe(third)
    await expect.poll(async () => Object.keys((await state()).remoteViews).filter(id => id.startsWith(`remote:${local.id}:pane:`)).length).toBe(5)
    await expect.poll(async () => Object.keys((await state()).remoteViews).filter(id => id.startsWith(`remote:${secondClient}:pane:`)).length).toBe(5)
    await info.attach('shared-remote-layout', { body: await chrome.screenshot(), contentType: 'image/png' })
    expect(await application.evaluate(() => (globalThis as any).workspaceFixture.snapshot.selection.paneId)).toBe(host.selection.paneId)
    await application.evaluate(async (_electron, client) => { let runtime = (globalThis as any).workspaceFixture.runtime; await runtime.execute({ method: 'detach-client', args: { client } }, client) }, secondClient)
    await chrome.getByRole('button', { name: 'Sessions', exact: true }).click()
    let picker = chrome.getByRole('dialog', { name: 'Sessions' })
    await picker.getByRole('tab', { name: 'Local', exact: true }).click()
    await expect(picker.locator('[data-session-tree]')).toHaveCount(1)
    await expect(picker.locator('[data-session-tree]')).not.toContainText('Hosted work')
    await chrome.keyboard.press('Escape')
    await application.evaluate(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), url)
    await expect.poll(async () => current(await state()).sessionId).toBe(local.sessionId)
    await expect.poll(() => application.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('heading')).toHaveText('Local research')
    await expect(chrome.locator('[data-remote-address]')).toHaveCount(0)
    expect((await state()).model.sessions.some((session: any) => session.ephemeral)).toBe(false)
    await expect.poll(() => application.evaluate(() => (globalThis as any).workspaceFixture.media.size)).toBe(0)
    // A typed URL must still display a visible native local page after the switch.
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${url}?typed=1`); await address.press('Enter')
    await expect.poll(() => page.url()).toBe(`${url}?typed=1`)
    await expect(page.getByRole('heading')).toBeVisible()
    await info.attach('local-after-remote', { body: await page.screenshot(), contentType: 'image/png' })
    await application.evaluate((_electron, client) => { let fixture = (globalThis as any).workspaceFixture; fixture.hold = true; (globalThis as any).pendingWorkspaceOpen = fixture.open(client).catch((error: Error) => error.message) }, local.id)
    await expect.poll(() => application.evaluate(() => (globalThis as any).workspaceFixture.held.length)).toBe(1)
    await application.evaluate(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), `${url}?during-connect=1`)
    await expect.poll(async () => current(await state()).sessionId).toBe(local.sessionId)
    await expect.poll(() => application.context().pages().some(page => page.url() === `${url}?during-connect=1`)).toBe(true)
    expect(await application.evaluate(() => (globalThis as any).pendingWorkspaceOpen)).toContain('closed')
    await application.evaluate(() => (globalThis as any).workspaceFixture.flush())
    expect(current(await state()).sessionId).toBe(local.sessionId)
  } finally { await closeTestApplication(application); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }) }
})
