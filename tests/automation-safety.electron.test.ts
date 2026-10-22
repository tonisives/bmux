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

for (let action of ['alert', 'settings', 'expiry', 'idle']) test(`session-limit alert supports ${action} without allowing a CLI reset`, async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-session-limit-'))
  let server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Session limit fixture</title><main>Visible session limit fixture</main>')
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://one.example.com:${(server.address() as any).port}/fixture`
    let startedAt = Date.now() - (action === 'expiry' ? 30 * 60_000 - 15_000 : action === 'idle' ? 29 * 60_000 : 11 * 60_000)
    let savedUsage = { siteHost: 'one.example.com', startedAt, lastUsed: startedAt + 1000, ...(action === 'idle' ? {} : { limitReachedAt: startedAt + 10 * 60_000 }) }
    await fs.writeFile(path.join(directory, 'automation-safety.json'), JSON.stringify({ profile_default: { ...savedUsage, profileId: 'profile_default' }, profile_other: { ...savedUsage, profileId: 'profile_other' } }))
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false } }))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${new URL(url).origin}`], env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let client = state.model.clients.find((item: { id: string }) => item.id === state.clientId)
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
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
    if (action === 'idle') {
      await expect(alert).toHaveCount(0)
      let otherUrl = url.replace('one.example.com', 'two.example.com')
      let other = await chrome.evaluate(args => (window as any).bmux.command({ method: 'split-window', args }), { pane: client.paneId, client: state.clientId, url: otherUrl })
      expect((await cli(['dom', '-t', other.id, '--agent-id', 'other-agent'])).ok).toBe(true)
      let usages = (await cli(['automation', 'safety'])).result.profiles
      expect(usages.find((item: { profileId: string; siteHost: string }) => item.profileId === 'profile_default' && item.siteHost === 'one.example.com')).toMatchObject({ startedAt, lastUsed: startedAt + 1000, retryAfter: null })
      await expect(alert).toHaveCount(0)
      expect((await cli(['dom', '-t', client.paneId])).ok).toBe(true)
      let fresh = (await cli(['automation', 'safety'])).result.profiles.find((item: { profileId: string; siteHost: string }) => item.profileId === 'profile_default' && item.siteHost === 'one.example.com')
      expect(fresh).toMatchObject({ retryAfter: null, actors: [{ paneId: client.paneId, agentId: 'test-agent', hosts: ['one.example.com'] }] })
      expect(fresh.startedAt).toBeGreaterThan(startedAt + 28 * 60_000)
      await expect(alert).toHaveCount(0)
      await fs.mkdir(path.resolve('artifacts'), { recursive: true })
      await chrome.screenshot({ path: path.resolve('artifacts/session-limit-idle.png') })
      return
    }
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('combobox')).toHaveCount(1)
    expect((await cli(['dom', '-t', client.paneId])).ok).toBe(false)
    await expect(alert.getByRole('combobox', { name: 'Disable anti-bot for one.example.com', exact: true })).toBeVisible()
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
    await expect(chrome.getByRole('group', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'Anti-bot settings' }).locator('svg')).toBeVisible()
    await expect(alert.getByRole('combobox')).toHaveCount(1)
    let site = alert.locator('label'), message = alert.getByText('Automation session limit reached for default.', { exact: true })
    let general = chrome.getByRole('group', { name: 'General anti-bot settings', exact: true })
    await expect(general.getByRole('button', { name: 'Reset all anti bot sessions', exact: true })).toBeVisible()
    expect(await general.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await alert.evaluate(element => getComputedStyle(element).backgroundColor))
    expect((await general.boundingBox())!.y).toBeGreaterThanOrEqual(row!.y + row!.height)
    let orderedControls = [timer, site, message, alert.getByRole('button', { name: 'Dismiss notification' })]
    let controlBounds = await Promise.all(orderedControls.map(control => control.boundingBox()))
    for (let index = 1; index < controlBounds.length; index++) expect(controlBounds[index]!.x).toBeGreaterThanOrEqual(controlBounds[index - 1]!.x + controlBounds[index - 1]!.width)
    let siteStyle = await site.evaluate(element => getComputedStyle(element).borderTopWidth)
    expect(siteStyle).toBe('1px')
    if (action === 'expiry') {
      await chrome.getByRole('group', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'Anti-bot settings' }).click()
      await chrome.getByRole('dialog', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'default', exact: true }).click()
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
    expect(await cli(['rpc', 'automation.reset-all-sessions', '{}'])).toMatchObject({ ok: false, error: expect.stringContaining('bmux UI') })
    if (action === 'alert') {
      let otherUrl = url.replace('one.example.com', 'two.example.com')
      let otherPane = await chrome.evaluate(args => (window as any).bmux.command({ method: 'split-window', args }), { pane: client.paneId, client: state.clientId, url: otherUrl })
      await expect.poll(() => application!.context().pages().some(page => page.url() === otherUrl)).toBe(true)
      await expect(alert).toHaveCount(1)
      await expect(alert.getByRole('combobox', { name: 'Disable anti-bot for two.example.com', exact: true })).toHaveCount(0)
      expect((await cli(['dom', '-t', otherPane.id])).ok).toBe(true)
      await expect(alert).toHaveCount(1)
      let firstRow = alert.filter({ has: chrome.getByRole('combobox', { name: 'Disable anti-bot for one.example.com', exact: true }) })
      await expect(firstRow).toBeVisible()
      await expect(firstRow.getByRole('button', { name: /^Go to pane / })).toHaveCount(0)
      await expect(alert.getByRole('combobox', { name: 'Disable anti-bot for two.example.com', exact: true })).toHaveCount(0)
      let usages = (await cli(['automation', 'safety'])).result.profiles
      expect(usages.find((usage: { siteHost: string }) => usage.siteHost === 'two.example.com')).toMatchObject({ retryAfter: null, actors: [{ paneId: otherPane.id }] })
      // Denied commands never attributed this pane to the expired session.
      let manualUrl = url.replace('one.example.com', 'three.example.com')
      await chrome.evaluate(args => (window as any).bmux.command({ method: 'navigate', args }), { pane: client.paneId, url: manualUrl })
      await expect.poll(() => application!.context().pages().some(page => page.url() === manualUrl)).toBe(true)
      await expect(application.context().pages().find(page => page.url() === manualUrl)!.getByRole('main')).toHaveText('Visible session limit fixture')
      await expect(firstRow).toHaveCount(0)
      await expect(alert).toHaveCount(0)
      await expect(alert.getByRole('combobox', { name: 'Disable anti-bot for three.example.com', exact: true })).toHaveCount(0)
      await chrome.evaluate(args => (window as any).bmux.command({ method: 'navigate', args }), { pane: client.paneId, url })
      await expect(firstRow).toBeVisible()
      await general.getByRole('button', { name: 'Reset all anti bot sessions' }).click()
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
    if (action === 'alert') expect((await cli(['automation', 'safety'])).result.profiles.find((item: { profileId: string }) => item.profileId === 'profile_other')).toMatchObject({ retryAfter: null, startedAt: expect.any(Number) })
    if (action === 'alert') expect((await cli(['automation', 'safety'])).result.profiles.find((item: { profileId: string }) => item.profileId === 'profile_other').startedAt).toBeGreaterThan(startedAt)
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
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false } }))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${new URL(url).origin}`], env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let personal = state.model.clients.find((item: { id: string }) => item.id === state.clientId)
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
        if (error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    let agents = await command('new-session', { name: 'agents', profile: 'default' })
    let first = (await cli(['new-window', '-t', agents.id, '-n', 'research', '--agent-id', '%45', '--agent-name', 'Research agent', '--agent-purpose', 'Review sources for the launch article'])).result.panes[0]
    let second = (await cli(['new-window', '-t', agents.id, '-n', 'review', '--agent-id', '%46'])).result.panes[0]
    expect(first).toMatchObject({ agentId: '%45', agentName: 'Research agent', agentPurpose: 'Review sources for the launch article' })
    for (let pane of [first, second]) {
      await command('navigate', { pane: pane.id, url: `${url}?agent=${pane.id}` })
      expect((await cli(['dom', '-t', pane.id, '--agent-id', pane.agentId])).ok).toBe(true)
    }
    await closeTestApplication(application)
    application = undefined
    let ledgerFile = path.join(directory, 'automation-safety.json')
    let ledger = JSON.parse(await fs.readFile(ledgerFile, 'utf8'))
    for (let usage of Object.values(ledger) as { startedAt: number; lastUsed: number; limitReachedAt?: number }[]) { usage.startedAt = startedAt; usage.lastUsed = startedAt + 1000; usage.limitReachedAt = startedAt + 10 * 60_000 }
    await fs.writeFile(ledgerFile, JSON.stringify(ledger))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${new URL(url).origin}`], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
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
    for (let [pane, window, agentId] of [[first, 2, '%45'], [second, 3, '%46']] as const) {
      let open = alert.getByRole('button', { name: `Go to pane agents:${window} · ${pane.id} (${agentId})`, exact: true })
      await expect(open).toHaveText('agents')
      await expect(open).toHaveAttribute('title', `Go to pane agents:${window} · ${pane.id} (${agentId})`)
      await expect(open.locator('span')).toHaveText('agents')
      await expect(open.locator('svg')).toBeVisible()
    }
    await alert.getByRole('button', { name: 'Agent information', exact: true }).click()
    let agentInfo = chrome.getByRole('dialog', { name: 'Agent information', exact: true })
    await expect(agentInfo).toContainText('Research agent')
    await expect(agentInfo).toContainText('Review sources for the launch article')
    await expect(agentInfo).toContainText('%45')
    await expect(agentInfo).toContainText('%46')
    await expect(agentInfo).not.toContainText('Not provided')
    await expect(agentInfo).not.toContainText('Browser pane')
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    await chrome.screenshot({ path: path.resolve('artifacts/automation-agent-information.png') })
    await agentInfo.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(alert).not.toContainText(first.id)
    await expect(alert).not.toContainText(second.id)
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    await chrome.screenshot({ path: path.resolve('artifacts/automation-agent-notice-compact.png') })
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
    await alert.getByRole('button', { name: 'Agent information', exact: true }).click()
    await expect(agentInfo).toContainText('Research agent')
    await agentInfo.press('Escape')
    expect(await requester.evaluate(() => (window as any).permissionResult)).toBeUndefined()
    await permission.getByRole('button', { name: 'Deny', exact: true }).click()
    await expect(permission).toHaveCount(0)
    await chrome.getByRole('group', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'Anti-bot settings', exact: true }).click()
    await chrome.getByRole('dialog', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'default', exact: true }).click()
    let antiBot = chrome.getByRole('tabpanel', { name: 'Anti-bot settings' })
    await expect(antiBot).toContainText('Agent %45')
    let toggle = antiBot.getByRole('switch', { name: 'Enable Anti-bot for this pane', exact: true })
    await toggle.uncheck()
    await expect.poll(async () => (await cli(['dom', '-t', first.id, '--agent-id', '%45'])).ok).toBe(true)
    expect((await cli(['dom', '-t', second.id, '--agent-id', '%46'])).ok).toBe(false)
    await expect(alert).not.toContainText('(%45)')
    expect((await cli(['rpc', 'pane.anti-bot.set', JSON.stringify({ pane: second.id, enabled: false })])).ok).toBe(false)
    await toggle.check()
    await expect.poll(async () => (await cli(['dom', '-t', first.id, '--agent-id', '%45'])).ok).toBe(false)
    await chrome.getByRole('dialog', { name: 'Profile', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await alert.getByRole('button', { name: `Go to pane agents:3 · ${second.id} (%46)`, exact: true }).locator('span').click()
    await expect.poll(async () => (await command('list-clients')).find((item: { id: string }) => item.id === personal.id).paneId).toBe(second.id)
    await expect(alert.getByRole('button', { name: `Go to pane agents:3 · ${second.id} (%46)`, exact: true })).toHaveCount(0)
    await expect(alert.getByRole('button', { name: `Go to pane agents:2 · ${first.id} (%45)`, exact: true })).toBeVisible()
    await alert.getByRole('button', { name: `Go to pane agents:2 · ${first.id} (%45)`, exact: true }).locator('svg').click()
    await expect.poll(async () => (await command('list-clients')).find((item: { id: string }) => item.id === personal.id).paneId).toBe(first.id)
    await alert.getByRole('button', { name: `Go to pane agents:3 · ${second.id} (%46)`, exact: true }).click({ position: { x: 2, y: 2 } })
    await expect.poll(async () => (await command('list-clients')).find((item: { id: string }) => item.id === personal.id).paneId).toBe(second.id)
    await chrome.getByRole('group', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'Anti-bot settings', exact: true }).click()
    await chrome.getByRole('dialog', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'default', exact: true }).click()
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
      application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1'], env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
      await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
      return application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    }
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    let chrome = await launch()
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state()), pane = state.model.sessions[0].windows[0].panes[0]
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
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
    await expect(chrome.getByRole('group', { name: 'General anti-bot settings', exact: true }).getByRole('button', { name: 'Anti-bot settings' }).locator('svg')).toBeVisible()
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
    let ledger = { profile_default: { profileId: 'profile_default', siteHost: 'one.example.com', startedAt, lastUsed: startedAt + 1000, warning: 'account-warning', warningHost: 'one.example.com' } }
    let ledgerFile = path.join(directory, 'automation-safety.json')
    await fs.writeFile(ledgerFile, JSON.stringify(ledger))
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false } }))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1'], env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let client = state.model.clients.find((item: { id: string }) => item.id === state.clientId)
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_AGENT_ID: 'test-agent', BMUX_DATA_DIR: directory }, timeout: 20000 }).catch(error => {
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
    let after = Object.values(JSON.parse(await fs.readFile(ledgerFile, 'utf8'))).find((value: any) => value.profileId === 'profile_default') as typeof ledger.profile_default
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

test('agent identity is required by default, typed context can focus its terminal, and the requirement can be disabled', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-agent-identity-'))
  let marker = path.join(directory, 'focused.json')
  let expectedIdentity = '{"agentId":"<id>","agentType":"terminal","agentData":{"sessionId":"<session>","windowId":"<window>","paneId":"<pane>"}}'
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Agent identity</title><main>Agent context fixture</main>') })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://one.example.com:${(server.address() as { port: number }).port}/identity`
    let focusCommand = `node -e 'process.stdin.resume(); process.stdin.on("end", () => require("node:fs").writeFileSync(process.argv[1], JSON.stringify([process.env.BMUX_AGENT_ID, process.env.BMUX_AGENT_SESSION_ID, process.env.BMUX_AGENT_WINDOW_ID, process.env.BMUX_AGENT_PANE_ID])))' "${marker}"`
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, browser: { adblock: false, autoUpdateFilters: false }, automation: { agents: { definitions: { terminal: { fields: { sessionId: { label: 'Terminal session', type: 'session', required: true }, windowId: { label: 'Terminal window', type: 'window', required: true }, paneId: { label: 'Terminal pane', type: 'pane', required: true } }, focusCommand } } } } }))
    application = await electron.launch({ args: [process.cwd(), '--host-resolver-rules=MAP *.example.com 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let pane = state.model.clients.find((client: { id: string }) => client.id === state.clientId).paneId
    let cli = async (args: string[]) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: undefined, BMUX_AGENT_NAME: undefined, BMUX_AGENT_PURPOSE: undefined, BMUX_AGENT_TYPE: undefined, BMUX_AGENT_DATA: undefined }, timeout: 20000 }).catch(error => { if (error.stdout) return { stdout: error.stdout }; throw error })
      return JSON.parse(result.stdout)
    }
    let failedUrl = 'http://two.example.com:1/unreachable'
    expect((await cli(['navigate', '-t', pane, failedUrl, '--agent-id', 'research'])).ok).toBe(false)
    expect((await cli(['automation', 'safety'])).result.profiles).toEqual([])
    let failedCdp = await cli(['cdp', '-t', pane, 'Page.navigate', JSON.stringify({ url: failedUrl }), '--agent-id', 'research'])
    expect(failedCdp.result.errorText).toContain('ERR_UNSAFE_PORT')
    expect((await cli(['automation', 'safety'])).result.profiles).toEqual([])
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.press('ControlOrMeta+A'); await address.press('Backspace')
    await expect(address).toHaveValue('')
    await address.pressSequentially(url)
    await expect(address).toHaveValue(url)
    await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    await expect(application.context().pages().find(page => page.url() === url)!.getByRole('main')).toHaveText('Agent context fixture')
    expect(await cli(['dom', '-t', pane])).toMatchObject({ ok: false, error: `Agent ID required. Expected JSON: ${expectedIdentity}` })
    expect((await cli(['automation', 'safety'])).result.profiles).toEqual([])
    expect(await cli(['rpc', 'dom', JSON.stringify({ pane })])).toMatchObject({ ok: false, error: `Agent ID required. Expected JSON: ${expectedIdentity}` })
    expect((await cli(['dom', '-t', pane, '--agent-id', 'plain-agent'])).ok).toBe(true)
    await expect(chrome.getByLabel('Notifications').getByRole('status')).toHaveCount(0)
    let sibling = await chrome.evaluate(args => (window as any).bmux.command({ method: 'split-window', args }), { pane, client: state.clientId, url: `${url}?sibling` })
    let paneAgent = chrome.locator(`[data-pane-id="${pane}"]`).getByRole('button', { name: 'Active agent', exact: true })
    let siblingAgent = chrome.locator(`[data-pane-id="${sibling.id}"]`).getByRole('button', { name: 'Active agent', exact: true })
    await expect(paneAgent).toHaveAttribute('title', 'Agent controlling · page input locked · plain-agent')
    await expect(siblingAgent).toHaveCount(0)
    await expect(chrome.getByRole('button', { name: 'Active agents', exact: true })).toHaveCount(0)
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}?sibling`)).toBe(true)
    expect((await cli(['dom', '-t', sibling.id, '--agent-id', 'review', '--agent-name', 'Review agent'])).ok).toBe(true)
    await expect(siblingAgent).toHaveAttribute('title', 'Agent controlling · page input locked · Review agent (review)')
    await expect(chrome.locator(`[data-pane-id="${sibling.id}"]`)).toHaveAttribute('data-focused-pane', 'true')
    await paneAgent.click()
    let dialog = chrome.getByRole('dialog', { name: 'Agent information', exact: true })
    await expect(dialog).toContainText('plain-agent')
    await expect(dialog.getByText('plain-agent', { exact: true })).toHaveCount(1)
    await expect(dialog).not.toContainText('Agent controlling')
    await expect(dialog).not.toContainText('Browser pane')
    await expect(dialog).not.toContainText('Review agent')
    expect((await cli(['dom', '-t', sibling.id, '--agent-id', 'other-review'])).ok).toBe(true)
    await expect(siblingAgent).toHaveAttribute('title', 'Agent controlling · page input locked · other-review')
    await expect(dialog).toContainText('plain-agent')
    await expect(dialog).not.toContainText('other-review')
    expect((await cli(['dom', '-t', pane, '--agent-id', 'research', '--agent-name', 'Research agent', '--agent-purpose', 'Inspect agent context', '--agent-type', 'terminal', '--agent-data', JSON.stringify({ sessionId: '$7', sessionName: 'research-work', windowId: '@8', paneId: '%9' })])).ok).toBe(true)
    for (let text of ['Research agent', 'Inspect agent context', 'Terminal session', 'research-work', 'Terminal window', '@8', 'Terminal pane', '%9']) await expect(dialog).toContainText(text)
    await expect(dialog).not.toContainText('$7')
    await expect(dialog.getByText('research-work', { exact: true })).toHaveCount(1)
    for (let name of ['Focus agent', 'Hide agent cursor', 'Agent settings']) {
      let button = dialog.getByRole('button', { name, exact: true })
      await expect(button.locator('svg')).toBeVisible()
      expect(await button.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
      expect(await button.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('1px')
    }
    await expect(dialog).not.toContainText('plain-agent')
    let targetSession = state.model.sessions.find((session: any) => session.windows.some((window: any) => window.panes.some((item: any) => item.id === pane)))
    let targetWindow = targetSession.windows.find((window: any) => window.panes.some((item: any) => item.id === pane))
    let windowTarget = `${targetSession.name}:${targetWindow.number ?? targetSession.windows.indexOf(targetWindow) + 1}`
    for (let target of [pane, `${windowTarget}.0`]) expect(await cli(['eval', '-t', target, '--agent-id', 'research', 'location.href'])).toMatchObject({ ok: true, result: url })
    expect(await cli(['eval', '-t', windowTarget, '--agent-id', 'other-review', 'location.href'])).toMatchObject({ ok: true, result: `${url}?sibling` })
    await expect(paneAgent).toHaveAttribute('title', 'Agent controlling · page input locked · Research agent (research)')
    await expect(chrome.locator(`[data-pane-id="${sibling.id}"]`)).toHaveAttribute('data-focused-pane', 'true')
    expect(await cli(['rpc', 'agent.focus', JSON.stringify({ pane, agentId: 'research' })])).toMatchObject({ ok: false, error: expect.stringContaining('bmux UI') })
    expect(await cli(['rpc', 'agent.cursor.set', JSON.stringify({ pane, agentId: 'research', hidden: true })])).toMatchObject({ ok: false, error: expect.stringContaining('bmux UI') })
    await dialog.getByRole('button', { name: 'Focus agent', exact: true }).click()
    await expect.poll(async () => JSON.parse(await fs.readFile(marker, 'utf8').catch(() => 'null'))).toEqual(['research', '$7', '@8', '%9'])
    await fs.mkdir(path.resolve('artifacts'), { recursive: true })
    await chrome.screenshot({ path: path.resolve('artifacts/agent-typed-context.png') })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await siblingAgent.click()
    await expect(dialog).toContainText('other-review')
    await expect(dialog).not.toContainText('Research agent')
    await expect(dialog.getByRole('button', { name: 'Focus agent', exact: true })).toHaveCount(0)
    expect((await cli(['dom', '-t', sibling.id, '--agent-id', 'research'])).ok).toBe(true)
    for (let text of ['Research agent', 'Inspect agent context', 'Terminal session', 'research-work', 'Terminal window', '@8', 'Terminal pane', '%9']) await expect(dialog).toContainText(text)
    let origin = { type: 'tmux', paneId: '%9', panePid: '12345', threadId: 'research-thread' }
    expect((await cli(['rpc', 'dom', JSON.stringify({ pane: sibling.id, agentId: 'research', agentOrigin: origin, agentData: { sessionId: '$7', sessionName: 'research-renamed', windowId: '@8', paneId: '%9' } })])).ok).toBe(true)
    let staleFocus = await chrome.evaluate(args => (window as any).bmux.command({ method: 'agent.focus', args }).then(() => '').catch((error: Error) => error.message), { pane: sibling.id, agentId: 'research' })
    expect(staleFocus).toContain('agent terminal in this browser pane has changed')
    await expect(dialog.getByText('research-renamed', { exact: true })).toBeVisible()
    await fs.rm(marker)
    await dialog.getByRole('button', { name: 'Focus agent', exact: true }).click()
    await expect.poll(async () => JSON.parse(await fs.readFile(marker, 'utf8').catch(() => 'null'))).toEqual(['research', '$7', '@8', '%9'])
    await chrome.screenshot({ path: path.resolve('artifacts/agent-context-across-panes.png') })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await paneAgent.click()
    await expect(dialog).toContainText('Research agent')
    await dialog.getByRole('button', { name: 'Agent settings', exact: true }).click()
    let settings = chrome.getByRole('dialog', { name: 'General anti-bot settings', exact: true })
    let required = settings.getByRole('switch', { name: 'Require agent ID', exact: true })
    await expect(required).toBeChecked()
    let requiredType = settings.getByRole('switch', { name: 'Require agent type', exact: true })
    await expect(requiredType).not.toBeChecked()
    await requiredType.check()
    await expect.poll(async () => parse(await fs.readFile(path.join(directory, 'config.yaml'), 'utf8')).automation.agents.requireType).toBe(true)
    for (let args of [
      ['dom', '-t', pane, '--agent-id', 'unregistered'],
      ['rpc', 'dom', JSON.stringify({ pane, agentId: 'unregistered' })],
      ['rpc', 'navigate', JSON.stringify({ pane, url: `${url}?blocked`, agentId: 'unregistered' })],
      ['automation', 'acquire', '-t', pane, '--url', url, '--agent-id', 'unregistered'],
      ['new-window', '-t', state.model.clients.find((client: { id: string }) => client.id === state.clientId).sessionId, '--url', url, '--agent-id', 'unregistered'],
    ]) expect(await cli(args)).toMatchObject({ ok: false, error: `Agent type required. Expected JSON: ${expectedIdentity}` })
    expect(await cli(['dom', '-t', pane, '--agent-id', 'incomplete', '--agent-type', 'terminal', '--agent-data', '{"paneId":"%99"}'])).toMatchObject({ ok: false, error: expect.stringContaining('agentData.sessionId, agentData.windowId') })
    expect(await cli(['dom', '-t', pane, '--agent-id', 'unregistered', '--agent-type', 'missing'])).toMatchObject({ ok: false, error: expect.stringContaining('Unknown agent type') })
    await expect(paneAgent).toHaveAttribute('title', 'Agent controlling · page input locked · Research agent (research)')
    expect((await cli(['dom', '-t', pane, '--agent-id', 'research'])).ok).toBe(true)
    await requiredType.uncheck()
    await expect.poll(async () => parse(await fs.readFile(path.join(directory, 'config.yaml'), 'utf8')).automation.agents.requireType).toBe(false)
    expect((await cli(['rpc', 'automation.agents.set', '{"requireId":false}'])).ok).toBe(false)
    await required.uncheck()
    await expect.poll(async () => parse(await fs.readFile(path.join(directory, 'config.yaml'), 'utf8')).automation.agents.requireId).toBe(false)
    expect((await cli(['dom', '-t', pane])).ok).toBe(true)
    await required.check()
    await expect.poll(async () => (await cli(['dom', '-t', pane])).error).toContain('Agent ID required')
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
