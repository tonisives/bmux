import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'

for (let action of ['alert', 'settings', 'expiry']) test(`session-limit alert supports ${action} without allowing a CLI reset`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-session-limit-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Session limit fixture</title><main>Visible session limit fixture</main>')
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://one.example.com:${(server.address() as any).port}/fixture`
    let startedAt = Date.now() - (action === 'expiry' ? 30 * 60_000 - 15_000 : 11 * 60_000)
    await fs.writeFile(path.join(directory, 'automation-safety.json'), JSON.stringify({ profile_default: { startedAt, lastUsed: startedAt + 1000 } }))
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false } }))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${new URL(url).origin}`], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let client = state.model.clients.find((item: { id: string }) => item.id === state.clientId)
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
        if (error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    await expect(chrome.getByLabel('Notifications').getByRole('status')).toHaveCount(0)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.pressSequentially(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('main')).toHaveText('Visible session limit fixture')
    let alert = chrome.getByLabel('Notifications').getByRole('status').filter({ hasText: 'Automation session limit reached for default' })
    await expect(alert).toBeVisible()
    let timer = alert.getByRole('timer')
    await expect(timer).toBeVisible()
    await expect(timer).toContainText('Reset ')
    await expect(timer).toHaveAttribute('title', /Automation resumes at .*remaining in the 20-minute break/)
    await expect(timer.locator('svg circle')).toHaveCount(2)
    let bounds = await timer.boundingBox()
    let row = await alert.boundingBox()
    expect(bounds!.height).toBeLessThanOrEqual(26)
    expect(row!.height).toBeLessThanOrEqual(40)
    expect(Math.abs(bounds!.y + bounds!.height / 2 - row!.y - row!.height / 2)).toBeLessThanOrEqual(1)
    let countdown = await timer.locator('span').textContent()
    await expect.poll(() => timer.locator('span').textContent()).not.toBe(countdown)
    await expect(alert).not.toContainText('Retry at')
    await expect(alert).not.toContainText('Manual browsing is unaffected')
    await expect(alert.getByRole('button', { name: 'Anti-bot settings' }).locator('svg')).toBeVisible()
    await expect(alert.getByRole('combobox')).toHaveCount(1)
    if (action === 'expiry') {
      await alert.getByRole('button', { name: 'Anti-bot settings' }).click()
      let antiBot = chrome.getByRole('tabpanel', { name: 'Anti-bot settings' })
      await expect(antiBot).toContainText('Break ends at')
      await expect(alert).toHaveCount(0, { timeout: 20000 })
      await expect(antiBot.getByRole('region', { name: 'Paused automation' })).toHaveCount(0)
      await expect(antiBot.getByRole('button', { name: 'Reset session' })).toHaveCount(0)
      return
    }
    let host = 'one.example.com'
    await expect(alert.getByRole('combobox', { name: `Disable anti-bot for ${host}` })).toBeVisible()
    await expect(alert.locator('label')).toContainText(host)
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    await chrome.screenshot({ path: path.resolve(`artifacts/session-limit-${action}.png`) })
    expect(await cli(['dom', '-t', client.paneId])).toMatchObject({ ok: false, error: expect.stringContaining('Profile > Anti-bot') })
    expect(await cli(['rpc', 'automation.reset-session', JSON.stringify({ profile: 'profile_default' })])).toMatchObject({ ok: false, error: expect.stringContaining('bmux UI') })
    if (action === 'alert') {
      let otherUrl = url.replace('one.example.com', 'two.example.com')
      let otherPane = await chrome.evaluate(args => (window as any).bmux.command({ method: 'split-window', args }), { pane: client.paneId, client: state.clientId, url: otherUrl })
      await expect.poll(() => application!.context().pages().some(page => page.url() === otherUrl)).toBe(true)
      expect((await cli(['dom', '-t', otherPane.id])).ok).toBe(false)
      await expect(alert).toHaveCount(2)
      let firstRow = alert.filter({ has: chrome.getByRole('combobox', { name: 'Disable anti-bot for one.example.com', exact: true }) })
      let secondRow = alert.filter({ has: chrome.getByRole('combobox', { name: 'Disable anti-bot for two.example.com', exact: true }) })
      await expect(firstRow).toBeVisible()
      await expect(secondRow).toBeVisible()
      let firstBounds = await firstRow.boundingBox(), secondBounds = await secondRow.boundingBox()
      expect(Math.abs(firstBounds!.x - secondBounds!.x)).toBeLessThanOrEqual(1)
      expect(secondBounds!.y).toBeGreaterThanOrEqual(firstBounds!.y + firstBounds!.height)
      await fs.mkdir(path.resolve('artifacts'), { recursive: true })
      await chrome.screenshot({ path: path.resolve('artifacts/session-limit-stack.png') })
      await firstRow.getByRole('button', { name: 'Reset session' }).click()
    }
    else {
      await alert.getByRole('button', { name: 'Dismiss notification' }).click()
      await expect(alert).toHaveCount(0)
      expect((await cli(['dom', '-t', client.paneId])).ok).toBe(false)
      await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
      let antiBot = chrome.getByRole('tabpanel', { name: 'Anti-bot settings' })
      await expect(antiBot).toContainText('Break ends at')
      let exclusions = antiBot.getByRole('region', { name: 'Excluded websites' })
      await exclusions.getByRole('textbox', { name: 'Website', exact: true }).fill(host)
      await exclusions.getByRole('button', { name: 'Add', exact: true }).click()
      await expect.poll(async () => (await cli(['automation', 'safety'])).result.limits.sites?.profile_default?.[host]).toEqual({ enabled: true, durationMinutes: null, expiresAt: null })
      expect((await cli(['dom', '-t', client.paneId])).ok).toBe(true)
      await exclusions.getByRole('button', { name: `Remove exclusion for ${host}` }).click()
      expect((await cli(['dom', '-t', client.paneId])).ok).toBe(false)
      let sessionLimit = antiBot.getByRole('spinbutton', { name: 'Session limit (minutes)' })
      await sessionLimit.fill('20'); await sessionLimit.press('Enter')
      await expect(antiBot.getByRole('region', { name: 'Paused automation' })).toHaveCount(0)
      expect((await cli(['dom', '-t', client.paneId])).ok).toBe(true)
      await sessionLimit.fill('10'); await sessionLimit.press('Enter')
      await expect(antiBot).toContainText('Break ends at')
      expect((await cli(['dom', '-t', client.paneId])).ok).toBe(false)
      await antiBot.getByRole('button', { name: 'Reset session' }).click()
      await expect(antiBot.getByRole('region', { name: 'Paused automation' })).toHaveCount(0)
      await expect(exclusions.getByRole('group', { name: host, exact: true })).toHaveCount(0)
      await chrome.getByRole('dialog', { name: 'Profile', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    }
    await expect(alert).toHaveCount(0)
    expect((await cli(['dom', '-t', client.paneId])).ok).toBe(true)
    let usage = (await cli(['automation', 'safety'])).result.profiles.find((item: { profileId: string }) => item.profileId === 'profile_default')
    expect(usage.retryAfter).toBeNull()
    expect(usage.startedAt).toBeGreaterThan(startedAt)
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('automation and permission notices identify agent panes while personal browsing stays available', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-agent-notice-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Agent notice fixture</title><main>Manual browsing</main>')
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://one.example.com:${(server.address() as any).port}/fixture`
    let startedAt = Date.now() - 11 * 60_000
    await fs.writeFile(path.join(directory, 'automation-safety.json'), JSON.stringify({ profile_default: { startedAt, lastUsed: startedAt + 1000 } }))
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false } }))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${new URL(url).origin}`], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let personal = state.model.clients.find((item: { id: string }) => item.id === state.clientId)
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
        if (error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    let agents = await command('new-session', { name: 'agents', profile: 'default' })
    let first = (await cli(['new-window', '-t', agents.id, '-n', 'research', '--agent-id', '%45'])).result.panes[0]
    let second = (await cli(['new-window', '-t', agents.id, '-n', 'review', '--agent-id', '%46'])).result.panes[0]
    expect(first.agentId).toBe('%45')
    for (let pane of [first, second]) {
      await command('navigate', { pane: pane.id, url: `${url}?agent=${pane.id}` })
      expect((await cli(['dom', '-t', pane.id])).ok).toBe(false)
    }
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.pressSequentially(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    await expect(application.context().pages().find(page => page.url() === url)!.getByRole('main')).toHaveText('Manual browsing')
    let alert = chrome.getByLabel('Notifications').getByRole('status').filter({ hasText: 'Automation session limit reached' })
    await expect(alert).not.toContainText('Manual browsing is unaffected')
    await expect(alert.getByRole('combobox')).toHaveCount(1)
    await expect(alert.getByRole('button', { name: `Go to pane agents:2 · ${first.id} (%45)`, exact: true })).toBeVisible()
    await expect(alert.getByRole('button', { name: `Go to pane agents:3 · ${second.id} (%46)`, exact: true })).toBeVisible()
    await expect(alert).not.toContainText(personal.paneId)
    let usage = (await cli(['automation', 'safety'])).result.profiles[0]
    expect(usage).toMatchObject({ startedAt, lastUsed: startedAt + 1000 })
    expect(usage.actors.map((actor: { paneId: string }) => actor.paneId)).toEqual([first.id, second.id])
    await command('navigate', { pane: first.id, url: `${url}?requester` })
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}?requester`)).toBe(true)
    let requester = application.context().pages().find(page => page.url() === `${url}?requester`)!
    await requester.evaluate(() => { Notification.requestPermission().then(value => { (window as any).permissionResult = value }) })
    let permission = chrome.getByLabel('Notifications').getByRole('status').filter({ hasText: 'requests notifications' })
    await expect(permission).toContainText(`agents:2 · ${first.id}`)
    expect(await permission.getAttribute('class')).toBe(await alert.getAttribute('class'))
    await permission.getByRole('button', { name: 'Go to pane', exact: true }).click()
    await expect.poll(async () => (await command('list-clients')).find((item: { id: string }) => item.id === personal.id).paneId).toBe(first.id)
    await expect(permission.getByRole('button', { name: 'Go to pane', exact: true })).toHaveCount(0)
    await expect(alert.getByRole('button', { name: `Go to pane agents:2 · ${first.id} (%45)`, exact: true })).toHaveCount(0)
    await expect(alert.getByRole('button', { name: `Go to pane agents:3 · ${second.id} (%46)`, exact: true })).toBeVisible()
    expect(await requester.evaluate(() => (window as any).permissionResult)).toBeUndefined()
    await permission.getByRole('button', { name: 'Deny', exact: true }).click()
    await expect(permission).toHaveCount(0)
    await alert.getByRole('button', { name: 'Anti-bot settings', exact: true }).click()
    let antiBot = chrome.getByRole('tabpanel', { name: 'Anti-bot settings' })
    await expect(antiBot).toContainText('Agent %45')
    let toggle = antiBot.getByRole('switch', { name: 'Enable Anti-bot for this pane', exact: true })
    await toggle.uncheck()
    await expect.poll(async () => (await cli(['dom', '-t', first.id])).ok).toBe(true)
    expect((await cli(['dom', '-t', second.id])).ok).toBe(false)
    await expect(alert).not.toContainText('(%45)')
    expect((await cli(['rpc', 'pane.anti-bot.set', JSON.stringify({ pane: second.id, enabled: false })])).ok).toBe(false)
    await toggle.check()
    await expect.poll(async () => (await cli(['dom', '-t', first.id])).ok).toBe(false)
    await chrome.getByRole('dialog', { name: 'Profile', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await alert.getByRole('button', { name: `Go to pane agents:3 · ${second.id} (%46)`, exact: true }).click()
    await expect.poll(async () => (await command('list-clients')).find((item: { id: string }) => item.id === personal.id).paneId).toBe(second.id)
    await expect(alert.getByRole('button', { name: `Go to pane agents:3 · ${second.id} (%46)`, exact: true })).toHaveCount(0)
    await expect(alert.getByRole('button', { name: `Go to pane agents:2 · ${first.id} (%45)`, exact: true })).toBeVisible()
    await alert.getByRole('button', { name: 'Anti-bot settings', exact: true }).click()
    await expect(antiBot).toContainText('Agent %46')
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    await chrome.screenshot({ path: path.resolve('artifacts/automation-agent-notice.png') })
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('default anti-bot protection blocks warnings across CLI and plugins, with a persistent profile toggle', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-safety-ui-'))
  let server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(request.url === '/warning' ? '<!doctype html><title>Account warning</title><div role="dialog">We suspect automated behavior on your account.</div><button id="continue">Continue</button>' : '<!doctype html><title>Safe fixture</title><main>Visible fixture page</main>')
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let base = `http://one.example.com:${(server.address() as any).port}`
    let folder = path.join(directory, 'plugins', 'test')
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Safety fixture', version: '1', actions: [{ id: 'browse', title: 'Browse', command: ['node', './run.mjs'], capabilities: ['browser.read'] }] }))
    await fs.writeFile(path.join(folder, 'run.mjs'), `import { execFileSync } from 'node:child_process'; try { execFileSync(process.env.BMUX_CLI, ['plugin','host','dom'], {stdio:'pipe'}) } catch {} process.exit(0)`)
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false }, plugins: { test: { enabled: true, hooks: false } }, automation: { safety: { sites: { profile_default: {
      'temporary.example.com': { enabled: true, durationMinutes: 60, expiresAt: Date.now() + 60 * 60_000 },
      'expired.example.com': { enabled: true, durationMinutes: 15, expiresAt: Date.now() - 1000 },
    } } } } }))
    let launch = async () => {
      application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
      await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
      return application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    }
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    let chrome = await launch()
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state()), pane = state.model.sessions[0].windows[0].panes[0]
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
        if (error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    let navigate = async (url: string) => {
      await chrome.getByRole('button', { name: 'Address', exact: true }).click()
      let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
      await address.fill(url); await address.press('Enter')
      await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    }
    expect((await cli(['cdp', '-t', pane.id, 'Runtime.evaluate', '{"expression":"1","returnByValue":true}'])).ok).toBe(true)
    expect((await cli(['automation', 'safety'])).result.profiles).toEqual([])
    await navigate(`${base}/safe`)
    expect((await cli(['cdp', '-t', pane.id, 'Runtime.evaluate', '{"expression":"1","returnByValue":true}'])).ok).toBe(true)
    expect((await cli(['automation', 'safety'])).result.profiles[0].profileId).toBe(pane.profileId)
    // Navigation returns before load completes; the next input must inspect the
    // loaded document and catch its warning before dispatching the click.
    expect((await cli(['navigate', '-t', pane.id, `${base}/warning`])).ok).toBe(true)
    expect((await cli(['click', '-t', pane.id, '--selector', '#continue']))).toMatchObject({ ok: false, error: expect.stringContaining('Automation paused') })
    expect((await cli(['cdp', '-t', pane.id, 'Runtime.evaluate', '{"expression":"1"}'])).ok).toBe(false)
    expect((await cli(['reload', '-t', pane.id]))).toMatchObject({ ok: false, error: expect.stringContaining('Automation paused') })
    expect((await cli(['automation', 'resume', '-t', pane.id])).ok).toBe(false)
    expect((await cli(['profile', 'anti-bot.set', '--profile', pane.profileId, '--enabled', 'false'])).ok).toBe(false)
    let alert = chrome.getByLabel('Notifications').getByRole('status').filter({ hasText: 'Automation paused for default' })
    await expect(alert).toContainText('one.example.com')
    await expect(alert).not.toContainText('Manual browsing is unaffected')
    await expect(alert.getByRole('button', { name: 'Anti-bot settings' }).locator('svg')).toBeVisible()
    let siteMenu = alert.getByRole('combobox', { name: 'Disable anti-bot for one.example.com', exact: true })
    await expect(alert.locator('label')).toContainText('one.example.com')
    for (let durationMinutes of [15, 60]) {
      await siteMenu.selectOption(String(durationMinutes))
      await expect(alert).toHaveCount(0)
      expect((await cli(['dom', '-t', pane.id])).ok).toBe(true)
      let exclusion = (await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['one.example.com']
      expect(exclusion).toMatchObject({ enabled: true, durationMinutes })
      expect(exclusion.expiresAt).toBeGreaterThan(Date.now() + (durationMinutes - 1) * 60_000)
      await command('profile.anti-bot.site.remove', { profile: pane.profileId, host: 'one.example.com' })
      await expect(alert).toBeVisible()
    }
    await siteMenu.selectOption('permanent')
    await expect(alert).toHaveCount(0)
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(true)
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['one.example.com']).toEqual({ enabled: true, durationMinutes: null, expiresAt: null })
    expect((await cli(['rpc', 'profile.anti-bot.site.set', JSON.stringify({ profile: pane.profileId, host: 'one.example.com', enabled: false })])).ok).toBe(false)
    await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
    let panel = chrome.getByRole('dialog', { name: 'Profile' })
    await panel.getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    let antiBot = panel.getByRole('tabpanel', { name: 'Anti-bot settings' }), toggle = antiBot.getByRole('switch', { name: 'Enable Anti-bot for this profile', exact: true })
    await expect(toggle).toBeChecked()
    let exclusions = antiBot.getByRole('region', { name: 'Excluded websites' })
    let excludedHost = () => exclusions.getByRole('group', { name: 'one.example.com', exact: true })
    let addSite = async (host: string) => {
      await exclusions.getByRole('textbox', { name: 'Website', exact: true }).fill(host)
      await exclusions.getByRole('button', { name: 'Add', exact: true }).click()
    }
    let removeSite = async (host: string) => {
      await exclusions.getByRole('button', { name: `Remove exclusion for ${host}` }).click()
      await expect(exclusions.getByRole('group', { name: host, exact: true })).toHaveCount(0)
    }
    await expect(excludedHost()).toBeVisible()
    await expect(antiBot.getByRole('combobox')).toHaveCount(0)
    let limitsBounds = (await antiBot.getByRole('region', { name: 'Limits', exact: true }).boundingBox())!
    expect(limitsBounds.width).toBeGreaterThan(560)
    expect(await antiBot.getByRole('switch', { name: 'Enable Anti-bot for this profile', exact: true }).evaluate(element => element.closest('label')!.getBoundingClientRect().width)).toBeLessThanOrEqual(560)
    await expect(antiBot.getByRole('heading')).toHaveText(['Enable Anti-bot', 'Limits', 'Excluded websites'])
    await expect(antiBot).not.toContainText('Enter or leave')
    await expect(antiBot).not.toContainText('all profiles')
    await expect(panel.locator('[data-profile-tab-icon]')).toHaveCount(5)
    let temporary = exclusions.getByRole('group', { name: 'temporary.example.com', exact: true })
    await expect(temporary).toContainText('Temporary · Until')
    await temporary.getByRole('button', { name: 'Keep temporary.example.com excluded' }).click()
    await expect(temporary).not.toContainText('Temporary')
    let expired = exclusions.getByRole('group', { name: 'expired.example.com', exact: true })
    await expect(expired).toContainText('Expired · Anti-bot is on')
    await expired.getByRole('button', { name: 'Keep expired.example.com excluded' }).click()
    await expect(expired).not.toContainText('Expired')
    let savedSites = (await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]
    for (let host of ['temporary.example.com', 'expired.example.com']) expect(savedSites[host]).toEqual({ enabled: true, durationMinutes: null, expiresAt: null })
    await removeSite('one.example.com')
    await expect(alert).toBeVisible()
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(false)
    await alert.getByRole('button', { name: 'Dismiss notification' }).click()
    await expect(alert).toHaveCount(0)
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(false)
    await addSite('one.example.com')
    await expect(excludedHost()).toBeVisible()
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(true)
    await removeSite('one.example.com')
    await expect(alert).toBeVisible()
    await command('profile.anti-bot.site.set', { profile: pane.profileId, host: 'one.example.com', enabled: false, durationMinutes: 60 })
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['one.example.com'].durationMinutes).toBe(60)
    let config = parse(await fs.readFile(path.join(directory, 'config.yaml'), 'utf8'))
    config.automation.safety.sites[pane.profileId]['one.example.com'].expiresAt = Date.now() + 3000
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify(config))
    await expect(excludedHost()).toContainText('Expired', { timeout: 10000 })
    await expect(alert).toBeVisible()
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(false)
    await excludedHost().getByRole('button', { name: 'Keep one.example.com excluded' }).click()
    await expect(excludedHost()).not.toContainText('Temporary')
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['one.example.com']).toEqual({ enabled: true, durationMinutes: null, expiresAt: null })
    await removeSite('one.example.com')
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['one.example.com']).toBeUndefined()
    expect((await cli(['rpc', 'profile.anti-bot.site.remove', JSON.stringify({ profile: pane.profileId, host: 'one.example.com' })])).ok).toBe(false)
    await expect(antiBot.getByRole('region', { name: 'Paused automation' })).toContainText('Account warning on one.example.com')
    await expect(antiBot.getByRole('heading')).toHaveText(['Paused automation', 'Enable Anti-bot', 'Limits', 'Excluded websites'])
    let pauseSection = antiBot.getByRole('region', { name: 'Paused automation' }), enableSection = antiBot.getByRole('region', { name: 'Enable Anti-bot' })
    await pauseSection.scrollIntoViewIfNeeded()
    let pauseBounds = (await pauseSection.boundingBox())!, enableBounds = (await enableSection.boundingBox())!
    expect(enableBounds.y).toBeGreaterThanOrEqual(pauseBounds.y + pauseBounds.height)
    await expect(enableSection).toContainText('On')
    await chrome.screenshot({ path: path.resolve('artifacts/anti-bot-profile.png') })
    await exclusions.scrollIntoViewIfNeeded()
    await chrome.screenshot({ path: path.resolve('artifacts/anti-bot-sites.png') })
    let sessionLimit = antiBot.getByRole('spinbutton', { name: 'Session limit (minutes)' }), breakLength = antiBot.getByRole('spinbutton', { name: 'Break (minutes)' }), delay = antiBot.getByRole('spinbutton', { name: 'Social site delay (seconds)' })
    await expect(sessionLimit).toHaveValue('10')
    await expect(breakLength).toHaveValue('20')
    await expect(delay).toHaveValue('2')
    expect((await cli(['rpc', 'automation.safety.set', JSON.stringify({ profile: pane.profileId, key: 'maxSessionMinutes', value: 20 })])).ok).toBe(false)
    await expect(command('automation.safety.set', { profile: pane.profileId, key: 'maxSessionMinutes', value: 0 })).rejects.toThrow('Invalid automation.safety.maxSessionMinutes')
    await expect(command('automation.safety.set', { profile: pane.profileId, key: 'enabled', value: false })).rejects.toThrow('Choose a session')
    await sessionLimit.fill('20'); await sessionLimit.press('Enter')
    await expect.poll(async () => (await cli(['automation', 'safety'])).result.limits.profileLimits[pane.profileId].maxSessionMinutes).toBe(20)
    await breakLength.fill('5'); await delay.click()
    await expect.poll(async () => (await cli(['automation', 'safety'])).result.limits.profileLimits[pane.profileId].cooldownMinutes).toBe(5)
    await delay.fill('1.25'); await delay.press('Enter')
    await expect.poll(async () => (await cli(['automation', 'safety'])).result.limits.profileLimits[pane.profileId].socialDelayMs).toBe(1250)
    expect((await cli(['automation', 'safety'])).result.limits).toMatchObject({ maxSessionMinutes: 10, cooldownMinutes: 20, socialDelayMs: 2000 })
    await chrome.screenshot({ path: path.resolve('artifacts/anti-bot-limits.png') })
    await toggle.uncheck()
    await expect(enableSection).toContainText('Off')
    await expect.poll(async () => (await cli(['dom', '-t', pane.id])).ok).toBe(true)
    expect((await cli(['automation', 'safety'])).result.limits.profiles[pane.profileId]).toBe(false)
    await toggle.check()
    await expect.poll(async () => (await cli(['dom', '-t', pane.id])).ok).toBe(false)
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await navigate(`${base}/safe`)
    let run = await command('plugin.run', { action: 'test/browse', pane: pane.id })
    await expect.poll(async () => (await command('plugin.runs') as any[]).find(item => item.id === run.id)?.status).toBe('failed')
    expect((await command('plugin.runs') as any[]).find(item => item.id === run.id)?.error).toContain('Automation paused')
    await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
    await panel.getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    await antiBot.getByRole('button', { name: 'Resume automation' }).click()
    await expect.poll(async () => (await cli(['dom', '-t', pane.id])).ok).toBe(true)
    await expect(antiBot.getByRole('region', { name: 'Paused automation' })).toHaveCount(0)
    expect((await cli(['rpc', 'activate-client', JSON.stringify({ client: state.clientId })])).ok).toBe(true)
    await expect(toggle).toBeEnabled()
    await toggle.uncheck()
    await expect.poll(async () => (await cli(['automation', 'safety'])).result.limits.profiles[pane.profileId]).toBe(false)
    await addSite('one.example.com')
    let savedExclusion = (await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['one.example.com']
    // The same website and numeric fields in another profile keep independent settings.
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    let otherProfile = state.model.profiles.find((item: { id: string }) => item.id !== pane.profileId)!
    let otherPane = await command('split-window', { pane: pane.id, client: state.clientId, profile: otherProfile.id, url: `${base}/warning` })
    await command('select-pane', { client: state.clientId, pane: otherPane.id })
    await chrome.locator(`[data-pane-id="${otherPane.id}"]`).getByRole('button', { name: `Profile: ${otherProfile.name}`, exact: true }).click()
    await panel.getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    await expect(sessionLimit).toHaveValue('10')
    await expect(breakLength).toHaveValue('20')
    await expect(delay).toHaveValue('2')
    await expect(excludedHost()).toHaveCount(0)
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${base}/warning`)).toBe(true)
    await expect(application!.context().pages().find(page => page.url() === `${base}/warning`)!.getByRole('dialog')).toContainText('We suspect automated behavior')
    expect(await cli(['dom', '-t', otherPane.id])).toMatchObject({ ok: false, error: expect.stringContaining('Automation paused') })
    await sessionLimit.fill('7'); await sessionLimit.press('Enter')
    await expect.poll(async () => (await cli(['automation', 'safety'])).result.limits.profileLimits[otherProfile.id].maxSessionMinutes).toBe(7)
    expect((await cli(['automation', 'safety'])).result.limits.profileLimits[pane.profileId].maxSessionMinutes).toBe(20)
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await command('select-pane', { client: state.clientId, pane: pane.id })
    await closeTestApplication(application); application = undefined
    chrome = await launch()
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['one.example.com']).toEqual(savedExclusion)
    expect((await cli(['automation', 'safety'])).result.limits.profiles[pane.profileId]).toBe(false)
    await chrome.locator(`[data-pane-id="${pane.id}"]`).getByRole('button', { name: 'Profile: default', exact: true }).click()
    await chrome.getByRole('dialog', { name: 'Profile' }).getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    await expect(chrome.getByRole('switch', { name: 'Enable Anti-bot for this profile', exact: true })).not.toBeChecked()
    await expect(chrome.getByRole('tabpanel', { name: 'Anti-bot settings' }).getByRole('combobox')).toHaveCount(0)
    for (let host of ['one.example.com', 'temporary.example.com', 'expired.example.com']) await expect(chrome.getByRole('group', { name: host, exact: true })).toBeVisible()
    await expect(chrome.getByRole('spinbutton', { name: 'Session limit (minutes)' })).toHaveValue('20')
    await expect(chrome.getByRole('spinbutton', { name: 'Break (minutes)' })).toHaveValue('5')
    await expect(chrome.getByRole('spinbutton', { name: 'Social site delay (seconds)' })).toHaveValue('1.25')
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})


test('files and local sites bypass paused website automation and never show anti-bot alerts', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-local-safety-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Local review</title><main>Local review</main><h1>Verify that you are human</h1>')
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let port = (server.address() as any).port
    let file = path.join(directory, 'review.html')
    await fs.writeFile(file, '<!doctype html><title>Local review</title><main>Local review</main><h1>Verify that you are human</h1>')
    let startedAt = Date.now() - 11 * 60_000
    let ledger = { profile_default: { startedAt, lastUsed: startedAt + 1000, warning: 'account-warning', warningHost: 'one.example.com' } }
    let ledgerFile = path.join(directory, 'automation-safety.json')
    await fs.writeFile(ledgerFile, JSON.stringify(ledger))
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false } }))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let client = state.model.clients.find((item: { id: string }) => item.id === state.clientId)
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
        if (error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    let alerts = chrome.getByLabel('Notifications').getByRole('status').filter({ hasText: /Automation paused|Automation session limit/ })
    await expect(alerts).toHaveCount(0)
    for (let url of [pathToFileURL(file).href, `http://127.0.0.1:${port}/`, `http://localhost:${port}/`]) {
      let publicUrl = `http://one.example.com:${port}/`
      await command('navigate', { pane: client.paneId, url: publicUrl })
      expect(await cli(['dom', '-t', client.paneId])).toMatchObject({ ok: false, error: expect.stringContaining('Automation paused') })
      await expect(alerts).toHaveCount(1)
      expect((await cli(['navigate', '-t', client.paneId, url])).ok).toBe(true)
      await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
      expect((await cli(['dom', '-t', client.paneId])).ok).toBe(true)
      await expect(application.context().pages().find(page => page.url() === url)!.getByRole('main')).toHaveText('Local review')
      await expect(alerts).toHaveCount(0)
      await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
      await chrome.getByRole('dialog', { name: 'Profile' }).getByRole('tab', { name: 'Anti-bot', exact: true }).click()
      await expect(chrome.getByRole('region', { name: 'Paused automation' })).toHaveCount(0)
      await chrome.getByRole('dialog', { name: 'Profile' }).getByRole('button', { name: 'Close', exact: true }).click()
    }
    let after = JSON.parse(await fs.readFile(ledgerFile, 'utf8')).profile_default
    expect(after.startedAt).toBe(ledger.profile_default.startedAt)
    expect(after.lastUsed).toBe(ledger.profile_default.lastUsed)
    expect(after.warningHost).toBe('one.example.com')
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    await chrome.screenshot({ path: path.resolve('artifacts/local-site-without-anti-bot.png') })
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
