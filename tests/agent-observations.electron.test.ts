import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'

let exec = promisify(execFile)
test('feed observations return during held input and releases retain the next action cooldown', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-observations-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Observed post</title><main>Observed post</main>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ vimEditing: false, browser: { adblock: false, autoUpdateFilters: false }, keyboard: {}, agentFeedback: { actionDelayMinMs: 2000, actionDelayMaxMs: 2000 }, automation: { safety: { enabled: true, socialDelayMs: 5000 } } }))
    application = await electron.launch({ args: [process.cwd(), '--no-proxy-server'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let state = await chrome.evaluate(() => (window as any).bmux.state()), client = state.model.clients.find((value: any) => value.id === state.clientId), pane = client.paneId
    await chrome.evaluate(client => (window as any).bmux.command({ method: 'activate-client', args: { client } }), client.id)
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('main')).toHaveText('Observed post')
    let cli = async (method: string, args: Record<string, unknown>) => {
      let response = await exec(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', method, JSON.stringify({ pane, ...args })], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'observation-agent' }, timeout: 18000 })
      let value = JSON.parse(response.stdout); expect(value.ok, value.error).toBe(true); return value.result
    }
    let key = { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Shift', code: 'ShiftLeft' } }
    await cli('cdp', key)
    let queued = cli('eval', { expression: 'window.followingAction = true' }), completed = false
    void queued.then(() => { completed = true }, () => undefined)
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        let observed = await Promise.race([cli('eval', { expression: '({ title: document.title, following: !!window.followingAction })', observation: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Observation waited for held input')), 4000) })])
        expect(observed).toEqual({ title: 'Observed post', following: false })
      } finally { clearTimeout(timer) }
      expect(completed).toBe(false)
    } finally { await cli('cdp', { ...key, params: { ...key.params, type: 'keyUp' } }) }
    // Key-up has landed, while native-action serialization and pacing remain active.
    expect(completed).toBe(false)
    expect(await page.evaluate(() => !!(window as any).followingAction)).toBe(false)
    await queued
    expect(await page.evaluate(() => (window as any).followingAction)).toBe(true)
  } finally {
    await closeTestApplication(application).catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
