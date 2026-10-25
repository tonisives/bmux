import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse, stringify } from 'yaml'

test('cursor appearance and feedback timers save and apply live without renewing activity', async ({}, testInfo) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-feedback-settings-')), config = path.join(directory, 'config.yaml')
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Cursor settings fixture</title><main>Cursor settings fixture</main>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    await fs.writeFile(config, '# preserve this comment\n' + stringify({ vimEditing: false, browser: { adblock: false, autoUpdateFilters: false }, keyboard: {}, automation: { safety: { enabled: false } } }))
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: config, BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = await chrome.evaluate(() => (window as any).bmux.state()), client = state.model.clients.find((client: any) => client.id === state.clientId), pane = client.paneId
    await chrome.evaluate(client => (window as any).bmux.command({ method: 'activate-client', args: { client } }), client.id)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('main')).toHaveText('Cursor settings fixture')
    await page.evaluate(() => {
      let attach = Element.prototype.attachShadow
      Element.prototype.attachShadow = function (options) { let root = attach.call(this, options); if (this.id === 'bmux-virtual-mouse') (window as any).cursorShadow = root; if (this.id === 'bmux-agent-commands') (window as any).commandShadow = root; return root }
    })
    await expect.poll(() => application!.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.some((view: any) => view.getVisible() && view.webContents?.getURL() === url && view.getBounds().height > 200)), url)).toBe(true)
    let cli = async () => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', 'click', JSON.stringify({ pane, x: 80, y: 120 })], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'settings-agent' }, timeout: 20000 })
      expect(JSON.parse(result.stdout).ok).toBe(true)
    }
    await cli()
    let profileColor = await chrome.locator(`[data-pane-id="${pane}"] [data-profile-avatar] rect`).first().getAttribute('fill')
    await expect.poll(() => page.evaluate(() => (window as any).cursorShadow.querySelector('path').getAttribute('fill'))).toBe(profileColor)
    await chrome.locator(`[data-pane-id="${pane}"]`).getByRole('button', { name: 'Active agent', exact: true }).click()
    await chrome.getByRole('button', { name: 'Bot settings', exact: true }).click()
    let dialog = chrome.getByRole('dialog', { name: 'Bot settings', exact: true })
    await dialog.getByRole('button', { name: 'Cursor and timing', exact: true }).click()
    await expect(dialog.getByRole('img', { name: 'Agent cursor preview' })).toBeVisible()
    await expect(dialog.getByLabel('Cursor color source', { exact: true })).toHaveValue('profile')
    await dialog.getByLabel('Cursor color source', { exact: true }).selectOption('custom')
    await dialog.getByLabel('Custom cursor color', { exact: true }).fill('#76beff')
    await dialog.getByLabel('Cursor size', { exact: true }).fill('40')
    await dialog.getByLabel('Idle rotation', { exact: true }).fill('25')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('status')).toHaveText('Saved')
    await expect.poll(() => page.evaluate(() => ({ color: (window as any).cursorShadow.querySelector('path').getAttribute('fill'), size: (window as any).cursorShadow.querySelector('svg:last-child').getAttribute('width') }))).toEqual({ color: '#76beff', size: '40' })
    await fs.mkdir(testInfo.outputDir, { recursive: true })
    await promisify(execFile)('/usr/sbin/screencapture', ['-x', testInfo.outputPath('cursor-appearance-settings.png')])
    for (let [label, value] of [['Hide cursor after', '0'], ['Command label duration', '1']]) await dialog.getByLabel(label, { exact: true }).fill(value)
    await dialog.getByRole('tab', { name: 'Timing', exact: true }).click()
    let minimum = dialog.getByRole('spinbutton', { name: 'Minimum action pause', exact: true }), maximum = dialog.getByRole('spinbutton', { name: 'Maximum action pause', exact: true })
    for (let [name, min, max] of [['Fast', '0', '200'], ['Medium', '800', '1200'], ['Safe', '1500', '2500']]) {
      await dialog.getByRole('button', { name, exact: true }).click()
      await expect(minimum).toHaveValue(min); await expect(maximum).toHaveValue(max)
      await expect(dialog.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    let leftHandle = dialog.getByRole('slider', { name: 'Minimum action pause slider', exact: true }), rightHandle = dialog.getByRole('slider', { name: 'Maximum action pause slider', exact: true })
    let dragHandle = async (handle: typeof leftHandle, distance: number) => {
      let bounds = (await handle.boundingBox())!, position = Number(await handle.inputValue()) / 1000
      let x = bounds.x + 8 + (bounds.width - 16) * position, y = bounds.y + bounds.height / 2
      await chrome.mouse.move(x, y); await chrome.mouse.down(); await chrome.mouse.move(x + distance, y, { steps: 5 }); await chrome.mouse.up()
    }
    await dragHandle(leftHandle, -30)
    expect(Number(await minimum.inputValue())).toBeLessThan(1500)
    await dragHandle(rightHandle, 30)
    expect(Number(await maximum.inputValue())).toBeGreaterThan(2500)
    await dialog.getByRole('button', { name: 'Safe', exact: true }).click()
    await leftHandle.focus(); await leftHandle.press('End')
    await expect(minimum).toHaveValue('2500')
    await leftHandle.press('Tab'); await expect(rightHandle).toBeFocused()
    await rightHandle.press('Home'); await expect(maximum).toHaveValue('2500')
    await dialog.getByRole('button', { name: 'Medium', exact: true }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('status')).toHaveText('Saved')
    expect(parse(await fs.readFile(config, 'utf8')).agentFeedback).toMatchObject({ actionDelayMinMs: 800, actionDelayMaxMs: 1200, color: '#76beff' })
    for (let [label, value] of [['Unlock page after', '0'], ['Minimum action pause', '200'], ['Maximum action pause', '100']]) await dialog.getByLabel(label, { exact: true }).fill(value)
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Maximum action pause must be at least the minimum')
    await dialog.getByLabel('Minimum action pause', { exact: true }).fill('0')
    await dialog.getByLabel('Maximum action pause', { exact: true }).fill('0')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('status')).toHaveText('Saved')
    await expect.poll(() => chrome.evaluate(async () => (await (window as any).bmux.state()).lockedAgentPanes)).toEqual([])
    let saved = await fs.readFile(config, 'utf8')
    expect(saved).toContain('# preserve this comment')
    expect(parse(saved).agentFeedback).toMatchObject({ color: '#76beff', cursorSize: 40, idleRotationDegrees: 25, cursorHideMs: 0, commandDisplayMs: 1000, inputUnlockMs: 0, actionDelayMinMs: 0, actionDelayMaxMs: 0 })
    await promisify(execFile)('/usr/sbin/screencapture', ['-x', testInfo.outputPath('cursor-timing-settings.png')])
    await dialog.getByRole('button', { name: 'Back to Bot settings' }).click()
    await expect(dialog.getByRole('button', { name: 'Cursor and timing', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await chrome.getByRole('dialog', { name: 'Agent information', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await cli()
    let labels = () => page.evaluate(() => Array.from((window as any).commandShadow.querySelectorAll('[role="log"] div'), (node: any) => node.textContent))
    await expect.poll(labels).toEqual(['click (80, 120)'])
    await expect(page.locator('#bmux-virtual-mouse')).toBeVisible()
    await expect.poll(labels).toEqual([])
    await expect(page.locator('#bmux-virtual-mouse')).toBeVisible()
    await chrome.getByRole('button', { name: 'Profile: default', exact: true }).click()
    let profile = chrome.getByRole('dialog', { name: 'Profile', exact: true })
    await profile.getByRole('tab', { name: 'Bot', exact: true }).click()
    await expect.poll(() => application!.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).filter((view: any) => view.webContents?.getURL() === url).every(view => !view.getVisible()), url)).toBe(true)
    await profile.screenshot({ path: testInfo.outputPath('profile-bot-overview.png') })
    let botTabs = profile.getByRole('tablist', { name: 'Bot sections', exact: true })
    await expect(botTabs.getByRole('tab')).toHaveText(['Protection', 'Appearance', 'Timing'])
    await expect(botTabs.locator('svg')).toHaveCount(3)
    let topTabs = (await profile.getByRole('tablist', { name: 'Profile settings', exact: true }).boundingBox())!, subTabs = (await botTabs.boundingBox())!
    expect(subTabs.y - topTabs.y - topTabs.height).toBeGreaterThanOrEqual(12)
    await botTabs.getByRole('tab', { name: 'Appearance', exact: true }).click()
    await expect(profile.locator('details')).toHaveCount(0)
    let controls = profile.getByRole('form', { name: 'Cursor and timing' })
    await expect(controls.getByLabel('Cursor color source')).toHaveValue('custom')
    await controls.getByLabel('Cursor color source').selectOption('profile')
    await controls.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(controls.getByRole('status')).toHaveText('Saved')
    expect(parse(await fs.readFile(config, 'utf8')).agentFeedback.color).toBe('profile')
    await expect(profile.getByRole('tab', { name: 'Bot', exact: true })).toBeVisible()
    await expect(controls.getByLabel('Custom cursor color')).toBeDisabled()
    await expect(controls.getByRole('spinbutton', { name: 'Minimum action pause', exact: true })).toHaveCount(0)
    for (let name of ['Click halo duration', 'Idle rotation cycle', 'Movement trail fade', 'Hide cursor after', 'Command label duration']) await expect(controls.getByRole('spinbutton', { name, exact: true })).toBeVisible()
    await expect(controls.getByRole('spinbutton', { name: 'Unlock page after', exact: true })).toHaveCount(0)
    let sizeSlider = controls.getByRole('slider', { name: 'Cursor size slider', exact: true })
    await sizeSlider.focus(); await sizeSlider.press('ArrowRight')
    await expect(controls.getByRole('spinbutton', { name: 'Cursor size', exact: true })).toHaveValue('41')
    await botTabs.getByRole('tab', { name: 'Timing', exact: true }).click()
    await expect(controls.getByRole('slider', { name: 'Minimum action pause slider', exact: true })).toBeVisible()
    await expect(controls.getByLabel('Cursor color source')).toHaveCount(0)
    for (let name of ['Click halo duration', 'Idle rotation cycle', 'Movement trail fade', 'Hide cursor after', 'Command label duration']) await expect(controls.getByRole('spinbutton', { name, exact: true })).toHaveCount(0)
    await expect(controls.getByRole('spinbutton', { name: 'Unlock page after', exact: true })).toBeVisible()
    await profile.screenshot({ path: testInfo.outputPath('profile-bot-timing.png') })
    await botTabs.getByRole('tab', { name: 'Appearance', exact: true }).click()
    await expect(controls.getByRole('spinbutton', { name: 'Cursor size', exact: true })).toHaveValue('41')
    await controls.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(controls.getByRole('status')).toHaveText('Saved')
    await expect.poll(() => page.evaluate(() => (window as any).cursorShadow.querySelector('path').getAttribute('fill'))).toBe(profileColor)
    await promisify(execFile)('/usr/sbin/screencapture', ['-x', testInfo.outputPath('profile-bot-settings.png')])
    await profile.getByRole('button', { name: 'Close', exact: true }).click()
    // A config reload shortens the existing deadline instead of restarting it.
    let changed = parse(await fs.readFile(config, 'utf8')); changed.agentFeedback.cursorHideMs = 500
    await fs.writeFile(config, stringify(changed))
    await expect(page.locator('#bmux-virtual-mouse')).toBeHidden()
    expect(await chrome.evaluate(async () => (await (window as any).bmux.state()).agentFeedback.cursorHideMs)).toBe(500)
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
