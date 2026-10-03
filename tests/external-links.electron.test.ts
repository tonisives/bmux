import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { stringify } from 'yaml'

for (let protection of ['cooldown', 'warning', 'lease', 'unused']) test(`external links remain manual during automation ${protection}`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-external-links-'))
  let video = await fs.readFile(path.resolve('tests/fixtures/local-media.mp4'))
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length })
    response.end(video)
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/external.mp4`
    let file = path.join(directory, 'external file.html')
    await fs.writeFile(file, '<!doctype html><title>External file</title><main>External file</main>')
    let startedAt = Date.now() - 11 * 60_000
    let ledger = protection === 'cooldown' || protection === 'warning' ? { profile_default: { startedAt, lastUsed: startedAt + 1000, ...(protection === 'warning' ? { warning: 'account-warning', warningHost: '127.0.0.1' } : {}) } } : {}
    let ledgerFile = path.join(directory, 'automation-safety.json')
    await fs.writeFile(ledgerFile, JSON.stringify(ledger))
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ browser: { adblock: false, autoUpdateFilters: false }, automation: { groups: protection === 'lease' ? { fixture: { profiles: ['profile_default'], hosts: ['127.0.0.1'], maxConcurrent: 1, hourly: { runs: 1 }, requiredPlugins: { '127.0.0.1': 'test' } } } : {} } }))
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    expect(state.configError).toBeNull()
    let client = state.model.clients.find((item: { id: string }) => item.id === state.clientId)
    let session = state.model.sessions.find((item: { id: string }) => item.id === client.sessionId)
    let original = session.windows[0]
    let cli = async () => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', 'new-window', JSON.stringify({ session: session.id, client: client.id, url })], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
        if (error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    let expectedError = protection === 'lease' ? 'acquire an automation lease' : protection === 'warning' ? 'Automation paused' : 'Automation session limit reached'
    if (protection !== 'unused') expect(await cli()).toMatchObject({ ok: false, error: expect.stringContaining(expectedError) })
    for (let route of ['open-url', 'second-instance-argv', 'second-instance-links', 'open-file']) {
      let before = await command('list-windows', { session: session.id })
      await application.evaluate(({ app }, { route, url, file }) => {
        if (route === 'open-url') app.emit('open-url', { preventDefault() {} }, url)
        else if (route === 'open-file') app.emit('open-file', { preventDefault() {} }, file)
        else app.emit('second-instance', {}, route === 'second-instance-argv' ? ['bmux', url] : ['bmux'], '', route === 'second-instance-links' ? { links: [{ url, allowFile: false }] } : {})
      }, { route, url, file })
      await expect.poll(async () => (await command('list-windows', { session: session.id })).length).toBe(before.length + 1)
      let after = await command('list-windows', { session: session.id })
      let created = after.find((window: { id: string }) => !before.some((item: { id: string }) => item.id === window.id))
      let target = route === 'open-file' ? pathToFileURL(file).href : url
      expect(created.panes[0].url).toBe(target)
      expect((await command('list-clients')).find((item: { id: string }) => item.id === client.id).windowId).toBe(created.id)
      expect(after.find((window: { id: string }) => window.id === original.id)).toEqual(original)
      await command('wait', { tab: created.panes[0].id, selector: route === 'open-file' ? 'main' : 'video' })
      if (route !== 'open-file') await expect.poll(() => command('eval', { tab: created.panes[0].id, expression: 'document.querySelector("video")?.videoWidth' })).toBe(32)
      expect(JSON.parse(await fs.readFile(ledgerFile, 'utf8'))).toEqual(ledger)
      if (protection !== 'unused') expect(await cli()).toMatchObject({ ok: false, error: expect.stringContaining(expectedError) })
    }
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
