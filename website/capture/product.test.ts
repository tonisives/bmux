import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

let exec = promisify(execFile)

test('capture the real app with disposable local demo pages', async () => {
  if (process.env.BMUX_TEST_NATIVE !== '1' && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run product capture through the Tart runner. See website/capture/README.md.')
  await exec('/usr/bin/caffeinate', ['-u', '-t', '1'])
  let root = process.cwd()
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-product-'))
  let destination = path.join(root, 'artifacts', 'product')
  await fs.mkdir(destination, { recursive: true })
  let server = http.createServer(async (request, response) => {
    let page = request.url === '/handbook' ? 'handbook' : 'checklist'
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(await fs.readFile(path.join(root, 'website/capture', `${page}.html`)))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let application = await electron.launch({ args: [root], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
  let cli = async (method: string, args: Record<string, unknown> = {}) => {
    let result = await exec(process.execPath, [path.join(root, 'bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory }, timeout: 30000 })
    let response = JSON.parse(result.stdout)
    expect(response.ok).toBe(true)
    return response.result
  }
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = await cli('state')
    let session = state.model.sessions[0], pane = session.windows[0].panes[0], client = state.model.clients[0]
    await cli('rename-session', { session: session.id, name: 'development' })
    await cli('rename-window', { window: session.windows[0].id, name: 'workspace' })
    await cli('new-session', { name: 'research' })
    await cli('new-session', { name: 'personal' })
    await cli('activate-client', { client: client.id })
    await application.evaluate(({ BaseWindow }) => { for (let window of BaseWindow.getAllWindows()) if (window.isVisible()) window.setBounds({ x: 40, y: 60, width: 1120, height: 680 }) })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${url}/handbook`)
    await address.press('Enter')
    await cli('wait', { tab: pane.activeTabId, selector: 'h1' })
    let bot = await cli('split-window', { pane: pane.id, profile: 'bot', url: `${url}/checklist` })
    await cli('wait', { tab: bot.activeTabId, selector: '#task' })
    await cli('select-pane', { client: client.id, pane: pane.id })
    await cli('activate-client', { client: client.id })
    await expect.poll(() => application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.filter(view => 'webContents' in view && view.getBounds().width > 300).length >= 3))).toBe(true)
    let capture = async (name: string, overlay = false) => {
      if (!overlay) await cli('client.overlay', { client: client.id, visible: true })
      await chrome.waitForTimeout(500)
      await chrome.screenshot({ path: path.join(destination, `${name}.png`) })
      if (!overlay) await cli('client.overlay', { client: client.id, visible: false })
    }
    await capture('split-panes')
    await chrome.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(chrome.getByRole('dialog', { name: 'Sessions', exact: true })).toBeVisible()
    await capture('switch-sessions', true)
    await chrome.getByRole('button', { name: 'Close', exact: true }).click()
    let before = (await cli('state')).model.clients.find((item: { id: string }) => item.id === client.id)
    await cli('type', { tab: bot.activeTabId, selector: '#task', text: 'Check the release notes' })
    await cli('click', { tab: bot.activeTabId, selector: '#add-task' })
    await cli('wait', { tab: bot.activeTabId, selector: '#agent-result', state: 'visible' })
    await cli('eval', { tab: bot.activeTabId, expression: 'document.querySelector("#agent-result").scrollIntoView({block: "nearest"}); true' })
    let after = (await cli('state')).model.clients.find((item: { id: string }) => item.id === client.id)
    expect(after.paneId).toBe(before.paneId)
    expect(after.paneId).toBe(pane.id)
    await capture('run-agent')
    await fs.writeFile(path.join(destination, 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), app: 'bmux', content: 'Local demonstration pages; real app UI and CLI operations.', viewport: await chrome.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })), checks: ['URL typed and submitted with Enter', 'Two native page views attached', 'Real session picker opened', 'CLI typed and clicked in a bot profile without changing selected pane'] }, null, 2))
  } finally {
    await application.close().catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
