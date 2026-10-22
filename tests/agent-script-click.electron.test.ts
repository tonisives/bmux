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

test('script clicks move the cursor before clicking and preserve synchronous script order', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-script-click-'))
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(`<!doctype html><title>Script click fixture</title><style>body{font:20px system-ui;padding:70px;background:#202833;color:white}main{padding:30px}button{margin:30px 100px 30px 0;padding:20px}</style><main><h1>Script click feedback</h1><button id="first">First</button><button id="second">Second</button><output>0</output></main><script>window.originalClick=HTMLElement.prototype.click;window.clicks=[];for(let button of document.querySelectorAll('button'))button.onclick=event=>{let pointer=document.getElementById('bmux-virtual-mouse');clicks.push({id:button.id,at:Date.now(),position:pointer?.style.transform,trusted:event.isTrusted});document.querySelector('output').textContent=String(clicks.length);};</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    let plugin = path.join(directory, 'plugins/script-test')
    await fs.mkdir(plugin, { recursive: true })
    await fs.writeFile(path.join(plugin, 'plugin.yaml'), stringify({ schema_version: 1, id: 'script-test', name: 'Script clicks', version: '1', actions: [{ id: 'click', title: 'Script click', command: ['node', './click.mjs'], capabilities: ['browser.write'] }] }))
    await fs.writeFile(path.join(plugin, 'click.mjs'), `import {execFileSync} from 'node:child_process';execFileSync(process.env.BMUX_CLI,['plugin','host','eval','--stdin'],{input:JSON.stringify({expression:"document.querySelector('#first').click()"}),stdio:['pipe','pipe','pipe']});`)
    await fs.writeFile(path.join(directory, 'config.yaml'), stringify({ vimEditing: false, browser: { adblock: false, autoUpdateFilters: false }, keyboard: {}, automation: { safety: { enabled: false } }, plugins: { 'script-test': { enabled: true } } }))
    application = await electron.launch({ args: [process.cwd()], env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_CONFIG: path.join(directory, 'config.yaml'), BMUX_BACKGROUND: '0' } })
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html')), { timeout: 15000 }).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string, unknown> = {}) => chrome.evaluate(({ method, args }) => (window as any).bmux.command({ method, args }), { method, args })
    let cli = async (method: string, args: Record<string, unknown>) => {
      let result = await exec(process.execPath, [path.resolve('bin/bmux.mjs'), 'rpc', method, JSON.stringify(args)], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: 'script-agent' }, timeout: 20000 })
      let value = JSON.parse(result.stdout); expect(value.ok, value.error).toBe(true); return value.result
    }
    let state = await chrome.evaluate(() => (window as any).bmux.state()), client = state.model.clients.find((item: any) => item.id === state.clientId), pane = client.paneId
    await rpc('activate-client', { client: client.id })
    await chrome.getByRole('button', { name: 'Address', exact: true }).click()
    let address = chrome.getByRole('textbox', { name: 'URL or search', exact: true })
    await address.fill(url); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === url)).toBe(true)
    let page = application.context().pages().find(page => page.url() === url)!, pointer = page.locator('#bmux-virtual-mouse')
    await expect(page.locator('h1')).toBeVisible()
    await expect.poll(() => application!.evaluate(({ BaseWindow }, url) => BaseWindow.getAllWindows().some(window => window.isVisible() && window.contentView.children.some((view: any) => view.webContents?.getURL() === url && view.getBounds().height > 100)), url)).toBe(true)
    expect(await cli('eval', { pane, expression: 'document.title' })).toBe('Script click fixture')
    await expect(pointer).toHaveCount(0)
    let expression = `(() => { window.started=Date.now(); let result=[]; for(let id of ['first','second']) { document.getElementById(id).click(); result.push(document.querySelector('output').textContent); } return result; })()`
    let clicking = cli('eval', { pane, expression })
    await expect(pointer).toBeVisible()
    await expect(page.locator('output')).toHaveText('0')
    await fs.mkdir('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/script-click-moving.png' })
    expect(await clicking).toEqual(['1', '2'])
    let clicks = await page.evaluate(() => (window as any).clicks)
    expect(clicks[0].at - await page.evaluate(() => (window as any).started)).toBeGreaterThanOrEqual(790)
    expect(clicks[1].at - clicks[0].at).toBeGreaterThanOrEqual(790)
    for (let click of clicks) {
      let target = await page.locator(`#${click.id}`).boundingBox()
      let values = click.position.match(/translate\(([^p]+)px,([^p]+)px\)/)
      expect(Number(values[1])).toBeCloseTo(target!.x + target!.width / 2)
      expect(Number(values[2])).toBeCloseTo(target!.y + target!.height / 2)
      expect(click.trusted).toBe(false)
    }
    await cli('cdp', { pane, method: 'Runtime.evaluate', params: { expression: "document.querySelector('#first').click()" } })
    let object = await cli('cdp', { pane, method: 'Runtime.evaluate', params: { expression: 'globalThis' } })
    await cli('cdp', { pane, method: 'Runtime.callFunctionOn', params: { objectId: object.result.objectId, functionDeclaration: "function() { document.querySelector('#second').click() }" } })
    await cli('cdp', { pane, method: 'Runtime.releaseObject', params: { objectId: object.result.objectId } })
    let run = await rpc('plugin.run', { action: 'script-test/click' })
    await expect.poll(async () => (await rpc('plugin.runs')).find((item: any) => item.id === run.id)?.status, { timeout: 20000 }).toBe('completed')
    await expect(page.locator('output')).toHaveText('5')
    expect(await page.evaluate(() => HTMLElement.prototype.click === (window as any).originalClick)).toBe(true)
    // Human navigation can interrupt the pre-click movement without sending the
    // old click into either document or leaving JavaScript paused.
    let interrupted = cli('eval', { pane, expression: "window.attemptingClick=true; document.querySelector('#first').click()" }).then(() => true, () => false)
    await expect.poll(() => page.evaluate(() => (window as any).attemptingClick)).toBe(true)
    await rpc('navigate', { pane, url: `${url}?replacement`, waitUntil: 'none' })
    await expect(page).toHaveURL(`${url}?replacement`)
    expect(await interrupted).toBe(false)
    await expect(page.locator('output')).toHaveText('0')
    expect(await page.evaluate(() => HTMLElement.prototype.click === (window as any).originalClick)).toBe(true)
  } finally {
    await closeTestApplication(application)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
