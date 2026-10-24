import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import type { PublicState } from '../src/shared/types'
import type { RentedBox } from '../src/shared/remote-account'

test('paid remote account connects a running computer and opens regional box checkout', async ({}, info) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(),'bmux-paid-remote-')), config = path.join(directory,'config.yaml')
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let billingEmail: string | undefined
  let catalogFailed = false, rentals: RentedBox[] = []
  let quote = {id:'regional-quote',region:'fsn1',regionName:'Falkenstein',memoryGb:4,cores:2,diskGb:40,trafficBytes:20e12,monthlyCents:851,currency:'usd'}
  let checkoutUrl = 'https://checkout.stripe.com/c/pay/bmux-fixture'
  let requests: { route: string; body: Record<string, unknown> }[] = [], views = [{ connection:'fixture-view', host:'fixture-host', generation:'fixture-generation', pane:'fixture-pane' }]
  let server = http.createServer((request,response) => {
    void (async () => {
      let json = (value: unknown, status = 200) => { response.writeHead(status,{'Content-Type':'application/json'}); response.end(JSON.stringify(value)) }
      let route = request.url ?? '/', chunks: Buffer[] = []
      for await (let chunk of request) chunks.push(chunk)
      let body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      if (request.method === 'POST') requests.push({route,body})
      if (route === '/api/hosts') { json([]); return }
      if (route === '/api/me') { json({owner:'123456789',email:billingEmail}); return }
      if (route === '/api/billing/status') { json({enabled:true,relay:{active:true,monthlyCents:1000,currency:'usd',maxStreams:2,cancelRequested:false,status:'active'}}); return }
      if (route === '/api/billing/rates') { json({base:'USD',source:'ECB',date:'2026-10-23',rates:{USD:1,EUR:.9,GBP:.75,JPY:150,THB:35}}); return }
      if (route === '/api/rentals') { json(rentals); return }
      if (route === '/api/streams') { json(views); return }
      if (route === '/api/streams/disconnect') { views=[]; json({ok:true}); return }
      if (route === '/api/rentals/catalog') {
        if (!catalogFailed) { catalogFailed = true; json({error:'Catalog temporarily unavailable'},503); return }
        json({enabled:true,quotes:[quote,{...quote,id:'large-quote',memoryGb:8,monthlyCents:1500},{...quote,id:'us-quote',region:'ash',regionName:'Ashburn',monthlyCents:1000}]}); return
      }
      if (route === '/api/rentals/checkout') {
        if (requests.filter(item => item.route === route).length < 3) { json({error:'Checkout temporarily unavailable'},503); return }
        rentals = [{id:body.requestId as string,name:body.name as string,state:'checkout',quote,cancelRequested:false,trafficPaused:false,trafficRatio:0,checkoutUrl}]
        json({url:checkoutUrl,rentalId:body.requestId}); return
      }
      if (/^\/api\/rentals\/[a-f0-9-]{36}\/delete$/.test(route)) { rentals=[]; json({ok:true}); return }
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
    let nativeWindows = await application.evaluate(({BaseWindow}) => BaseWindow.getAllWindows().length)
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
    await settings.getByRole('button',{name:'Close',exact:true}).click()
    await expect(page.getByRole('textbox')).toHaveValue('Still running')
    await chrome.getByRole('button',{name:'Sessions',exact:true}).click()
    let picker = chrome.getByRole('dialog',{name:'Sessions',exact:true})
    await picker.getByRole('tab',{name:'Remote'}).click()
    let relay = picker.getByRole('button',{name:'Relay',exact:true})
    await relay.focus(); await chrome.keyboard.press('g')
    await expect(picker.getByRole('button',{name:'Back to remote sessions',exact:true})).toBeVisible()
    await expect(picker.getByRole('region',{name:'Rented boxes',exact:true})).toHaveCount(0)
    await picker.getByRole('textbox',{name:'Computer name',exact:true}).fill('Research Mac')
    await picker.getByRole('button',{name:'Connect this computer',exact:true}).click()
    await expect(picker).toContainText('This computer: connected')
    await expect(picker).toContainText(/research-mac-[a-f0-9]{8}/)
    expect(application.process().pid).toBe(pid)
    expect((await fs.stat(path.join(directory,'remote-enrollment.json'))).mode & 0o077).toBe(0)
    await fs.mkdir(info.outputDir,{recursive:true}); await chrome.screenshot({path:info.outputPath('relay-connected.png')})
    await picker.getByRole('button',{name:'Back to remote sessions',exact:true}).click()
    await expect(relay).toBeFocused(); await expect(relay).toHaveAttribute('data-connected','true')
    await expect(relay.getByRole('img',{name:'Connected to relay'})).toBeVisible()
    await relay.click(); await picker.getByRole('button',{name:'Disconnect computer',exact:true}).click()
    await expect(picker.getByRole('button',{name:'Connect this computer',exact:true})).toBeVisible()
    await picker.getByRole('button',{name:'Back to remote sessions',exact:true}).click()
    await expect(relay).toHaveAttribute('data-connected','false')
    await picker.getByRole('button',{name:'Add box',exact:true}).click()
    await expect(picker.getByRole('alert')).toContainText('Catalog temporarily unavailable')
    await picker.getByRole('button',{name:'Retry',exact:true}).click()
    let form = picker.getByRole('form',{name:'Rent a box'})
    await expect(form.getByRole('radio')).toHaveCount(3)
    await expect(picker.getByRole('region',{name:'Relay',exact:true})).toHaveCount(0)
    await picker.getByRole('combobox',{name:'Estimates in'}).selectOption('JPY')
    await expect(form.getByRole('radiogroup')).toContainText(/USD\s8\.51 \(≈ JPY\s1,277\)/)
    await form.getByRole('button',{name:'All sizes and regions'}).click()
    await form.getByRole('combobox',{name:'Region',exact:true}).selectOption('fsn1')
    await expect(form.getByRole('combobox',{name:'Size and region'})).toContainText(/USD\s8\.51 \(≈ JPY\s1,277\)/)
    await form.getByRole('combobox',{name:'Size and region'}).selectOption('regional-quote')
    await form.getByText('Rental and deletion terms',{exact:true}).click()
    await expect(form).toContainText('Price includes IPv4 and our 20% service fee')
    await form.getByText('Rental and deletion terms',{exact:true}).click()
    await form.getByRole('button',{name:'Show recommendations'}).click()
    await form.getByRole('textbox',{name:'Box name'}).fill('Research box')
    await form.getByRole('checkbox').check()
    await chrome.screenshot({path:info.outputPath('rent-box.png')})
    await application.context().route('https://checkout.stripe.com/**',route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Test checkout</title><h1>Test checkout</h1>'}))
    let checkout = form.getByRole('button',{name:/Continue to checkout · USD\s8\.51\/month/})
    for (let attempt = 0; attempt < 2; attempt++) { await checkout.click(); await expect(picker.getByRole('alert')).toContainText('Checkout temporarily unavailable'); await expect(checkout).toBeEnabled() }
    let attempts = requests.filter(item => item.route === '/api/rentals/checkout')
    expect(attempts).toHaveLength(2); expect(attempts[0].body.requestId).toBe(attempts[1].body.requestId)
    await form.getByRole('textbox',{name:'Box name'}).fill('Research box final')
    await checkout.click()
    await expect.poll(() => application!.context().pages().some(page => page.url().startsWith('https://checkout.stripe.com/'))).toBe(true)
    await expect(picker).toHaveCount(0)
    let checkoutPage = application.context().pages().find(page => page.url().startsWith('https://checkout.stripe.com/'))!
    await expect(checkoutPage.getByRole('heading')).toHaveText('Test checkout')
    await expect.poll(() => application!.evaluate(({BaseWindow},url) => BaseWindow.getAllWindows().flatMap(window => window.contentView.children).some((view:any) => view.getVisible() && view.webContents?.getURL() === url && view.getBounds().height > 200),checkoutUrl)).toBe(true)
    attempts = requests.filter(item => item.route === '/api/rentals/checkout')
    expect(attempts[2].body).toMatchObject({name:'Research box final',quoteId:'regional-quote',acceptedTerms:true,sshKeys:[]})
    expect(attempts[2].body.requestId).not.toBe(attempts[0].body.requestId)
    await chrome.getByRole('button',{name:'Sessions',exact:true}).click(); await picker.getByRole('button',{name:'Add box',exact:true}).click()
    await expect(picker).toContainText('Waiting for payment')
    await picker.getByRole('button',{name:'Resume checkout',exact:true}).click()
    await expect(picker).toHaveCount(0)
    expect(requests.filter(item => item.route === '/api/rentals/checkout')).toHaveLength(3)
    rentals[0].state = 'provisioning'
    await chrome.getByRole('button',{name:'Sessions',exact:true}).click(); await picker.getByRole('button',{name:'Add box',exact:true}).click()
    await expect(picker).toContainText('Installing and connecting…')
    await picker.getByRole('button',{name:'Delete now',exact:true}).click()
    let deleteName = picker.getByRole('textbox',{name:'Type Research box final to delete'})
    await deleteName.fill('wrong'); await expect(picker.getByRole('button',{name:'Delete box and files'})).toBeDisabled()
    await deleteName.fill('Research box final'); await picker.getByRole('button',{name:'Delete box and files'}).click()
    await expect(picker.getByRole('button',{name:'Delete now'})).toHaveCount(0)
    expect(requests.find(item => /\/delete$/.test(item.route))?.body.confirmName).toBe('Research box final')
    expect(await application.evaluate(({BaseWindow}) => BaseWindow.getAllWindows().length)).toBe(nativeWindows)
    expect(requests.filter(item => item.route === '/api/services')).toHaveLength(1)
    expect(requests.filter(item => item.route === '/api/services/revoke')).toHaveLength(1)
  } finally {
    await closeTestApplication(application)
    for (let socket of sockets.clients) socket.terminate(); sockets.close(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory,{recursive:true,force:true})
  }
})
