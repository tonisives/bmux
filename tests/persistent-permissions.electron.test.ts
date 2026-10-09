import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { initialModel } from '../src/main/model'
import { closeTestApplication } from './electron-fixture'

for (let savedConnection of [false, true]) for (let allowed of [true, false]) test(`persistent-storage ${allowed ? 'approval' : 'denial'} survives reload and restart with ${savedConnection ? 'a saved' : 'the original'} connection`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-storage-permission-'))
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Storage permission fixture</title><h1>Storage permission fixture</h1>')
  })
  let application: ElectronApplication | undefined, chrome: Page
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, target = `${origin}/storage`
    let model = initialModel(), profile = model.profiles[0], pane = model.sessions[0].windows[0].panes[0]
    if (savedConnection) {
      profile.connections = [{ id: profile.id }, { id: 'profile_saved_connection' }]
      profile.connectionId = 'profile_saved_connection'; pane.connectionId = profile.connectionId
    }
    await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(model))
    await fs.writeFile(path.join(directory, 'config.yaml'), 'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
    let launch = async () => {
      application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
      await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
      chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    }
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let website = async () => {
      await expect.poll(() => application!.context().pages().some(page => page.url() === target)).toBe(true)
      let page = application!.context().pages().find(page => page.url() === target)!
      await expect(page.getByRole('heading')).toHaveText('Storage permission fixture')
      await page.waitForLoadState('load')
      return page
    }
    await launch()
    await chrome!.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome!.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(target); await address.press('Enter')
    let page = await website()
    expect(await page.evaluate(() => navigator.storage.persisted())).toBe(false)
    await page.evaluate(() => { navigator.storage.persist().then(value => { (window as any).storageResult = value }) })
    let notice = chrome!.getByLabel('Notifications').getByRole('status').filter({ hasText: 'requests persistent-storage' })
    await expect(notice).toContainText('This pane')
    await expect(notice.getByRole('button', { name: 'Go to pane', exact: true })).toHaveCount(0)
    await notice.getByRole('button', { name: allowed ? 'Allow' : 'Deny', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).storageResult)).toBe(allowed)
    await expect(notice).toHaveCount(0)
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'permissions.json'), 'utf8'))).toContainEqual([`${profile.id}|${origin}|persistent-storage`, allowed])
    for (let restarted of [false, true]) {
      if (restarted) {
        await closeTestApplication(application); application = undefined
        await launch()
      } else await rpc('reload', { pane: pane.id })
      page = await website()
      expect(await page.evaluate(() => navigator.storage.persisted())).toBe(allowed)
      expect(await page.evaluate(() => navigator.storage.persist())).toBe(allowed)
      expect(await rpc('permission.list')).toEqual([])
    }
    let current = await chrome!.evaluate(() => (window as any).bmux.state())
    let privateSession = await rpc('new-session', { name: 'private storage', profile: profile.id, private: true, client: current.clientId }) as any
    let privatePane = privateSession.windows[0].panes[0]
    await rpc('navigate', { pane: privatePane.id, url: `${origin}/private-storage` })
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/private-storage`)).toBe(true)
    let privatePage = application!.context().pages().find(page => page.url() === `${origin}/private-storage`)!
    await expect(privatePage.getByRole('heading')).toHaveText('Storage permission fixture')
    expect(await privatePage.evaluate(() => navigator.storage.persisted())).toBe(false)
    await privatePage.evaluate(() => { navigator.storage.persist().then(value => { (window as any).storageResult = value }) })
    await expect(notice).toBeVisible()
    await notice.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect.poll(() => privatePage.evaluate(() => (window as any).storageResult)).toBe(true)
    expect(await privatePage.evaluate(() => navigator.storage.persisted())).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(directory, 'permissions.json'), 'utf8'))).toEqual([[`${profile.id}|${origin}|persistent-storage`, allowed]])
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
