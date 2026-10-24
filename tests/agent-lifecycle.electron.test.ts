import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'

test('closed panes never pass queued agent commands or input locks to a reused pane ID', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-agent-lifecycle-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let queued: Promise<any> | undefined
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>Human tab</title><h1>Human tab</h1><input aria-label="Page input">')
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ vimEditing: false, keyboard: {}, browser: { adblock: false, autoUpdateFilters: false } }))
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = () => chrome.evaluate(() => (window as any).bmux.state())
    let cli = async (method: string, args: Record<string, unknown> = {}) => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'original-agent' }, timeout: 30000, maxBuffer: 16 * 1024 * 1024 }).catch(error => {
        if (error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    let initial = await state(), client = initial.model.clients.find((item: any) => item.id === initial.clientId), anchor = client.paneId
    await rpc('activate-client', { client: client.id })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(`${url}/anchor`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}/anchor`)).toBe(true)
    let old = await rpc('split-window', { pane: anchor, url: `${url}/old` })
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}/old`)).toBe(true)
    await expect(application.context().pages().find(page => page.url() === `${url}/old`)!.getByRole('heading')).toHaveText('Human tab')
    let input = { pane: anchor, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Shift', code: 'ShiftLeft' } }
    expect((await cli('cdp', input)).ok).toBe(true)
    // Hold the shared domain in another pane so closing this target cannot release the queue.
    queued = cli('eval', { pane: old.id, expression: 'window.staleAgentCommandRan = true', agentName: 'Original tab agent' })
    await expect.poll(async () => (await state()).activeAgents.find((actor: any) => actor.paneId === old.id)?.pending).toBe(1)
    expect(await rpc('kill-pane', { pane: old.id })).toEqual({ closed: old.id })
    let replacement = await rpc('split-window', { pane: anchor, client: client.id, url: `${url}/replacement` })
    expect(replacement.id).toBe(old.id)
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${url}/replacement`)).toBe(true)
    let page = application.context().pages().find(page => page.url() === `${url}/replacement`)!
    await expect(page.getByRole('heading')).toHaveText('Human tab')
    expect((await state()).lockedAgentPanes).not.toContain(replacement.id)
    expect((await cli('cdp', { ...input, params: { ...input.params, type: 'keyUp' } })).ok).toBe(true)
    expect(await queued).toMatchObject({ ok: false, error: expect.stringContaining('closed or replaced') })
    queued = undefined
    expect(await page.evaluate(() => (window as any).staleAgentCommandRan)).toBeUndefined()
    // Metadata commands carrying an agent identity do not claim the replacement page.
    for (let method of ['status', 'list-panes']) expect((await cli(method, { pane: replacement.id, window: client.windowId })).ok).toBe(true)
    let after = await state()
    expect(after.lockedAgentPanes).not.toContain(replacement.id)
    expect(after.activeAgents.find((actor: any) => actor.paneId === replacement.id)).toBeUndefined()
    let pane = after.model.sessions.flatMap((session: any) => session.windows.flatMap((window: any) => window.panes)).find((pane: any) => pane.id === replacement.id)
    expect(pane.agentId).toBeUndefined()
    await rpc('focus-page', { client: client.id })
    await page.getByRole('textbox', { name: 'Page input' }).click()
    await page.keyboard.type('human input')
    await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('human input')
  } finally {
    await closeTestApplication(application)
    await queued?.catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
