import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import type { PublicState } from '../src/shared/types'

test('paid remote account connects a running computer and opens regional box checkout', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(),'bmux-paid-remote-')), config = path.join(directory,'config.yaml')
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let billingEmail: string | undefined
  let requests: { route: string; body: Record<string, unknown> }[] = [], views = [{ connection:'fixture-view', host:'fixture-host', generation:'fixture-generation', pane:'fixture-pane' }]
  let server = http.createServer((request,response) => {
    void (async () => {
      let json = (value: unknown) => { response.writeHead(200,{'Content-Type':'application/json'}); response.end(JSON.stringify(value)) }
      let route = request.url ?? '/', chunks: Buffer[] = []
      for await (let chunk of request) chunks.push(chunk)
      let body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      if (request.method === 'POST') requests.push({route,body})
      if (route === '/api/hosts') { json([]); return }
      if (route === '/api/me') { json({owner:'123456789',email:billingEmail}); return }
      if (route === '/api/billing/status') { json({enabled:true,relay:{active:true,monthlyCents:1000,currency:'usd',maxStreams:2,cancelRequested:false,status:'active'}}); return }
      if (route === '/api/billing/rates') { json({base:'USD',source:'ECB',date:'2026-10-23',rates:{USD:1,EUR:.9,GBP:.75,JPY:150,THB:35}}); return }
      if (route === '/api/rentals') { json([]); return }
      if (route === '/api/streams') { json(views); return }
      if (route === '/api/streams/disconnect') { views=[]; json({ok:true}); return }
      if (route === '/api/rentals/catalog') { json({enabled:true,quotes:[{id:'regional-quote',region:'fsn1',regionName:'Falkenstein',memoryGb:4,cores:2,diskGb:40,trafficBytes:20e12,monthlyCents:851,currency:'usd'}]}); return }
      if (route === '/api/rentals/checkout') { json({url:'https://checkout.stripe.com/c/pay/bmux-fixture'}); return }
      if (route === '/api/services') { json({service:body.service,key:'a'.repeat(64)}); return }
      if (route === '/api/services/revoke') { json({ok:true}); return }
      response.writeHead(200,{'Content-Type':'text/html'}); response.end('<!doctype html><title>Paid remote fixture</title><style>body{background:#dce7ef;font:24px system-ui;padding:30px}</style><h1>Persistent browser workspace</h1><input aria-label="Retained value" value="work continues">')
    })().catch(() => { response.writeHead(500); response.end() })
  })
  let sockets = new WebSocketServer({server,path:'/connect'})
  sockets.on('connection',(socket,request) => { socket.send(JSON.stringify({type:'ready',id:new URL(request.url!,'http://localhost').searchParams.get('host'),iceServers:[]})) })
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  let origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`
  try {
    await fs.writeFile(config,'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
    application = await electron.launch({args:[process.cwd()],env:{...process.env,BMUX_DATA_DIR:directory,BMUX_CONFIG:config,BMUX_REMOTE_URL:origin,BMUX_BACKGROUND:'0'}})
    let pid = application.process().pid
    await expect.poll(() => application!.context().pages().some(page => page.url().endsWith('/renderer/index.html'))).toBe(true)
    let chrome = application.context().pages().find(page => page.url().endsWith('/renderer/index.html'))!
    chrome.on('dialog',dialog => { void dialog.accept() })
    let state = (): Promise<PublicState> => chrome.evaluate(() => (window as any).bmux.state())
    let initial = await state(), client = initial.model.clients.find(item => item.id === initial.clientId)!
    await chrome.evaluate(client => (window as any).bmux.command({method:'activate-client',args:{client}}),client.id)
    await chrome.getByRole('button',{name:'Address',exact:true}).click()
    let address = chrome.getByRole('textbox',{name:'URL or search',exact:true})
    await address.fill(`${origin}/workspace`); await address.press('Enter')
    await expect.poll(() => application!.context().pages().some(page => page.url() === `${origin}/workspace`)).toBe(true)
    let page = application.context().pages().find(page => page.url() === `${origin}/workspace`)!
    await expect(page.getByRole('heading')).toHaveText('Persistent browser workspace')
    await page.getByRole('textbox').fill('Still running')
    await expect.poll(() => application!.evaluate(({BaseWindow},url) => BaseWindow.getAllWindows().filter(window => window.isVisible()).flatMap(window => window.contentView.children).some((view:any) => view.getVisible() && view.webContents?.getURL() === url && view.getBounds().height > 200),`${origin}/workspace`)).toBe(true)
    let profile = initial.model.sessions[0].windows[0].panes[0].profileId
    await application.evaluate(({session},{origin,profile}) => session.fromPartition(`persist:${profile}`).cookies.set({url:origin,name:'bmux_session',value:'b'.repeat(64),httpOnly:true}),{origin,profile})
    await chrome.getByRole('button',{name:'Command prompt',exact:true}).click()
    let command = chrome.getByRole('combobox',{name:'Command',exact:true}); await command.fill('settings'); await command.press('Enter')
    let settings = chrome.getByRole('dialog',{name:'Settings',exact:true})
    await settings.getByRole('tab',{name:'Account',exact:true}).click()
    await expect(settings.getByRole('button',{name:'Confirm billing email with Google',exact:true})).toBeVisible()
    billingEmail = 'pilot@example.com'
    await settings.getByRole('button',{name:'Close',exact:true}).click()
    await chrome.getByRole('button',{name:'Command prompt',exact:true}).click()
    await command.fill('settings'); await command.press('Enter')
    await expect(settings).toContainText('pilot@example.com')
    await expect(settings.getByRole('button',{name:'Confirm billing email with Google',exact:true})).toHaveCount(0)
    await settings.getByRole('combobox',{name:'Estimates in'}).selectOption('EUR')
    await expect(settings.getByLabel('Relay',{exact:true})).toContainText(/USD\s10\.00 \(≈ EUR\s9\.00\)/)
    await expect(settings).toContainText('Your bank sets the conversion rate')
    await settings.getByRole('button',{name:'Disconnect view',exact:true}).click()
    await expect(settings.getByRole('button',{name:'Disconnect view',exact:true})).toHaveCount(0)
    await settings.getByRole('button',{name:'Connect this computer',exact:true}).click()
    await expect(settings).toContainText('This computer: connected')
    expect(application.process().pid).toBe(pid)
    expect((await fs.stat(path.join(directory,'remote-enrollment.json'))).mode & 0o077).toBe(0)
    await settings.getByRole('button',{name:'Disconnect computer',exact:true}).click()
    await expect(settings.getByRole('button',{name:'Connect this computer',exact:true})).toBeVisible()
    await settings.getByRole('button',{name:'Close',exact:true}).click()
    await expect(page.getByRole('textbox')).toHaveValue('Still running')
    await chrome.getByRole('button',{name:'Sessions',exact:true}).click()
    let picker = chrome.getByRole('dialog',{name:'Sessions',exact:true})
    await picker.getByRole('tab',{name:'Remote'}).click(); await picker.getByRole('button',{name:'Add box',exact:true}).click()
    let form = picker.getByRole('form',{name:'Rent a box'})
    await picker.getByRole('combobox',{name:'Estimates in'}).selectOption('JPY')
    await expect(form.getByRole('combobox',{name:'Size and region'})).toContainText(/USD\s8\.51 \(≈ JPY\s1,277\)/)
    await expect(form).toContainText('Price includes IPv4 and our 20% service fee')
    await form.getByRole('textbox',{name:'Box name'}).fill('Research box')
    await form.getByRole('checkbox').check()
    await fs.mkdir(info.outputDir,{recursive:true}); await chrome.screenshot({path:info.outputPath('rent-box.png')})
    await application.context().route('https://checkout.stripe.com/**',route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Test checkout</title><h1>Test checkout</h1>'}))
    await form.getByRole('button',{name:/Continue to checkout · USD\s8\.51\/month/}).click()
    await expect.poll(() => application!.context().pages().some(page => page.url().startsWith('https://checkout.stripe.com/'))).toBe(true)
    expect(requests.find(item => item.route === '/api/rentals/checkout')?.body).toMatchObject({name:'Research box',quoteId:'regional-quote',acceptedTerms:true,sshKeys:[]})
    expect(requests.filter(item => item.route === '/api/services')).toHaveLength(1)
    expect(requests.filter(item => item.route === '/api/services/revoke')).toHaveLength(1)
  } finally {
    await closeTestApplication(application)
    for (let socket of sockets.clients) socket.terminate(); sockets.close(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory,{recursive:true,force:true})
  }
})
