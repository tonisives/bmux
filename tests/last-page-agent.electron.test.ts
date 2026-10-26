import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'

test('page agent button keeps the last interaction after inactivity, manual browsing and restart', async ({}, testInfo) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-last-page-agent-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Last page agent</title><main>Last page agent fixture</main>')
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ vimEditing: false, keyboard: {}, browser: { adblock: false, autoUpdateFilters: false }, agentFeedback: { inputUnlockMs: 0 }, automation: { safety: { enabled: false } } }))
    let launch = async () => {
      application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
      await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
      return application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    }
    let chrome = await launch()
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let current = await state(), client = current.model.clients.find((item: any) => item.id === current.clientId), paneId = client.paneId
    let pane = async () => (await state()).model.sessions.flatMap((session: any) => session.windows.flatMap((window: any) => window.panes)).find((pane: any) => pane.id === paneId)
    let cli = async (method: string, args: Record<string, unknown> = {}) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', method, JSON.stringify({ pane: paneId, ...args })], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'research' }, timeout: 20000 })
      expect(JSON.parse(result.stdout).ok).toBe(true)
    }
    await chrome.evaluate(client => (window as any).bmux.command({ method: 'activate-client', args: { client } }), client.id)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.pressSequentially(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    await expect(application!.context().pages().find(page => page.url() === url)!.getByRole('main')).toHaveText('Last page agent fixture')
    let bar = () => chrome.locator(`[data-pane-id="${paneId}"]`).getByRole('group', { name: 'Pane address', exact: true })
    await expect(bar().getByRole('button', { name: /^(Active|Last) agent$/ })).toHaveCount(0)
    await cli('status')
    await expect(bar().getByRole('button', { name: /^(Active|Last) agent$/ })).toHaveCount(0)
    await cli('dom', { agentName: 'Research agent', agentPurpose: 'Review this page', agentType: 'tmux', agentData: { sessionId: '$7', sessionName: 'research', windowId: '@52', windowIndex: '0', paneId: '%42' } })
    let saved = (await pane()).lastAgentInteraction
    expect(saved).toMatchObject({ agentId: 'research', agentName: 'Research agent', agentPurpose: 'Review this page', agentData: { paneId: '%42' } })
    expect(saved.lastUsed).toBeGreaterThan(Date.now() - 5000)
    let active = bar().getByRole('button', { name: 'Active agent', exact: true })
    await expect(active).toContainText('research:0 · %42')
    await expect(active.locator('time')).toHaveAttribute('datetime', new Date(saved.lastUsed).toISOString())
    await expect(active.locator('time')).toHaveAttribute('data-age', 'recent')
    await expect(active.locator('time')).toHaveCSS('color', 'rgb(167, 200, 141)')
    await chrome.evaluate(args => (window as any).bmux.command({ method: 'navigate', args }), { pane: paneId, url: `${url}manual` })
    await expect.poll(async () => (await pane()).lastUsedBy).toBe('human')
    expect((await pane()).lastAgentInteraction).toEqual(saved)
    await expect(active).toBeVisible()
    await expect.poll(async () => (await state()).activeAgents.some((actor: any) => actor.paneId === paneId), { timeout: 70000 }).toBe(false)
    let previous = bar().getByRole('button', { name: 'Last agent', exact: true })
    await expect(previous).toContainText('research:0 · %42')
    await expect(previous.locator('time')).toHaveText('1m')
    await fs.mkdir(testInfo.outputDir, { recursive: true })
    await chrome.screenshot({ path: testInfo.outputPath('last-page-agent.png') })
    await previous.click()
    let details = chrome.getByRole('dialog', { name: 'Agent information', exact: true })
    for (let text of ['Research agent', 'Review this page', '%42', 'Last interaction']) await expect(details).toContainText(text)
    await expect(details.locator('time')).toHaveAttribute('datetime', new Date(saved.lastUsed).toISOString())
    await details.getByRole('button', { name: 'Close', exact: true }).click()
    await closeTestApplication(application); application = undefined
    let stored = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'))
    let storedPane = stored.sessions.flatMap((session: any) => session.windows.flatMap((window: any) => window.panes)).find((pane: any) => pane.id === paneId)
    expect(storedPane.lastAgentInteraction).toEqual(saved)
    storedPane.lastAgentInteraction.lastUsed = Date.now() - 2 * 3600000
    await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(stored))
    chrome = await launch()
    previous = bar().getByRole('button', { name: 'Last agent', exact: true })
    await expect(previous).toContainText('research:0 · %42')
    await expect(previous.locator('time')).toHaveText('2h')
    await expect(previous.locator('time')).toHaveCSS('color', 'rgb(229, 192, 123)')
    await previous.click()
    details = chrome.getByRole('dialog', { name: 'Agent information', exact: true })
    await expect(details).toContainText('Research agent')
    await cli('dom', { agentId: 'review', agentName: 'Review agent' })
    await expect(details).toContainText('Review agent')
    await expect(details).not.toContainText('Research agent')
    active = bar().getByRole('button', { name: 'Active agent', exact: true })
    await expect(active).toContainText('review')
    await expect(active.locator('time')).toHaveText('jn')
    await expect(active.locator('time')).toHaveCSS('color', 'rgb(167, 200, 141)')
    expect((await pane()).lastAgentInteraction).toMatchObject({ agentId: 'review', agentName: 'Review agent' })
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
