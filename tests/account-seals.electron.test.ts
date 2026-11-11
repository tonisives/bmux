import { createHash } from 'node:crypto'
import { test, expect, _electron as electron } from '@playwright/test'
import { build } from 'vite'
import { externalizeDepsPlugin } from 'electron-vite'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pageVimPlugin } from '../page-vim-build'
import { closeTestApplication } from './electron-fixture'

test('account seal rejects identity edits and preserves browser headers and viewport after relaunch', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-account-seal-electron-')), output = path.join(directory, 'build')
  await fs.mkdir(output); await fs.writeFile(path.join(output, 'package.json'), '{"type":"module"}')
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(output, 'node_modules'))
  for (let name of ['preload','renderer','native']) await fs.symlink(path.join(process.cwd(), 'out', name), path.join(output, name))
  await fs.symlink(path.join(process.cwd(), 'bin'), path.join(output, 'bin'))
  await build({ configFile: false, logLevel: 'error', plugins: [externalizeDepsPlugin(), pageVimPlugin()], build: { ssr: true, emptyOutDir: false, outDir: path.join(output, 'main'), rollupOptions: { input: 'tests/fixtures/remote-layout-main.ts', output: { format: 'es', entryFileNames: 'main.js' } } } })
  let headers: string[] = []
  let server = http.createServer((request, response) => { headers.push(request.headers['user-agent'] ?? ''); response.setHeader('Content-Type','text/html'); response.end('<!doctype html><title>Account seal fixture</title><h1 onclick="document.body.dataset.clicked=1">Account seal fixture</h1>') })
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  let url = `http://www.tiktok.com:${(server.address() as {port:number}).port}/`, data = path.join(directory,'profile')
  let plugin = path.join(data, 'plugins', 'fixture'), marker = path.join(data, 'job-starts')
  await fs.mkdir(plugin, { recursive: true }); await fs.writeFile(path.join(data,'config.yaml'), JSON.stringify({ browser: { autoUpdateFilters: false }, plugins: { 'bmux.tiktok': { enabled: true } } }))
  await fs.writeFile(path.join(plugin, 'plugin.yaml'), JSON.stringify({ schema_version: 1, id: 'bmux.tiktok', name: 'Local account job fixture', version: '1', category: 'Social Media', actions: [{ id: 'publish-post', title: 'Publish fixture', command: [process.execPath, './run.mjs'], capabilities: ['browser.read','browser.write'], parameters: [{ name: 'hold', title: 'Hold', kind: 'boolean' }], timeout_seconds: 60 }] }))
  await fs.writeFile(path.join(plugin, 'run.mjs'), `import {execFileSync} from 'node:child_process'; import fs from 'node:fs'; let host=(method,args={})=>JSON.parse(execFileSync(process.env.BMUX_CLI,['plugin','host',method,'--stdin'],{input:JSON.stringify(args),encoding:'utf8'})).result; let context=host('context'); host('click',{selector:'h1'}); fs.appendFileSync(${JSON.stringify(marker)},'started\\n'); if(context.parameters.hold)await new Promise(resolve=>setTimeout(resolve,30000));`)
  // The social hostname resolves only to this disposable local fixture server.
  let launch = () => electron.launch({ args: ['--no-proxy-server','--host-resolver-rules=MAP www.tiktok.com 127.0.0.1',path.join(output,'main/main.js')], env: { ...process.env, BMUX_DATA_DIR:data, BMUX_CONFIG:path.join(data,'config.yaml') } })
  let application = await launch(), stderr = ''
  let track = () => application.process().stderr?.on('data', value => { stderr += value.toString() })
  track()
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string,unknown>) => chrome.evaluate(({method,args}) => (window as any).bmux.command({method,args}), {method,args})
    await expect.poll(async () => (await rpc('plugin.list', {})).find((plugin: any) => plugin.id === 'bmux.tiktok')?.enabled).toBe(true)
    let state = await chrome.evaluate(() => (window as any).bmux.state()), client = state.model.clients.find((item: any) => item.id === state.clientId)
    await rpc('navigate',{pane:client.paneId,url})
    await expect.poll(() => application.context().pages().some(page => page.url()===url)).toBe(true)
    await expect(application.context().pages().find(page => page.url()===url)!.getByRole('heading')).toHaveText('Account seal fixture')
    await rpc('lock-window',{window:client.windowId}); await rpc('lock-viewport',{window:client.windowId,width:1200,height:800})
    let receipt = await application.evaluate(async (_electron, settingsHash) => {
      let runtime = (globalThis as any).remoteLayoutRuntime, session = runtime.model.sessions[0], window = session.windows[0], pane = window.panes[0]
      let identity = {sessionId:session.id,windowId:window.id,paneId:pane.id,profileId:pane.profileId,connectionId:pane.connectionId??pane.profileId,viewport:window.lockedViewports[pane.id],locked:true,network:'direct',settingsHash}
      return runtime.accounts.seal('10000000-0000-4000-8000-000000000001',identity)
    }, createHash('sha256').update(JSON.stringify({device:null,proxy:null})).digest('hex'))
    expect(receipt.headersHash).toMatch(/^[a-f0-9]{64}$/)
    for (let [method,args] of [['unlock-window',{window:client.windowId}],['unlock-viewport',{window:client.windowId}],['lock-viewport',{window:client.windowId,width:800,height:600}],['pane.proxy.set',{pane:client.paneId,profile:client.profileId}],['kill-window',{window:client.windowId,confirm:true}],['cdp',{pane:client.paneId,method:'Network.setExtraHTTPHeaders',params:{headers:{'User-Agent':'changed'}}}]] as const) await expect(rpc(method,args)).rejects.toThrow('ACCOUNT_IDENTITY_SEALED')
    let page = application.context().pages().find(page => page.url()===url)!
    await expect.poll(() => page.evaluate(() => ({width:innerWidth,height:innerHeight}))).toEqual({width:1200,height:800})
    let userAgent = await page.evaluate(() => navigator.userAgent)
    await expect(rpc('navigate',{pane:client.paneId,url})).rejects.toThrow('ACCOUNT_CONTROL_REQUIRED')
    await application.evaluate(async (_electron, {session,pane}) => {
      let runtime = (globalThis as any).remoteLayoutRuntime
      let lease = runtime.remote.acquire(session,'fixture-owner',false)
      try { runtime.remote.acquire(session,'competing-owner',true); throw new Error('A competing controller acquired the sealed session') } catch (error) { if ((error as Error).message !== 'CONTROL_HELD') throw error }
      await runtime.remote.command('fixture-owner',lease.generation,{method:'click',args:{pane,selector:'h1'}})
      runtime.remote.release(session,'fixture-owner')
    }, {session:client.sessionId,pane:client.paneId,url})
    await expect.poll(() => page.evaluate(() => document.body.dataset.clicked)).toBe('1')
    let job = await application.evaluate(async (_electron, pane) => {
      let runtime = (globalThis as any).remoteLayoutRuntime, seal = runtime.model.accountSeals[pane]
      let job = { id: '30000000-0000-4000-8000-000000000001', account: seal.account, identity: seal.identity, action: 'bmux.tiktok/publish-post', inputs: { hold: true }, deadline: Date.now() + 60000 }
      await runtime.accounts.jobs.accept(job, () => true); await runtime.accounts.jobs.accept(job, () => true)
      try { runtime.remote.acquire(seal.identity.sessionId, 'competing-owner', true); throw new Error('Competing controller acquired job lease') } catch (error) { if ((error as Error).message !== 'CONTROL_HELD') throw error }
      return job
    }, client.paneId)
    await expect.poll(async () => (await fs.readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length).toBe(1)
    await application.evaluate(async (_electron, id) => (globalThis as any).remoteLayoutRuntime.accounts.jobs.cancel(id), job.id)
    expect((await fs.readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1)

    await closeTestApplication(application); await info.attach('sealed-state',{body:await fs.readFile(path.join(data,'state.json')),contentType:'application/json'}); application = await launch(); track()
    await expect.poll(() => application.context().pages().some(page => page.url()===url),{timeout:15000}).toBe(true)
    page = application.context().pages().find(page => page.url()===url)!
    await expect.poll(() => page.evaluate(() => ({width:innerWidth,height:innerHeight,userAgent:navigator.userAgent}))).toEqual({width:1200,height:800,userAgent})
    expect(headers.length).toBeGreaterThan(1); expect(new Set(headers)).toEqual(new Set([userAgent]))
    expect(await application.evaluate(() => Object.keys((globalThis as any).remoteLayoutRuntime.model.accountSeals).length)).toBe(1)
    expect(await application.evaluate(async (_electron, job) => (await (globalThis as any).remoteLayoutRuntime.accounts.jobs.accept(job, () => true)).status, job)).toBe('cancelled')
    expect((await fs.readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1)
  } finally { await info.attach('electron-stderr',{body:stderr,contentType:'text/plain'}); await info.attach('restored-state',{body:JSON.stringify(await application.evaluate(() => { let runtime = (globalThis as any).remoteLayoutRuntime; return runtime ? {model:runtime.model,crashes:runtime.state().crashes} : {missingRuntime:true} }).catch(() => ({}))),contentType:'application/json'}); await closeTestApplication(application); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory,{recursive:true,force:true}) }
})
