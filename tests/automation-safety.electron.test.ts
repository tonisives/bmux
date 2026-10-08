import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse, stringify } from 'yaml'

test('default anti-bot protection blocks warnings across CLI and plugins, with a persistent profile toggle', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-safety-ui-'))
  let server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(request.url === '/warning' ? '<!doctype html><title>Account warning</title><div role="dialog">We suspect automated behavior on your account.</div><button id="continue">Continue</button>' : '<!doctype html><title>Safe fixture</title><main>Visible fixture page</main>')
  })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let base = `http://127.0.0.1:${(server.address() as any).port}`
    let folder = path.join(directory, 'plugins', 'test')
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Safety fixture', version: '1', actions: [{ id: 'browse', title: 'Browse', command: ['node', './run.mjs'], capabilities: ['browser.read'] }] }))
    await fs.writeFile(path.join(folder, 'run.mjs'), `import { execFileSync } from 'node:child_process'; try { execFileSync(process.env.BMUX_CLI, ['plugin','host','dom'], {stdio:'pipe'}) } catch {} process.exit(0)`)
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, plugins: { test: { enabled: true, hooks: false } } }))
    let launch = async () => {
      application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
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
    await expect(alert).toContainText('127.0.0.1')
    await expect(alert).toContainText('All panes using this profile')
    await alert.getByRole('combobox', { name: 'Disable checks for this site' }).selectOption('15')
    await expect(alert).toHaveCount(0)
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(true)
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['127.0.0.1']).toMatchObject({ enabled: true, durationMinutes: 15, expiresAt: expect.any(Number) })
    expect((await cli(['rpc', 'profile.anti-bot.site.set', JSON.stringify({ profile: pane.profileId, host: '127.0.0.1', enabled: false })])).ok).toBe(false)
    await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
    let panel = chrome.getByRole('dialog', { name: 'Profile' })
    await panel.getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    let antiBot = panel.getByRole('tabpanel', { name: 'Anti-bot settings' }), toggle = antiBot.getByRole('switch', { name: 'Enable anti-bot protection' })
    await expect(toggle).toBeChecked()
    let exclusion = antiBot.getByRole('group', { name: '127.0.0.1', exact: true })
    let exclude = exclusion.getByRole('switch', { name: 'Exclude 127.0.0.1' })
    await expect(exclude).toBeChecked()
    await expect(exclusion).toContainText('Until')
    await exclude.uncheck()
    await expect(alert).toBeVisible()
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(false)
    await alert.getByRole('button', { name: 'Dismiss notification' }).click()
    await expect(alert).toHaveCount(0)
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(false)
    await expect(exclude).not.toBeChecked()
    await exclude.check()
    await expect(exclude).toBeChecked()
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(true)
    await exclude.uncheck()
    await expect(alert).toBeVisible()
    await antiBot.getByRole('combobox', { name: 'Disable checks for this site' }).selectOption('60')
    await expect(exclude).toBeChecked()
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['127.0.0.1'].durationMinutes).toBe(60)
    // Shorten only this disposable fixture's persisted expiry to exercise automatic UI refresh.
    let config = parse(await fs.readFile(path.join(directory, 'config.yaml'), 'utf8'))
    config.automation.safety.sites[pane.profileId]['127.0.0.1'].expiresAt = Date.now() + 3000
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify(config))
    await expect(exclusion).toContainText('Expired', { timeout: 10000 })
    await expect(alert).toBeVisible()
    expect((await cli(['dom', '-t', pane.id])).ok).toBe(false)
    await alert.getByRole('combobox', { name: 'Disable checks for this site' }).selectOption('forever')
    await expect(exclude).toBeChecked()
    await expect(exclusion).toContainText('Forever')
    await exclusion.getByRole('button', { name: 'Remove exclusion for 127.0.0.1' }).click()
    await expect(exclusion).toHaveCount(0)
    await expect(alert).toBeVisible()
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['127.0.0.1']).toBeUndefined()
    expect((await cli(['rpc', 'profile.anti-bot.site.remove', JSON.stringify({ profile: pane.profileId, host: '127.0.0.1' })])).ok).toBe(false)
    await expect(antiBot).toContainText('Account warning')
    await expect(antiBot).toContainText('10 minutes')
    await expect(antiBot).toContainText('20 minutes')
    await chrome.screenshot({ path: path.resolve('artifacts/anti-bot-profile.png') })
    await toggle.uncheck()
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
    await expect(antiBot).toContainText('Ready')
    // Returning from the page inspection can change native focus. Activate this
    // client before the next click so Playwright receives compositor frames.
    expect((await cli(['rpc', 'activate-client', JSON.stringify({ client: state.clientId })])).ok).toBe(true)
    await expect(toggle).toBeEnabled()
    await toggle.uncheck()
    await expect.poll(async () => (await cli(['automation', 'safety'])).result.limits.profiles[pane.profileId]).toBe(false)
    await command('profile.anti-bot.site.set', { profile: pane.profileId, host: '127.0.0.1', enabled: false, durationMinutes: 15 })
    let savedExclusion = (await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['127.0.0.1']
    await closeTestApplication(application); application = undefined
    chrome = await launch()
    expect((await cli(['automation', 'safety'])).result.limits.sites[pane.profileId]['127.0.0.1']).toEqual(savedExclusion)
    expect((await cli(['automation', 'safety'])).result.limits.profiles[pane.profileId]).toBe(false)
    await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
    await chrome.getByRole('dialog', { name: 'Profile' }).getByRole('tab', { name: 'Anti-bot', exact: true }).click()
    await expect(chrome.getByRole('switch', { name: 'Enable anti-bot protection' })).not.toBeChecked()
    await expect(chrome.getByRole('switch', { name: 'Exclude 127.0.0.1' })).toBeChecked()
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
