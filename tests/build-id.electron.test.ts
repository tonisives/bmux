import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PublicState } from '../src/shared/types'

test('compact build information opens General settings without reducing native page space', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-build-id-'))
  let config = path.join(directory, 'config.yaml')
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Build fixture</title><style>body{background:#bbcde3;font:24px system-ui}</style><h1>Build fixture</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  let writeConfig = (showBuildId: boolean, statusBar = 'top') => fs.writeFile(config, `showBuildId: ${showBuildId}\nstatusBar: ${statusBar}\nkeyboard: {}\nbrowser:\n  autoUpdateFilters: false\n`)
  try {
    await writeConfig(false)
    let launchedAt = Date.now()
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown>) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = (): Promise<PublicState> => chrome.evaluate(() => (window as any).bmux.state())
    let initial = await state(), client = initial.model.clients.find(client => client.id === initial.clientId)!
    await chrome.evaluate(client => (window as any).bmux.command({ method: 'activate-client', args: { client } }), client.id)
    let build = initial.buildInfo!
    expect(build.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(build.revision).toMatch(/^(?:[a-f0-9]{8}(?:-dirty)?|dev)$/)
    expect(new Date(build.builtAt).toISOString()).toBe(build.builtAt)
    expect(Date.parse(build.builtAt)).toBeLessThanOrEqual(launchedAt)
    let label = chrome.getByRole('button', { name: 'Build information', exact: true })
    await expect(label).toHaveCount(0)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('heading')).toHaveText('Build fixture')
    let content = chrome.locator(`[data-content-pane-id="${client.paneId}"]`)
    let nativeBounds = () => application!.evaluate(({ BaseWindow }, url) => {
      let view = BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).find((view: any) => view.getVisible() && view.webContents?.getURL() === url)
      return view?.getBounds()
    }, url)
    let floating = await rpc('split-window', { pane: client.paneId, url: `${url}floating` })
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}floating`)).toBe(true)
    await rpc('break-pane', { pane: floating.id, floating: true, client: client.id })
    await rpc('select-pane', { pane: client.paneId, client: client.id })
    let panel = chrome.getByRole('dialog', { name: 'Settings', exact: true })
    for (let position of ['top', 'bottom']) {
      await writeConfig(false, position)
      await expect(label).toHaveCount(0)
      await expect.poll(async () => (await state()).statusBar).toBe(position)
      await expect.poll(async () => {
        let rect = await content.boundingBox(), height = await chrome.evaluate(() => innerHeight)
        return !!rect && Math.abs(rect.y + rect.height - (height - (position === 'bottom' ? 28 : 0))) <= 1
      }).toBe(true)
      let before = await content.boundingBox()
      await writeConfig(true, position)
      await expect(label).toHaveText(/^v\d+\.\d+\.\d+ · \d{6}\.\d{4}$/)
      await expect.poll(async () => {
        let bounds = await nativeBounds(), rect = await content.boundingBox(), badge = await label.boundingBox()
        let viewport = await chrome.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        return !!bounds && !!rect && !!badge && rect.height === before!.height && rect.y === before!.y && Math.abs(bounds.height - rect.height) <= 1 && Math.abs(viewport.width - badge.x - badge.width - 8) <= 1 && badge.width < 200 && (position === 'top' ? badge.y + badge.height <= 28 : badge.y >= viewport.height - 28)
      }).toBe(true)
      await rpc('float.bounds', { pane: floating.id, x: 100, y: 10000, width: 400, height: 300, commit: true })
      await expect.poll(async () => {
        let bounds = await application!.evaluate(({ BaseWindow }, pane) => BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).find((view: any) => view.getVisible() && view.webContents?.getURL().endsWith(`#float=${pane}`))?.getBounds(), floating.id)
        let height = await chrome.evaluate(() => innerHeight)
        return !!bounds && Math.abs(bounds.y + bounds.height - (height - (position === 'bottom' ? 28 : 0))) <= 1
      }).toBe(true)
      expect((await state()).configError).toBeNull()
      await fs.mkdir(info.outputDir, { recursive: true })
      await promisify(execFile)('/usr/sbin/screencapture', ['-x', info.outputPath(`build-id-${position}.png`)])
      await label.click()
      await expect(panel.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
      let search = panel.getByRole('textbox', { name: 'Search settings' })
      await expect(search).toHaveValue('')
      let details = panel.getByRole('region', { name: 'About bmux', exact: true })
      await expect(details).toBeVisible()
      await expect(details.locator('dd')).toHaveText([build.version, build.revision, build.builtAt])
      if (position === 'top') await promisify(execFile)('/usr/sbin/screencapture', ['-x', info.outputPath('build-info-general.png')])
      await search.fill('version')
      await expect(panel.getByRole('group', { name: 'Settings search results' }).getByRole('region', { name: 'About bmux' })).toBeVisible()
      await panel.getByRole('tab', { name: 'Appearance' }).click()
      await search.fill('idle')
      await panel.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(panel).toHaveCount(0)
    }
    await writeConfig(false)
    await expect(label).toHaveCount(0)
    expect((await state()).buildInfo).toEqual(build)
    await expect.poll(async () => {
      let bounds = await nativeBounds(), rect = (await content.boundingBox())!
      return !!bounds && Math.abs(bounds.height - rect.height) <= 1 && Math.abs(bounds.y + bounds.height - await chrome.evaluate(() => innerHeight)) <= 1
    }).toBe(true)
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
