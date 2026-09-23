import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { stringify } from 'yaml'

test('a site plugin owns a lease while direct agent commands are denied', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-automation-ui-'))
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Automation fixture</title><main>Visible fixture page</main>') })
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://127.0.0.1:${(server.address() as any).port}/fixture`
    let folder = path.join(directory, 'plugins', 'test')
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Automation fixture', version: '1', actions: [{ id: 'browse', title: 'Browse', command: ['node', './run.mjs'], capabilities: ['browser.read'] }] }))
    await fs.writeFile(path.join(folder, 'run.mjs'), `import { execFileSync } from 'node:child_process'; let call = (method,args={}) => JSON.parse(execFileSync(process.env.BMUX_CLI,['plugin','host',method,'--stdin'],{input:JSON.stringify(args),encoding:'utf8'})).result; let context = call('context'); call('automation.acquire',{url:context.url}); let page = call('dom'); call('result',{read:page.content.includes('Visible fixture page')});`)
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ keyboard: {}, plugins: { test: { enabled: true, hooks: false } }, automation: { groups: { fixture: { profiles: ['profile_default'], hosts: ['127.0.0.1'], maxConcurrent: 1, hourly: { runs: 1 }, requiredPlugins: { '127.0.0.1': 'test' } } } } }))
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state())
    let pane = state.model.sessions[0].windows[0].panes[0]
    await command('navigate', { tab: pane.activeTabId, url })
    await command('wait', { tab: pane.activeTabId, selector: 'main' })
    let cli = (args: string[]) => JSON.parse(spawnSync(process.execPath, [path.resolve('bin/bmux.mjs'), ...args], { env: { ...process.env, BMUX_DATA_DIR: directory }, encoding: 'utf8' }).stdout)
    expect(cli(['dom', '-t', pane.id]).ok).toBe(false)
    let run = await command('plugin.run', { action: 'test/browse', tab: pane.activeTabId })
    await expect.poll(async () => (await command('plugin.runs') as any[]).find(item => item.id === run.id)?.status).toBe('completed')
    expect((await command('plugin.runs') as any[]).find(item => item.id === run.id)?.result).toEqual({ read: true })
    expect(cli(['automation', 'status']).result[0]?.group).toBe('fixture')
  } finally {
    await application?.close().catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
