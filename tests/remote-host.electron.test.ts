import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { closeTestApplication } from './electron-fixture'
import { observeNativeFocus, recordNativeFocus } from './native-focus'

test('discovers a host, watches its live page, coordinates control, and revokes a viewer', async () => {
  test.skip(!process.env.BMUX_TEST_DATABASE_URL, 'Requires a disposable local PostgreSQL fixture')
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-test-'))
  let pool = new Pool({ connectionString: process.env.BMUX_TEST_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, query_timeout: 5000 })
  let origin = 'http://127.0.0.1:18889', owner = randomBytes(12).toString('hex'), service = `test-${owner}`, token = randomBytes(32).toString('hex'), cookie = randomBytes(32).toString('hex')
  let digest = (value: string) => createHash('sha256').update(value).digest('hex')
  let fixture = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Remote fixture</title><a href="?linked=1" style="position:absolute;left:40px;top:40px;width:120px;height:40px">Open link</a><input autofocus aria-label="Fixture input" style="position:absolute;top:120px"><div id="tick"></div><script>window.memory="retained";document.addEventListener("keydown",event=>document.body.dataset.key=event.key);document.addEventListener("pointerdown",event=>document.body.dataset.pointer=event.clientX+","+event.clientY);setInterval(()=>document.querySelector("#tick").textContent=Date.now(),100)</script>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  let fixtureUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
  await pool.query(await fs.readFile('remote/schema.sql', 'utf8'))
  await pool.query('INSERT INTO bmux_services (id,owner,token_hash) VALUES ($1,$2,$3)', [service, owner, digest(token)])
  await pool.query("INSERT INTO bmux_logins VALUES ($1,$2,now()+interval '1 hour')", [digest(cookie),owner])
  await fs.writeFile(path.join(directory,'remote.json'),JSON.stringify({url:origin,token}),{mode:0o600})
  await fs.writeFile(path.join(directory,'config.yaml'),'browser:\n  autoUpdateFilters: false\n')
  let server = spawn(process.execPath,['--import','tsx','remote/server.ts'],{env:{...process.env,DATABASE_URL:process.env.BMUX_TEST_DATABASE_URL,PORT:'18889',BMUX_PUBLIC_ORIGIN:origin,BMUX_GOOGLE_CLIENT_ID:'fixture',BMUX_TURN_SECRET:'fixture',BMUX_TURN_URLS:'turn:127.0.0.1:3478'},stdio:'ignore'})
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let applicationProcess: ChildProcess | undefined
  let failed = true
  try {
    await expect.poll(async()=>{try{return(await fetch(`${origin}/health`)).ok}catch{return false}}).toBe(true)
    application = await electron.launch({args:[process.cwd(),'--background'],env:{...process.env,BMUX_DATA_DIR:directory,BMUX_CONFIG:path.join(directory,'config.yaml'),BMUX_REMOTE_CONFIG:path.join(directory,'remote.json'),BMUX_REMOTE_URL:origin,BMUX_BACKGROUND:'1'}})
    applicationProcess = application.process()
    application.context().setDefaultTimeout(10000)
    application.context().setDefaultNavigationTimeout(10000)
    await observeNativeFocus(application)
    let focusWindow = (id: number, name: string) => test.step(`Focus the ${name} native window`, async () => {
      await test.step('Request focus outside the Inspector callback', () => application!.evaluate(({ BaseWindow }, id) => {
        // Native activation can enter a nested event loop. Let the Inspector
        // callback return before triggering it, then observe the window manager.
        setImmediate(() => {
          let window = BaseWindow.fromId(id)
          if (!window || window.isFocused()) return
          if (!window.isVisible()) window.show()
          window.moveTop()
          window.focus()
        })
      }, id))
      await test.step('Wait for native focus acknowledgement', async () => {
        await expect.poll(() => application!.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)?.isFocused(), id), { intervals: [50, 100, 200] }).toBe(true)
      })
    }, { timeout: 10000 })
    let command = async (...args:string[]) => {
      try { return JSON.parse((await promisify(execFile)(process.execPath,['bin/bmux.mjs',...args],{env:{...process.env,BMUX_DATA_DIR:directory},timeout:20000})).stdout).result }
      catch (error) {
        let output = (error as { stdout?: string }).stdout
        throw new Error(`${args[0]}: ${output ? JSON.parse(output).error : String(error)}`)
      }
    }
    let status = await command('status'), pane = status.model.sessions[0].windows[0].panes[0].id
    await command('navigate','-t',pane,fixtureUrl)
    await command('wait','-t',pane,'--selector','input')
    await command('eval','-t',pane,'document.querySelector("input").focus()')
    await expect.poll(async()=>(await command('remote','status')).connected).toBe(true)
    let other = await command('new-session','-s','uncontrolled')
    let otherPane = other.windows[0].panes[0].id
    // Establish the desktop before remote control; automation cannot take over a lease.
    let localClient = await command('attach-session','-t',status.model.sessions[0].id)
    let localWindowId = (await command('rpc','diagnostics','{}')).windows.find((window: { id: string }) => window.id === localClient.id).nativeId
    await application.evaluate(({BaseWindow},id)=>BaseWindow.fromId(id)!.hide(),localWindowId)
    let viewerWindowId = await application.evaluate(async({BrowserWindow,session},{origin,cookie})=>{
      await session.defaultSession.cookies.set({url:origin,name:'bmux_session',value:cookie,httpOnly:true})
      session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('http://127.0.0.1:') && !details.url.startsWith('ws://127.0.0.1:') && !details.url.startsWith('file://')}))
      // Playwright's click stability checks need compositor frames from a visible window.
      let viewer = new BrowserWindow({show:true,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      await viewer.loadURL(origin)
      return viewer.id
    },{origin,cookie})
    await expect.poll(()=>application!.context().pages().some(page=>page.url()===origin+'/')).toBe(true)
    let viewer = application.context().pages().find(page=>page.url()===origin+'/')!
    await expect(viewer.getByRole('button',{name:'Account'})).toBeVisible()
    let finishAccountCheck: (() => void) | undefined
    let accountCheck = new Promise<void>(resolve => { finishAccountCheck = resolve })
    let finishRoutedCheck: (() => void) | undefined
    let routedCheck = new Promise<void>(resolve => { finishRoutedCheck = resolve })
    await viewer.route('**/api/me', async route => { await accountCheck; await route.continue(); finishRoutedCheck?.() })
    await viewer.reload({waitUntil:'domcontentloaded'})
    await expect(viewer.getByRole('button',{name:'Account'})).toHaveAttribute('aria-busy','true')
    await expect(viewer.getByRole('button',{name:'Sign in with Google'})).toHaveCount(0)
    finishAccountCheck?.()
    await routedCheck
    await viewer.unroute('**/api/me')
    await expect(viewer.getByRole('button',{name:new RegExp(`main.*${service}`)})).toBeVisible()
    // The host listing confirms enrollment. Identify this viewer before another
    // origin enrolls its own device, rather than selecting an arbitrary DB row.
    let viewerDevice = await viewer.evaluate(async()=>{
      let key = JSON.parse(localStorage.getItem('bmux-device-key')!)
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key.x)))].map(value=>value.toString(16).padStart(2,'0')).join('')
    })
    await expect(viewer.getByRole('button',{name:'Reconnect'})).toHaveCount(0)
    await expect(viewer.getByRole('heading',{name:'Account'})).toHaveCount(0)
    await viewer.getByRole('button',{name:'Account'}).click()
    await expect(viewer.getByRole('heading',{name:'Account'})).toBeVisible()
    await expect(viewer.getByText('Account ID:')).toBeVisible()
    await expect(viewer.getByRole('heading',{name:/Usage/})).toBeVisible()
    await viewer.getByRole('button',{name:'Sessions'}).click()
    await viewer.setViewportSize({width:1280,height:800})
    await viewer.getByRole('button',{name:new RegExp(`main.*${service}`)}).click()
    // Watching allows up to twenty seconds for signaling and ICE negotiation.
    await expect(viewer.getByLabel('Pane',{exact:true})).toBeVisible({timeout:25000})
    await expect.poll(()=>viewer.evaluate(()=>document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames),{timeout:15000}).toBeGreaterThan(5)
    let bookmarkedUrl = new URL(viewer.url())
    expect(bookmarkedUrl.searchParams.get('host')).toBeTruthy()
    expect(bookmarkedUrl.searchParams.get('session')).toBe(status.model.sessions[0].id)
    await viewer.reload()
    await expect(viewer.getByLabel('Pane',{exact:true})).toBeVisible({timeout:25000})
    await expect.poll(()=>viewer.evaluate(()=>document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames),{timeout:15000}).toBeGreaterThan(5)
    await viewer.goBack()
    await expect(viewer.getByLabel('Remote browser')).toHaveCount(0)
    await viewer.goForward()
    await expect(viewer.getByLabel('Pane',{exact:true})).toBeVisible({timeout:25000})
    // Controls can be ready before decoded video metadata after history navigation.
    await viewer.waitForFunction(()=>{
      let video = document.querySelector('video')!
      return video.videoWidth>0 && video.videoHeight>0 && video.getVideoPlaybackQuality().totalVideoFrames>5 && Number(video.dataset.viewportWidth)>0 && Number(video.dataset.viewportHeight)>0
    },undefined,{timeout:15000})
    let sessionRow = viewer.getByRole('button',{name:new RegExp(`main.*${service}`)})
    let rowBounds = await sessionRow.boundingBox(), videoBounds = await viewer.getByLabel('Remote browser').boundingBox()
    expect(rowBounds).not.toBeNull(); expect(videoBounds).not.toBeNull()
    expect(rowBounds!.x + rowBounds!.width).toBeLessThan(videoBounds!.x)
    await viewer.setViewportSize({width:390,height:800})
    await expect(sessionRow).toBeHidden()
    await expect(viewer.getByRole('button',{name:'Sessions',exact:true})).toBeVisible()
    await viewer.setViewportSize({width:1280,height:800})
    expect(await command('eval','-t',pane,'window.memory')).toBe('retained')
    await viewer.getByRole('button',{name:'Take control',exact:true}).click()
    await expect(viewer.getByText('Controlling')).toBeVisible()
    await viewer.getByRole('button',{name:'Open address'}).click()
    await expect(viewer.getByRole('dialog',{name:'Open address'}).getByRole('textbox',{name:'Address'})).toBeFocused()
    await viewer.getByRole('dialog',{name:'Open address'}).getByRole('button',{name:'Close'}).click()
    let video = viewer.getByLabel('Remote browser')
    await video.scrollIntoViewIfNeeded()
    let linkPosition = await video.evaluate(element => {
      let video = element as HTMLVideoElement, rect = video.getBoundingClientRect(), scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
      return { x: (rect.width - video.videoWidth * scale) / 2 + 80 * video.videoWidth / Number(video.dataset.viewportWidth) * scale, y: (rect.height - video.videoHeight * scale) / 2 + 60 * video.videoHeight / Number(video.dataset.viewportHeight) * scale }
    })
    expect(Number.isFinite(linkPosition.x) && Number.isFinite(linkPosition.y)).toBe(true)
    await video.click({ position: linkPosition })
    await expect.poll(async () => (await command('status')).model.sessions[0].windows[0].panes[0].url).toContain('?linked=1')
    await viewer.getByRole('button',{name:'Back',exact:true}).click()
    await expect.poll(async () => (await command('status')).model.sessions[0].windows[0].panes[0].url).not.toContain('?linked=1')
    await video.focus()
    await video.press('ArrowDown')
    let page = application.context().pages().find(page=>page.url()===fixtureUrl+'/')!
    await expect.poll(() => page.evaluate(() => document.body.dataset.key)).toBe('ArrowDown')
    await expect(command('eval','-t',pane,'window.memory')).rejects.toThrow()
    expect(await command('eval','-t',otherPane,'1+1')).toBe(2)
    await expect(command('dark','on','-t',otherPane,'--scope','global')).rejects.toThrow()
    await expect(command('dark','on','-t',otherPane,'--scope','profile')).rejects.toThrow()
    await viewer.getByRole('button',{name:'Type into page'}).click()
    await viewer.getByRole('dialog',{name:'Type into page'}).getByRole('textbox',{name:'Text'}).fill('remote text')
    await viewer.getByRole('button',{name:'Type',exact:true}).click()
    await expect(page.getByLabel('Fixture input')).toHaveValue('remote text')
    await viewer.setViewportSize({width:700,height:800})
    await viewer.getByRole('button',{name:'Fit viewport'}).click()
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(700)
    await expect(command('attach-session','-t',status.model.sessions[0].id)).rejects.toThrow('CONTROL_HELD')
    await expect(command('rpc','activate-client',JSON.stringify({client:localClient.id}))).rejects.toThrow('CONTROL_HELD')
    // A human focusing the native desktop window reclaims control without an RPC.
    await focusWindow(localWindowId, 'desktop')
    await expect.poll(async () => (await command('status')).focusedClientId).toBe(localClient.id)
    await expect.poll(async () => (await command('status')).remoteControl[status.model.sessions[0].id]).toBeUndefined()
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(700)
    // Return native focus to the viewer before sending its next mouse input.
    await focusWindow(viewerWindowId, 'viewer')
    // Regaining focus requests current ownership, rather than waiting for a broadcast.
    await test.step('Reacquire and release control from the focused viewer', async () => {
      await expect(viewer.getByRole('button',{name:'Take control',exact:true})).toBeVisible({timeout:10000})
      await viewer.getByRole('button',{name:'Take control',exact:true}).click()
      await expect(viewer.getByRole('button',{name:'Release control',exact:true})).toBeVisible()
      await viewer.getByRole('button',{name:'Release control',exact:true}).click()
      await expect.poll(async()=>await command('eval','-t',pane,'window.memory')).toBe('retained')
    }, { timeout: 30000 })
    let attachedClient = await test.step('Attach and focus the desktop session',async()=>{
      let client = await command('attach-session','-t',status.model.sessions[0].id)
      await command('rpc','activate-client',JSON.stringify({client:client.id}))
      await expect.poll(async()=>(await command('status')).focusedClientId).toBe(client.id)
      return client
    },{timeout:25000})
    let localPages = await test.step('Find the attached desktop renderer',()=>Promise.all(application!.context().pages().filter(page=>page.url().endsWith('/index.html')).map(async page=>({page,clientId:(await page.evaluate(()=>(window as any).bmux.state())).clientId}))),{timeout:10000})
    let local = localPages.find(item=>item.clientId===attachedClient.id)!.page
    await test.step('Open the attached desktop session picker',async()=>{
      await expect(local.locator(`[data-pane-id="${pane}"]`)).toHaveAttribute('data-focused-pane','true')
      await local.getByRole('button',{name:'Sessions',exact:true}).click()
    },{timeout:15000})
    await test.step('Open a remote session from the desktop and decode video',async()=>{
      let remotePicker = local.getByRole('dialog',{name:'Sessions'})
      await remotePicker.getByRole('tab',{name:'Remote sessions'}).click()
      await expect(remotePicker.getByRole('button',{name:/main.*remote/})).toBeVisible()
      await remotePicker.getByRole('button',{name:/main.*remote/}).click()
      await expect.poll(() => application!.context().pages().some(page=>page.url().endsWith('/remote-client.html'))).toBe(true)
      let attached = application!.context().pages().find(page=>page.url().endsWith('/remote-client.html'))!
      // The video element mounts before the attached viewer finishes signaling.
      await expect(attached.getByLabel('Pane',{exact:true})).toBeVisible({timeout:25000})
      await expect(attached.getByLabel('Remote browser')).toBeVisible()
      await attached.waitForFunction(()=>document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames>0,undefined,{timeout:15000})
      await expect(attached.getByRole('button',{name:'Take control'})).toBeVisible()
    },{timeout:40000})
    await test.step('Record successful remote usage once',async()=>{
      await command('rpc','remote.job',JSON.stringify({id:'job',attempt:'one'}))
      await command('rpc','remote.job',JSON.stringify({id:'job',attempt:'one',result:'succeeded'}))
      await command('rpc','remote.job',JSON.stringify({id:'job',attempt:'one',result:'succeeded'}))
      await expect.poll(async()=>(await pool.query('SELECT succeeded FROM bmux_usage WHERE service=$1',[service])).rows[0]?.succeeded,{timeout:10000}).toBe('1')
    },{timeout:30000})
    await test.step('Revoke the original viewer and verify signed-out controls',async()=>{
      let response = await fetch(`${origin}/api/revoke`,{method:'POST',headers:{Origin:origin,Cookie:`bmux_session=${cookie}`,'Content-Type':'application/json'},body:JSON.stringify({id:viewerDevice}),signal:AbortSignal.timeout(10000)})
      expect(response.ok).toBe(true)
      await expect(viewer.getByText('Sign in to continue')).toBeVisible()
      await application!.evaluate(async ({session},origin)=>session.defaultSession.cookies.remove(origin,'bmux_session'),origin)
      await viewer.reload()
      await expect(viewer.getByText('Sign in to see your sessions.')).toBeVisible()
      await expect(viewer.getByRole('button',{name:'Sign in with Google'})).toBeVisible()
      await expect(viewer.getByRole('button',{name:'Account'})).toHaveCount(0)
      await expect(viewer.getByText('AVAILABLE SESSIONS')).toHaveCount(0)
    },{timeout:30000})
    failed = false
  } finally {
    // TestInfo's final status is assigned after this callback returns.
    if (application) await recordNativeFocus(application,test.info(),failed)
    if (failed && applicationProcess) console.log('REMOTE_PROCESS_DIAGNOSTICS', { pid:applicationProcess.pid,exitCode:applicationProcess.exitCode,signalCode:applicationProcess.signalCode })
    await closeTestApplication(application,applicationProcess)
    server.kill('SIGTERM')
    await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',()=>resolve());setTimeout(()=>{server.kill('SIGKILL');resolve()},3000).unref()})
    await new Promise<void>(resolve=>{fixture.close(()=>resolve());fixture.closeAllConnections()})
    await pool.query('DELETE FROM bmux_usage WHERE service=$1',[service]); await pool.query('DELETE FROM bmux_services WHERE id=$1',[service]); await pool.query('DELETE FROM bmux_devices WHERE owner=$1',[owner]); await pool.query('DELETE FROM bmux_logins WHERE owner=$1',[owner]); await pool.end()
    await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})
  }
})
