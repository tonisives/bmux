import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'
import { controlSocketPath } from '../bin/ipc.mjs'

let exec = promisify(execFile)

test('human input updates immediately without agent feedback, identity, locks or bot limits', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-human-input-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Human editor</title><textarea id="editor"></textarea><output id="model"></output><script>editor.addEventListener("input", event => { model.textContent = editor.value; window.trustedInput = event.isTrusted })</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://one.example.test:${(server.address() as { port: number }).port}/`
  let socket = (command: object) => new Promise<any>((resolve, reject) => {
    let connection = net.createConnection(controlSocketPath(directory)), input = ''
    connection.setEncoding('utf8'); connection.setTimeout(8000, () => connection.destroy(new Error('Human input waited for automation pacing')))
    connection.on('error', reject)
    connection.on('connect', () => connection.write(`${JSON.stringify(command)}\n`))
    connection.on('data', chunk => { input += chunk; if (input.includes('\n')) { connection.destroy(); resolve(JSON.parse(input)) } })
  })
  try {
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ vimEditing: false, browser: { adblock: false, autoUpdateFilters: false }, keyboard: {}, agentFeedback: { actionDelayMinMs: 20000, actionDelayMaxMs: 20000 }, automation: { agents: { requireId: true, requireType: true }, safety: { enabled: true, socialDelayMs: 20000 } } }))
    let startedAt = Date.now() - 11 * 60_000
    await fs.writeFile(path.join(directory, 'automation-safety.json'), JSON.stringify({ fixture: { profileId: 'profile_default', siteHost: 'one.example.test', startedAt, lastUsed: startedAt + 1000, activeMs: 600_000, limitReachedAt: startedAt + 600_000 } }))
    application = await electron.launch({ args: [process.cwd(), '--no-proxy-server', '--host-resolver-rules=MAP *.example.test 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0', BMUX_DEFAULT_AGENT_ID: 'default-agent-must-not-leak' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let initial = await state(), client = initial.model.clients.find((value: any) => value.id === initial.clientId), pane = client.paneId
    await chrome.evaluate(client => (window as any).bmux.command({ method: 'activate-client', args: { client } }), client.id)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.locator('#editor')).toBeVisible()
    await page.evaluate(() => {
      let overlays: string[] = []; (window as any).humanOverlays = overlays
      new MutationObserver(records => {
        for (let record of records) for (let node of record.addedNodes) {
          if (node instanceof Element) for (let element of [node, ...node.querySelectorAll('[id]')]) if (/^bmux-(agent-|virtual-mouse)/.test(element.id)) overlays.push(element.id)
        }
      }).observe(document.documentElement, { childList: true, subtree: true })
    })
    let before = await state()
    let human = async (method: string, args: Record<string, unknown> = {}) => {
      let response = await socket({ method, args: { pane, ...args }, inputSource: 'human' })
      expect(response.ok, response.error).toBe(true)
      return response.result
    }
    expect(await human('input.capabilities')).toEqual({ human: true })
    let started = Date.now()
    await human('eval', { expression: 'document.querySelector("textarea").focus(); "ready"', agentId: 'ignored', agentType: 'invalid' })
    for (let text of ['first', 'second', 'ไทย']) {
      await human('eval', { expression: 'document.querySelector("textarea").select()' })
      await human('type', { text })
      expect(await human('eval', { expression: 'document.querySelector("output").textContent' })).toBe(text)
    }
    await human('key', { key: 'Backspace' })
    await human('cdp', { method: 'Input.insertText', params: { text: 'x' } })
    expect(Date.now() - started).toBeLessThan(8000)
    expect(await page.evaluate(() => (window as any).trustedInput)).toBe(true)
    let { stdout } = await exec(process.execPath, [path.resolve('bin/bmux.mjs'), '--no-lock', 'eval', '-t', pane, 'document.title'], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'inherited', BMUX_AGENT_DATA: 'invalid', TMUX: '/missing/tmux', CODEX_THREAD_ID: 'inherited-thread' }, timeout: 8000 })
    expect(JSON.parse(stdout)).toEqual({ ok: true, result: 'Human editor' })
    expect(await page.evaluate(() => (window as any).humanOverlays)).toEqual([])
    let after = await state()
    expect(after.activeAgents).toEqual(before.activeAgents)
    expect(after.lockedAgentPanes).toEqual(before.lockedAgentPanes)
    expect(after.automationSafety.profiles).toEqual(before.automationSafety.profiles)
    expect(after.model.clients.find((value: any) => value.id === client.id)).toMatchObject({ paneId: client.paneId, windowId: client.windowId })
    expect(await socket({ method: 'eval', args: { pane, expression: 'document.title', inputSource: 'human' } })).toMatchObject({ ok: false, error: expect.stringContaining('Agent type required') })
    let rejected = await chrome.evaluate(command => (window as any).bmux.command(command).catch((error: Error) => error.message), { method: 'eval', args: { pane, expression: 'document.title' }, inputSource: 'human' })
    expect(rejected).toContain('local control socket')
  } finally {
    await closeTestApplication(application)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
