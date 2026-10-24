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
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), 'dom', '-t', pane], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'settings-agent' }, timeout: 20000 })
      expect(JSON.parse(result.stdout).ok).toBe(true)
    }
    await cli()
    await chrome.locator(`[data-pane-id="${pane}"]`).getByRole('button', { name: 'Active agent', exact: true }).click()
    await chrome.getByRole('button', { name: 'Agent settings', exact: true }).click()
    let dialog = chrome.getByRole('dialog', { name: 'General anti-bot settings', exact: true })
    await dialog.getByRole('button', { name: 'Cursor and timing', exact: true }).click()
    await expect(dialog.getByRole('img', { name: 'Agent cursor preview' })).toBeVisible()
    await dialog.getByLabel('Cursor color', { exact: true }).fill('#76beff')
    await dialog.getByLabel('Cursor size', { exact: true }).fill('40')
    await dialog.getByLabel('Idle rotation', { exact: true }).fill('25')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('status')).toHaveText('Saved')
    await expect.poll(() => page.evaluate(() => ({ color: (window as any).cursorShadow.querySelector('path').getAttribute('fill'), size: (window as any).cursorShadow.querySelector('svg:last-child').getAttribute('width') }))).toEqual({ color: '#76beff', size: '40' })
    await dialog.getByRole('tab', { name: 'Timing', exact: true }).click()
    for (let [label, value] of [['Hide cursor after', '0'], ['Command label duration', '1'], ['Unlock page after', '0'], ['Minimum action pause', '200'], ['Maximum action pause', '100']]) await dialog.getByLabel(label, { exact: true }).fill(value)
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Maximum action pause must be at least the minimum')
    await dialog.getByLabel('Minimum action pause', { exact: true }).fill('0')
    await dialog.getByLabel('Maximum action pause', { exact: true }).fill('0')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('status')).toHaveText('Saved')
    await expect.poll(() => chrome.evaluate(() => (window as any).bmux.state().lockedAgentPanes)).toEqual([])
    let saved = await fs.readFile(config, 'utf8')
    expect(saved).toContain('# preserve this comment')
    expect(parse(saved).agentFeedback).toMatchObject({ color: '#76beff', cursorSize: 40, idleRotationDegrees: 25, cursorHideMs: 0, commandDisplayMs: 1000, inputUnlockMs: 0, actionDelayMinMs: 0, actionDelayMaxMs: 0 })
    await fs.mkdir(testInfo.outputDir, { recursive: true })
    await promisify(execFile)('/usr/sbin/screencapture', ['-x', testInfo.outputPath('cursor-timing-settings.png')])
    await dialog.getByRole('button', { name: 'Back to general anti-bot settings' }).click()
    await expect(dialog.getByRole('button', { name: 'Cursor and timing', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await chrome.getByRole('dialog', { name: 'Agent information', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await cli()
    let labels = () => page.evaluate(() => Array.from((window as any).commandShadow.querySelectorAll('[role="log"] div'), (node: any) => node.textContent))
    await expect.poll(labels).toEqual(['dom'])
    await expect(page.locator('#bmux-virtual-mouse')).toBeVisible()
    await expect.poll(labels).toEqual([])
    await expect(page.locator('#bmux-virtual-mouse')).toBeVisible()
    // A config reload shortens the existing deadline instead of restarting it.
    let changed = parse(await fs.readFile(config, 'utf8')); changed.agentFeedback.cursorHideMs = 500
    await fs.writeFile(config, stringify(changed))
    await expect(page.locator('#bmux-virtual-mouse')).toBeHidden()
    expect(await chrome.evaluate(() => (window as any).bmux.state().agentFeedback.cursorHideMs)).toBe(500)
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
