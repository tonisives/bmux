import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stringify } from 'yaml'

test('plugin pacing skips generic delays and owns its website between commands until cancellation', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-plugin-pacing-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Pacing fixture</title><main>Visible fixture</main>') })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let url = `http://x.com:${(server.address() as { port: number }).port}/fixture`
    let folder = path.join(directory, 'plugins', 'test')
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'plugin.yaml'), stringify({ schema_version: 1, id: 'test', name: 'Pacing fixture', version: '1', actions: [{ id: 'browse', title: 'Browse', pacing: 'plugin', command: ['node', './run.mjs'], capabilities: ['browser.read', 'browser.write'] }] }))
    await fs.writeFile(path.join(folder, 'run.mjs'), `import { execFileSync } from 'node:child_process';
let call=(method,args={})=>{let value=JSON.parse(execFileSync(process.env.BMUX_CLI,['plugin','host',method,'--stdin'],{input:JSON.stringify(args),encoding:'utf8',stdio:['pipe','pipe','pipe']}));if(!value.ok)throw new Error(value.error);return value.result};
let start=Date.now();
call('eval',{expression:'document.body.dataset.pacing="first"'});
call('eval',{expression:'document.body.dataset.pacing="second"'});
call('dom');
call('progress',{percent:50,message:String(Date.now()-start)});
await new Promise(resolve=>setTimeout(resolve,30000));
call('result',{done:true});`)
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ plugins: { test: { enabled: true } }, keyboard: {}, vimEditing: false, browser: { adblock: false, autoUpdateFilters: false }, agentFeedback: { actionDelayMinMs: 10000, actionDelayMaxMs: 10000 }, automation: { safety: { enabled: true, socialDelayMs: 30000 } } }))
    application = await electron.launch({ args: [process.cwd(), '--no-proxy-server', '--host-resolver-rules=MAP x.com 127.0.0.1'], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let command = (method: string, args: Record<string, unknown> = {}): Promise<any> => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let state = await chrome.evaluate(() => (window as any).bmux.state()), pane = state.model.sessions[0].windows[0].panes[0]
    await command('navigate', { pane: pane.id, url })
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('main')).toHaveText('Visible fixture')
    let run = await command('plugin.run', { action: 'test/browse', pane: pane.id })
    let current = () => command('plugin.runs').then(runs => runs.find((item: any) => item.id === run.id))
    await expect.poll(async () => (await current())?.progress?.percent, { timeout: 12000 }).toBe(50)
    expect(Number((await current()).progress.message)).toBeLessThan(8000)
    expect(await page.evaluate(() => document.body.dataset.pacing)).toBe('second')
    let cli = async () => {
      let result = await promisify(execFile)(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', 'eval', JSON.stringify({ pane: pane.id, expression: 'document.title', observation: true })], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'other-agent' }, timeout: 12000 }).catch(error => {
        if (error.code === 1 && error.stdout) return { stdout: error.stdout }
        throw error
      })
      return JSON.parse(result.stdout)
    }
    let denied = await cli()
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('Website is busy')
    await command('plugin.cancel', { id: run.id })
    await expect.poll(async () => (await current()).status).toBe('cancelled')
    let allowed = await cli()
    expect(allowed.ok, allowed.error).toBe(true)
    expect(allowed.result).toBe('Pacing fixture')
  } finally {
    await closeTestApplication(application).catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
