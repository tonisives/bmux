import { test, expect, _electron as electron } from '@playwright/test'
import { build } from 'vite'
import { externalizeDepsPlugin } from 'electron-vite'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pageVimPlugin } from '../page-vim-build'
import { closeTestApplication } from './electron-fixture'

test('account seal rejects identity edits and preserves browser headers and viewport after relaunch', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-account-seal-electron-')), output = path.join(directory, 'build')
  await fs.mkdir(output); await fs.writeFile(path.join(output, 'package.json'), '{"type":"module"}')
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(output, 'node_modules'))
  for (let name of ['preload','renderer','native']) await fs.symlink(path.join(process.cwd(), 'out', name), path.join(output, name))
  await build({ configFile: false, logLevel: 'error', plugins: [externalizeDepsPlugin(), pageVimPlugin()], build: { ssr: true, emptyOutDir: false, outDir: path.join(output, 'main'), rollupOptions: { input: 'tests/fixtures/remote-layout-main.ts', output: { format: 'es', entryFileNames: 'main.js' } } } })
  let headers: string[] = []
  let server = http.createServer((request, response) => { headers.push(request.headers['user-agent'] ?? ''); response.setHeader('Content-Type','text/html'); response.end('<!doctype html><title>Account seal fixture</title><h1>Account seal fixture</h1>') })
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  let url = `http://127.0.0.1:${(server.address() as {port:number}).port}/`, data = path.join(directory,'profile')
  await fs.mkdir(data); await fs.writeFile(path.join(data,'config.yaml'),'browser:\n  autoUpdateFilters: false\n')
  let launch = () => electron.launch({ args: [path.join(output,'main/main.js')], env: { ...process.env, BMUX_DATA_DIR:data, BMUX_CONFIG:path.join(data,'config.yaml') } })
  let application = await launch()
  try {
    await expect.poll(() => application.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    let rpc = (method: string, args: Record<string,unknown>) => chrome.evaluate(({method,args}) => (window as any).bmux.command({method,args}), {method,args})
    let state = await chrome.evaluate(() => (window as any).bmux.state()), client = state.model.clients.find((item: any) => item.id === state.clientId)
    await rpc('navigate',{pane:client.paneId,url})
    await expect.poll(() => application.context().pages().some(page => page.url()===url)).toBe(true)
    await rpc('lock-window',{window:client.windowId}); await rpc('lock-viewport',{window:client.windowId,width:1200,height:800})
    let receipt = await application.evaluate(async () => {
      let runtime = (globalThis as any).remoteLayoutRuntime, session = runtime.model.sessions[0], window = session.windows[0], pane = window.panes[0]
      let identity = {sessionId:session.id,windowId:window.id,paneId:pane.id,profileId:pane.profileId,connectionId:pane.connectionId??pane.profileId,viewport:window.lockedViewports[pane.id],locked:true,network:'direct',settingsHash:''}
      // The settings digest comes from the same finite fixture model as production.
      let { createHash } = await import('node:crypto')
      identity.settingsHash = createHash('sha256').update(JSON.stringify({device:null,proxy:null})).digest('hex')
      return runtime.accounts.seal('10000000-0000-4000-8000-000000000001',identity)
    })
    expect(receipt.headersHash).toMatch(/^[a-f0-9]{64}$/)
    for (let [method,args] of [['unlock-window',{window:client.windowId}],['unlock-viewport',{window:client.windowId}],['lock-viewport',{window:client.windowId,width:800,height:600}],['pane.proxy.set',{pane:client.paneId,profile:client.profileId}],['kill-window',{window:client.windowId,confirm:true}],['cdp',{pane:client.paneId,method:'Network.setExtraHTTPHeaders',params:{headers:{'User-Agent':'changed'}}}]] as const) await expect(rpc(method,args)).rejects.toThrow('ACCOUNT_IDENTITY_SEALED')
    let page = application.context().pages().find(page => page.url()===url)!
    await expect.poll(() => page.evaluate(() => ({width:innerWidth,height:innerHeight}))).toEqual({width:1200,height:800})
    let userAgent = await page.evaluate(() => navigator.userAgent)
    await closeTestApplication(application); application = await launch()
    await expect.poll(() => application.context().pages().some(page => page.url()===url),{timeout:15000}).toBe(true)
    page = application.context().pages().find(page => page.url()===url)!
    await expect.poll(() => page.evaluate(() => ({width:innerWidth,height:innerHeight,userAgent:navigator.userAgent}))).toEqual({width:1200,height:800,userAgent})
    expect(headers.length).toBeGreaterThan(1); expect(new Set(headers)).toEqual(new Set([userAgent]))
    expect(await application.evaluate(() => Object.keys((globalThis as any).remoteLayoutRuntime.model.accountSeals).length)).toBe(1)
  } finally { await closeTestApplication(application); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory,{recursive:true,force:true}) }
})
