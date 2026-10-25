import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import net from 'node:net'
import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { closeTestApplication } from './electron-fixture'
import { observeNativeFocus, recordNativeFocus } from './native-focus'
import { initialModel } from '../src/main/model'
import { controlSocketPath } from '../bin/ipc.mjs'
import { requestRemoteSessionPreviews } from '../src/main/remote-request'
import { remoteIdentity } from '../src/main/remote-identity'

test('discovers a host, watches its live page, coordinates control, and revokes a viewer', async () => {
  test.setTimeout(180000)
  test.skip(!process.env.BMUX_TEST_DATABASE_URL, 'Requires a disposable local PostgreSQL fixture')
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-test-'))
  let pool = new Pool({ connectionString: process.env.BMUX_TEST_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, query_timeout: 5000 })
  let origin = 'http://127.0.0.1:18889', owner = randomBytes(12).toString('hex'), service = `test-${owner}`, token = randomBytes(32).toString('hex'), cookie = randomBytes(32).toString('hex')
  let digest = (value: string) => createHash('sha256').update(value).digest('hex')
  let fixture = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Remote fixture</title><a href="?linked=1" style="position:absolute;left:40px;top:40px;width:120px;height:40px">Open link</a><input autofocus aria-label="Fixture input" style="position:absolute;top:120px"><div id="tick"></div><script>window.memory="retained";document.addEventListener("keydown",event=>document.body.dataset.key=event.key);document.addEventListener("pointerdown",event=>document.body.dataset.pointer=event.clientX+","+event.clientY);document.addEventListener("wheel",event=>document.body.dataset.wheel=String(event.deltaY));setInterval(()=>document.querySelector("#tick").textContent=Date.now(),100)</script>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  let fixtureUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
  await pool.query(await fs.readFile('remote/schema.sql', 'utf8'))
  await pool.query('INSERT INTO bmux_services (id,owner,token_hash) VALUES ($1,$2,$3)', [service, owner, digest(token)])
  await pool.query("INSERT INTO bmux_logins VALUES ($1,$2,now()+interval '1 hour')", [digest(cookie),owner])
  await fs.writeFile(path.join(directory,'remote.json'),JSON.stringify({url:origin,token}),{mode:0o600})
  let savedModel = initialModel(), previousUse = Date.now() - 86400000
  savedModel.sessions[0].lastActivityAt = previousUse
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(savedModel))
  await fs.writeFile(path.join(directory,'config.yaml'),'keyboard: {}\nbrowser:\n  autoUpdateFilters: false\n')
  let server = spawn(process.execPath,['--import','tsx','remote/server.ts'],{env:{...process.env,DATABASE_URL:process.env.BMUX_TEST_DATABASE_URL,PORT:'18889',BMUX_PUBLIC_ORIGIN:origin,BMUX_GOOGLE_CLIENT_ID:'fixture',BMUX_TURN_SECRET:'fixture',BMUX_TURN_URLS:'turn:127.0.0.1:3478'},stdio:'ignore'})
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  let applicationProcess: ChildProcess | undefined
  let failed = true
  try {
    await expect.poll(async()=>{try{return(await fetch(`${origin}/health`)).ok}catch{return false}}).toBe(true)
    application = await electron.launch({args:[process.cwd(),'--background'],env:{...process.env,BMUX_DATA_DIR:directory,BMUX_CONFIG:path.join(directory,'config.yaml'),BMUX_REMOTE_CONFIG:path.join(directory,'remote.json'),BMUX_DEFAULT_AGENT_ID:'fixture-adapter',BMUX_REMOTE_URL:origin,BMUX_BACKGROUND:'1'}})
    applicationProcess = application.process()
    application.context().setDefaultTimeout(10000)
    application.context().setDefaultNavigationTimeout(10000)
    await observeNativeFocus(application)
    await application.evaluate(({ ipcMain }) => {
      let messages: unknown[] = []
      ;(globalThis as any).bmuxTestRemoteMessages = messages
      ipcMain.on('remote-message', (_event, message) => {
        if (['ready', 'offer', 'connection', 'error'].includes(message?.type)) messages.push({ type: message.type, state: message.state, at: Date.now() })
      })
    })
    await application.context().addInitScript(() => {
      let peers: RTCPeerConnection[] = []
      ;(window as any).bmuxTestRemotePeers = peers
      let NativePeer = RTCPeerConnection
      window.RTCPeerConnection = class extends NativePeer {
        constructor(configuration?: RTCConfiguration) { super(configuration); peers.push(this) }
        // Exercise the full viewer flow without relying on the completion
        // notification that was delayed in the ARM failure. Real candidates,
        // peer negotiation, data channels, and decoded frames remain required.
        set onicecandidate(listener: ((this: RTCPeerConnection, event: RTCPeerConnectionIceEvent) => any) | null) {
          super.onicecandidate = listener ? event => { if (event.candidate) listener.call(this, event) } : null
        }
        get onicecandidate() { return super.onicecandidate }
      }
    })
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
        await expect.poll(() => application!.evaluate(({ BaseWindow }, id) => {
          let window = BaseWindow.fromId(id)
          if (!window || window.isFocused()) return !!window
          // View reattachment can supersede a pending activation. Request it
          // again while unfocused, keeping native work outside the Inspector.
          setImmediate(() => {
            if (window.isDestroyed()) return
            if (!window.isVisible()) window.show()
            window.moveTop()
            window.focus()
          })
          return false
        }, id), { intervals: [50, 100, 200] }).toBe(true)
      })
    }, { timeout: 10000 })
    let command = async (...args:string[]) => {
      try { return JSON.parse((await promisify(execFile)(process.execPath,['bin/bmux.mjs',...args],{env:{...process.env,BMUX_AGENT_ID:'test-agent',BMUX_DATA_DIR:directory},timeout:20000})).stdout).result }
      catch (error) {
        let output = (error as { stdout?: string }).stdout
        throw new Error(`${args[0]}: ${output ? JSON.parse(output).error : String(error)}`)
      }
    }
    let status = await command('status'), pane = status.model.sessions[0].windows[0].panes[0].id
    expect(status.model.sessions[0].lastActivityAt).toBe(previousUse)
    await command('navigate','-t',pane,fixtureUrl)
    await command('wait','-t',pane,'--selector','input')
    await command('eval','-t',pane,'document.querySelector("input").focus()')
    await expect.poll(async()=>(await command('remote','status')).connected).toBe(true)
    await new Promise<void>((resolve, reject) => {
      let socket = net.connect(controlSocketPath(directory))
      socket.setTimeout(10000, () => socket.destroy(new Error('Adapter RPC timed out')))
      socket.on('error', reject)
      socket.on('connect', () => socket.write(JSON.stringify({ method: 'eval', args: { pane, expression: '1' } }) + '\n'))
      let reply = ''
      socket.on('data', data => { reply += data })
      socket.on('end', () => { try { expect(JSON.parse(reply)).toMatchObject({ ok: true, result: 1 }); resolve() } catch (error) { reject(error) } })
    })
    let actionsCompletedAt = Date.now()
    expect((await command('status')).model.sessions[0].windows[0].panes[0].agentId).toBe('fixture-adapter')
    let lastUse = (await command('status')).model.sessions[0].lastActivityAt
    expect(lastUse).toBeGreaterThan(previousUse)
    await expect.poll(async () => {
      let hosts = await fetch(`${origin}/api/hosts`, { headers: { Cookie: `bmux_session=${cookie}` } }).then(response => response.json())
      return hosts.flatMap((host: { sessions: { id: string; lastActivityAt?: number; canClose?: boolean }[] }) => host.sessions).find((session: { id: string }) => session.id === status.model.sessions[0].id)
    }, { timeout: 10000 }).toMatchObject({ lastActivityAt: lastUse, canClose: true })
    let advertised = await fetch(`${origin}/api/hosts`, { headers: { Cookie: `bmux_session=${cookie}` } }).then(response => response.json())
    expect(advertised.find((host: { sessions: { id: string }[] }) => host.sessions.some(session => session.id === status.model.sessions[0].id)).machine).toMatchObject({ name: os.hostname(), platform: process.platform, arch: process.arch })
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')).sessions[0].lastActivityAt).toBe(lastUse)
    await test.step('Capture hidden agent actions at most every 15 seconds and fetch cached previews while idle', async () => {
      let identity = remoteIdentity(path.join(directory, 'preview-test.pem'))
      let hosts = await fetch(`${origin}/api/hosts`, { headers: { Cookie: `bmux_session=${cookie}` } }).then(response => response.json())
      let host = hosts.find((host: { sessions: { id: string }[] }) => host.sessions.some(session => session.id === status.model.sessions[0].id))
      expect(host.sessions[0].canPreview).toBe(true)
      let fetchPreviews = () => requestRemoteSessionPreviews(origin, host, status.model.sessions[0].id, [pane], identity, async publicKey => {
        let response = await fetch(`${origin}/api/connect`, { method: 'POST', headers: { Cookie: `bmux_session=${cookie}`, Origin: origin, 'Content-Type': 'application/json', 'X-Bmux-Desktop': '1' }, body: JSON.stringify({ publicKey }) })
        expect(response.ok).toBe(true)
        return response.json()
      })
      await expect.poll(async () => (await command('status')).snapshots[pane]?.capturedAt ?? 0, { timeout: 20000, intervals: [250, 1000] }).toBeGreaterThanOrEqual(actionsCompletedAt)
      let before = await command('status'), first = await fetchPreviews()
      expect(first[pane].image).toMatch(/^data:image\/jpeg;base64,/)
      expect(first[pane].capturedAt).toBeGreaterThan(0)
      await command('eval', '-t', pane, 'document.body.style.background="red"')
      await command('eval', '-t', pane, 'document.body.style.background="blue"')
      expect((await command('status')).snapshots[pane].capturedAt).toBe(first[pane].capturedAt)
      lastUse = (await command('status')).model.sessions[0].lastActivityAt
      await expect.poll(async () => (await command('status')).snapshots[pane]?.capturedAt, { timeout: 20000, intervals: [250, 1000] }).toBeGreaterThan(first[pane].capturedAt)
      let next = await fetchPreviews()
      expect(next[pane].capturedAt - first[pane].capturedAt).toBeGreaterThanOrEqual(15000)
      expect(next[pane].image).not.toBe(first[pane].image)
      let pixel = await application!.evaluate(({ nativeImage }, image) => [...nativeImage.createFromDataURL(image).toBitmap().subarray(0, 3)], next[pane].image)
      expect(pixel[0]).toBeGreaterThan(240)
      expect(pixel[1]).toBeLessThan(15)
      expect(pixel[2]).toBeLessThan(15)
      // Observe longer than the old idle capture interval, including cache fetches.
      await expect.poll(async () => {
        let cached = await fetchPreviews()
        expect(cached[pane]).toEqual(next[pane])
        return Date.now() - next[pane].capturedAt
      }, { timeout: 20000, intervals: [1000, 2000] }).toBeGreaterThan(15500)
      let after = await command('status')
      expect(after.model.clients).toEqual(before.model.clients)
      expect(after.model.sessions[0].lastActivityAt).toBe(lastUse)
      expect(after.remoteControl[status.model.sessions[0].id]).toBeUndefined()
      expect(application!.context().pages().some(page => page.url().endsWith('/remote-peer.html'))).toBe(false)
    }, { timeout: 65000 })
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
    let resizeViewer = async (width: number, height = 800) => {
      // Device-metrics emulation can finish before the native input surface
      // follows the new layout. Resize the real disposable viewer instead.
      await application!.evaluate(({ BrowserWindow }, { id, width, height }) => {
        setImmediate(() => BrowserWindow.fromId(id)?.setContentSize(width, height))
      }, { id: viewerWindowId, width, height })
      await expect.poll(() => viewer.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height })
    }
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
    let library = viewer.getByRole('complementary', { name: 'Sessions', exact: true })
    let preview = viewer.getByRole('region', { name: 'Session preview', exact: true })
    let libraryBounds = await library.boundingBox(), previewBounds = await preview.boundingBox()
    expect(libraryBounds).not.toBeNull(); expect(previewBounds).not.toBeNull()
    expect(libraryBounds!.width).toBeLessThanOrEqual(340)
    expect(libraryBounds!.x + libraryBounds!.width).toBeLessThanOrEqual(previewBounds!.x)
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
    await resizeViewer(1280)
    await viewer.getByRole('button',{name:new RegExp(`main.*${service}`)}).click()
    // Watching allows up to twenty seconds for signaling and ICE negotiation.
    await expect(viewer.getByLabel('Pane',{exact:true})).toBeVisible({timeout:25000})
    expect((await command('status')).model.sessions[0].lastActivityAt).toBe(lastUse)
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
    await resizeViewer(844, 390)
    await expect(sessionRow).toBeVisible()
    await expect(viewer.getByLabel('Pane', { exact: true })).toBeVisible()
    let landscapeRow = await sessionRow.boundingBox(), landscapeVideo = await viewer.getByLabel('Remote browser').boundingBox()
    expect(landscapeRow!.x + landscapeRow!.width).toBeLessThan(landscapeVideo!.x)
    expect(landscapeVideo!.height).toBeGreaterThan(200)
    expect(landscapeVideo!.y + landscapeVideo!.height).toBeLessThanOrEqual(390)
    expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await resizeViewer(390)
    await expect(sessionRow).toBeHidden()
    await expect(viewer.getByRole('button',{name:'Sessions',exact:true})).toBeVisible()
    await resizeViewer(1280)
    await expect(sessionRow).toBeVisible()
    expect(await command('eval','-t',pane,'window.memory')).toBe('retained')
    await viewer.getByRole('button',{name:'Take control',exact:true}).click()
    await expect(viewer.getByText('Controlling')).toBeVisible()
    await viewer.getByRole('button',{name:'Open address'}).click()
    await expect(viewer.getByRole('dialog',{name:'Open address'}).getByRole('textbox',{name:'Address'})).toBeFocused()
    let typedUrl = `${fixtureUrl}/?address=1`
    await viewer.getByRole('dialog',{name:'Open address'}).getByRole('textbox',{name:'Address'}).fill(typedUrl)
    await viewer.getByRole('dialog',{name:'Open address'}).getByRole('textbox',{name:'Address'}).press('Enter')
    await expect(viewer.getByRole('dialog',{name:'Open address'})).not.toBeVisible()
    await expect.poll(() => application!.context().pages().some(page => page.url() === typedUrl)).toBe(true)
    let video = viewer.getByLabel('Remote browser')
    await video.scrollIntoViewIfNeeded()
    let videoPosition = (x: number, y: number) => video.evaluate((element, { x, y }) => {
      let video = element as HTMLVideoElement, rect = video.getBoundingClientRect(), scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
      return { x: (rect.width - video.videoWidth * scale) / 2 + x * video.videoWidth / Number(video.dataset.viewportWidth) * scale, y: (rect.height - video.videoHeight * scale) / 2 + y * video.videoHeight / Number(video.dataset.viewportHeight) * scale }
    }, { x, y })
    let linkPosition = await videoPosition(80, 60)
    expect(Number.isFinite(linkPosition.x) && Number.isFinite(linkPosition.y)).toBe(true)
    await video.click({ position: linkPosition })
    await expect.poll(async () => (await command('status')).model.sessions[0].windows[0].panes[0].url).toContain('?linked=1')
    await viewer.getByRole('button',{name:'Back',exact:true}).click()
    await expect.poll(async () => (await command('status')).model.sessions[0].windows[0].panes[0].url).not.toContain('?linked=1')
    // Establish keyboard focus through real input rather than calling DOM focus
    // inside a debugger evaluation during native window activation.
    // Target the fixture input as well, so the following text-entry assertion
    // establishes its own selection instead of depending on initial autofocus.
    await video.click({ position: await videoPosition(80, 130) })
    await expect(video).toBeFocused()
    await viewer.keyboard.press('ArrowDown')
    let page = application.context().pages().find(page=>page.url()===typedUrl)!
    await expect.poll(() => page.evaluate(() => document.body.dataset.key)).toBe('ArrowDown')
    await expect(command('eval','-t',pane,'window.memory')).rejects.toThrow()
    expect(await command('eval','-t',otherPane,'1+1')).toBe(2)
    await expect(command('dark','on','-t',otherPane,'--scope','global')).rejects.toThrow()
    await expect(command('dark','on','-t',otherPane,'--scope','profile')).rejects.toThrow()
    await viewer.getByRole('button',{name:'Type into page'}).click()
    await viewer.getByRole('dialog',{name:'Type into page'}).getByRole('textbox',{name:'Text'}).fill('remote text')
    await viewer.getByRole('button',{name:'Type',exact:true}).click()
    await expect(page.getByLabel('Fixture input')).toHaveValue('remote text')
    await resizeViewer(700)
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
    let remoteTab = await command('rpc', 'new-window', JSON.stringify({ session: status.model.sessions[0].id, url: `${fixtureUrl}/?remote-tab=2` }))
    await command('wait', '-t', remoteTab.panes[0].id, '--selector', 'input')
    let desktopOwner: string | undefined
    let attachedClient = await test.step('Attach and focus the desktop session',async()=>{
      let client = await command('attach-session','-t',status.model.sessions[0].id)
      await command('rpc','activate-client',JSON.stringify({client:client.id}))
      await expect.poll(async()=>(await command('status')).focusedClientId).toBe(client.id)
      return client
    },{timeout:25000})
    let localPages = await test.step('Find the attached desktop renderer',()=>Promise.all(application!.context().pages().filter(page=>page.url().endsWith('/index.html')).map(async page=>({page,clientId:(await page.evaluate(()=>(window as any).bmux.state())).clientId}))),{timeout:10000})
    let local = localPages.find(item=>item.clientId===attachedClient.id)!.page
    let extensionPath = path.join(directory, 'remote-layout-extension')
    await fs.mkdir(extensionPath)
    await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Remote layout fixture', version: '1.0', permissions: ['tabs'] }))
    let extension = await command('rpc', 'extension.load', JSON.stringify({ profile: status.model.sessions[0].defaultProfileId, path: extensionPath }))
    expect(extension.id).toBeTruthy()
    await test.step('Open the attached desktop session picker',async()=>{
      await expect(local.locator(`[data-pane-id="${pane}"]`)).toHaveAttribute('data-focused-pane','true')
      await local.getByRole('button',{name:'Sessions',exact:true}).click()
    },{timeout:15000})
    await test.step('Open a remote session from the desktop and decode video',async()=>{
      let remotePicker = local.getByRole('dialog',{name:'Sessions'})
      await remotePicker.getByRole('tab',{name:'Remote'}).click()
      await expect(remotePicker.getByRole('button',{name:/^main(?: |$)/})).toBeVisible()
      await remotePicker.getByRole('button',{name:/^main(?: |$)/}).hover()
      // This desktop has never watched a frame; the preview comes from the host.
      await expect(local.getByRole('complementary', { name: 'Remote session preview' }).locator(`[data-preview-pane="${pane}"] img`)).toBeVisible()
      let windows = (await command('rpc','diagnostics','{}')).windows.map((window: { nativeId: number }) => window.nativeId)
      await remotePicker.locator(`[data-remote-pane="${pane}"] [data-session-row]`).click()
      await expect.poll(() => application!.context().pages().some(page=>page.url().endsWith('/remote-client.html'))).toBe(true)
      await expect.poll(async () => (await Promise.all(application!.context().pages().filter(page => page.url().endsWith('/remote-client.html')).map(async page => ({ page, selection: await page.evaluate(() => (window as any).remoteClient.selection()) })))).some(item => !item.selection.metadata)).toBe(true)
      let attached = (await Promise.all(application!.context().pages().filter(page => page.url().endsWith('/remote-client.html')).map(async page => ({ page, selection: await page.evaluate(() => (window as any).remoteClient.selection()) })))).find(item => !item.selection.metadata)!.page
      // The video element mounts before the attached viewer finishes signaling.
      await expect(local.locator('[data-window-list] button')).not.toHaveCount(0, { timeout: 25000 })
      await expect(local.locator('[data-window-list] [data-window-id]')).toHaveCount(2)
      await expect(local.getByRole('contentinfo', { name: 'Browser status' }).getByRole('group', { name: 'Remote session controls' })).toHaveCount(0)
      await expect(attached.locator('header, form, button')).toHaveCount(0)
      await expect(local.locator('[data-remote-address]')).toHaveCount(1)
      await expect.poll(async () => {
        let rect = (await local.locator('[data-browser-content]').boundingBox())!
        let bounds = await application!.evaluate(({ BaseWindow }) => {
          for (let window of BaseWindow.getAllWindows()) for (let view of window.contentView.children) {
            if ('webContents' in view && (view as Electron.WebContentsView).webContents.getURL().endsWith('/remote-client.html')) return view.getBounds()
          }
        })
        return bounds && (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(bounds[key] - rect[key]) <= 1)
      }).toBe(true)
      await expect(attached.getByLabel('Remote browser')).toBeVisible()
      await attached.waitForFunction(()=>document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames>0,undefined,{timeout:15000})
      await expect.poll(async () => local.evaluate(async ({ host, session }) => Object.keys(await (window as any).bmux.remoteSessionPreviews(host, session)), { host: (await command('remote', 'status')).hostId, session: status.model.sessions[0].id })).toContain(pane)
      await expect(local.getByRole('button',{name:'Take control'})).toBeVisible()
      let current = await command('status')
      expect(current.model.sessions.find((session: { ephemeral?: boolean }) => session.ephemeral)).toMatchObject({ name: 'main', ephemeral: true, remote: { sessionId: status.model.sessions[0].id, clientId: attachedClient.id } })
      expect((await command('rpc','diagnostics','{}')).windows.map((window: { nativeId: number }) => window.nativeId)).toEqual(windows)
      let nativeId = (await command('rpc','diagnostics','{}')).windows.find((window: { id: string }) => window.id === attachedClient.id).nativeId
      let originalSize = await application!.evaluate(({ BaseWindow }, id) => {
        let window = BaseWindow.fromId(id)!, bounds = window.getContentBounds()
        setImmediate(() => window.setContentSize(640, 400))
        return bounds
      }, nativeId)
      let viewport = attached.getByRole('region', { name: 'Remote viewport' })
      await expect.poll(() => viewport.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true)
      await local.getByRole('button', { name: 'Take control', exact: true }).click()
      await expect(local.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      await test.step('A stream update preserves control and the desktop viewport', async () => {
        let geometry = await attached.getByLabel('Remote browser').evaluate(video => ({ width: video.getAttribute('width'), height: video.getAttribute('height'), mediaWidth: (video as HTMLVideoElement).videoWidth, mediaHeight: (video as HTMLVideoElement).videoHeight }))
        expect(geometry.mediaWidth).toBeGreaterThan(0)
        await application!.evaluate(({ ipcMain }) => {
          ;(globalThis as any).remoteViewerUpdates = []
          ipcMain.on('remote-client-update', (_event, state) => (globalThis as any).remoteViewerUpdates.push({ connected: state.connected, controlling: state.controlling }))
        })
        await attached.evaluate(async () => {
          let peer = (window as any).bmuxTestRemotePeers.at(-1) as RTCPeerConnection
          peer.ontrack!({ streams: [document.querySelector('video')!.srcObject] } as unknown as RTCTrackEvent)
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        })
        expect(await application!.evaluate(() => (globalThis as any).remoteViewerUpdates)).not.toContainEqual({ connected: false, controlling: false })
        expect(await attached.getByLabel('Remote browser').evaluate(video => ({ width: video.getAttribute('width'), height: video.getAttribute('height'), mediaWidth: (video as HTMLVideoElement).videoWidth, mediaHeight: (video as HTMLVideoElement).videoHeight }))).toEqual(geometry)
        await expect(local.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      })
      await viewport.evaluate(element => { element.scrollLeft = 64; element.scrollTop = 64 })
      await expect.poll(() => viewport.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual({ x: 64, y: 64 })
      let frame = (await viewport.boundingBox())!
      await attached.mouse.move(frame.x + 80, frame.y + 80)
      await attached.mouse.wheel(0, 120)
      await expect.poll(() => page.evaluate(() => document.body.dataset.wheel)).toBe('120')
      expect(await viewport.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual({ x: 64, y: 64 })
      await local.getByRole('button', { name: 'Address', exact: true }).click()
      let address = local.getByRole('textbox', { name: 'URL or search', exact: true })
      await address.fill(`${fixtureUrl}/?desktop=1`); await address.press('Enter')
      await expect.poll(() => page.url()).toBe(`${fixtureUrl}/?desktop=1`)
      await expect(local.getByRole('button', { name: 'Address', exact: true })).toHaveValue(`${fixtureUrl}/?desktop=1`)
      await local.getByRole('button', { name: 'Back', exact: true }).click()
      await expect.poll(() => page.url()).not.toContain('desktop=1')
      await local.evaluate(() => (window as any).bmux.command({ method: 'cycle-window', args: { direction: 1 } }))
      await expect(local.getByRole('button', { name: 'Address', exact: true })).toHaveValue(`${fixtureUrl}/?remote-tab=2`)
      await expect(local.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      await local.locator('[data-window-list] button').first().click()
      await expect(local.getByRole('button', { name: 'Address', exact: true })).not.toHaveValue(`${fixtureUrl}/?remote-tab=2`)
      await expect(local.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      await local.getByRole('button', { name: 'Release control', exact: true }).click()
      await expect(local.getByRole('button', { name: 'Take control', exact: true })).toBeVisible()
      await application!.evaluate(({ BaseWindow }, { id, size }) => {
        setImmediate(() => BaseWindow.fromId(id)?.setContentSize(size.width, size.height))
      }, { id: nativeId, size: originalSize })
      await local.getByRole('button', { name: 'Take control', exact: true }).click()
      await expect(local.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      let hostPaneIds = (await command('status')).model.sessions.find((session: { id: string }) => session.id === status.model.sessions[0].id).windows.flatMap((window: { panes: { id: string }[] }) => window.panes.map(pane => pane.id))
      await expect.poll(async () => (await command('status')).remoteControl[status.model.sessions[0].id]?.owner).toBeTruthy()
      desktopOwner = (await command('status')).remoteControl[status.model.sessions[0].id].owner
      await test.step('OS Open URL leaves the remote host running and opens a normal local window', async () => {
        await application!.evaluate(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), `${fixtureUrl}/?external-local=1`)
        await expect.poll(async () => (await command('status')).model.clients.find((client: { id: string }) => client.id === attachedClient.id).sessionId).toBe(status.model.sessions[0].id)
        await expect.poll(() => application!.context().pages().some(page => page.url() === `${fixtureUrl}/?external-local=1`)).toBe(true)
        let next = await command('status'), host = next.model.sessions.find((session: { id: string }) => session.id === status.model.sessions[0].id)
        expect(host.windows.flatMap((window: { panes: { id: string }[] }) => window.panes.map(pane => pane.id))).toEqual(expect.arrayContaining(hostPaneIds))
        await expect.poll(async () => (await command('status')).remoteControl[host.id]).toBeUndefined()
      })
      await expect.poll(() => attached.isClosed()).toBe(true)
      await expect.poll(async () => (await command('status')).model.sessions.some((session: { ephemeral?: boolean }) => session.ephemeral)).toBe(false)
      expect((await command('status')).model.clients.find((client: { id: string }) => client.id === attachedClient.id).sessionId).toBe(status.model.sessions[0].id)
    },{timeout:40000})
    await test.step('Close hosted sessions from the desktop list and pane header', async () => {
      let focusControls = () => test.step('Focus the native controls after attaching the remote view', async () => {
        let id = (await command('rpc', 'diagnostics', '{}')).windows.find((window: { id: string }) => window.id === attachedClient.id).nativeId
        await focusWindow(id, 'remote session controls')
        let contents = await application!.evaluate(({ BaseWindow }, { id, url }) => {
          let view = BaseWindow.fromId(id)!.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView
          setImmediate(() => view.webContents.focus())
          return view.webContents.id
        }, { id, url: local.url() })
        await expect.poll(() => application!.evaluate(({ webContents }, id) => webContents.fromId(id)?.isFocused(), contents)).toBe(true)
      })
      await focusWindow((await command('rpc', 'diagnostics', '{}')).windows.find((window: { id: string }) => window.id === attachedClient.id).nativeId, 'desktop session list')
      await local.getByRole('button', { name: 'Sessions', exact: true }).click()
      let picker = local.getByRole('group', { name: 'Choose remote session', exact: true })
      let lastActive = picker.locator('[data-session-target]:not([data-preview-window]) [data-session-row][aria-current="true"]')
      await expect(lastActive).toContainText('main')
      await expect(lastActive).toBeFocused()
      await expect(lastActive.locator('time')).toBeVisible()
      await expect(local.getByRole('complementary', { name: 'Remote session preview' }).locator(`[data-preview-pane="${pane}"] img`)).toBeVisible()
      await expect(picker.getByRole('button', { name: /^uncontrolled(?: |$)/ })).toBeVisible()
      await picker.getByRole('button', { name: 'Close remote session uncontrolled', exact: true }).click()
      let confirmation = picker.getByRole('alertdialog', { name: 'Close remote session uncontrolled?' })
      await expect(confirmation.getByRole('button', { name: 'yes', exact: true })).toBeFocused()
      await local.keyboard.press('n')
      await expect(confirmation).toHaveCount(0)
      expect((await command('status')).model.sessions.some((session: { id: string }) => session.id === other.id)).toBe(true)
      await local.keyboard.press('x')
      await expect(confirmation).toBeVisible()
      await local.keyboard.press('y')
      await expect(picker.getByRole('button', { name: /^uncontrolled(?: |$)/ })).toHaveCount(0)
      await expect.poll(async () => (await command('status')).model.sessions.some((session: { id: string }) => session.id === other.id)).toBe(false)
      await expect(picker.locator('[data-remote-tree]:has([data-session-target] [aria-current="true"]) [data-session-row]:focus')).toHaveCount(1)
      await local.keyboard.press('Escape')
      let disposable = await command('new-session', '-s', 'close-from-viewer')
      await command('rpc', 'new-window', JSON.stringify({ session: disposable.id, url: `${fixtureUrl}/?remaining-page=1` }))
      let disposablePane = disposable.windows[0].panes[0].id
      await local.getByRole('button', { name: 'Sessions', exact: true }).click()
      let disposableRow = picker.getByRole('button', { name: /^close-from-viewer(?: |$)/ })
      await expect(disposableRow).toBeVisible({ timeout: 10000 })
      await disposableRow.click()
      await expect(local.getByRole('button', { name: 'Take control', exact: true })).toBeEnabled({ timeout: 25000 })
      await focusControls()
      await local.getByRole('button', { name: 'Take control', exact: true }).click()
      await expect(local.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      await local.getByRole('button', { name: 'Release control', exact: true }).click()
      await expect(local.getByRole('button', { name: 'Take control', exact: true })).toBeVisible()
      await local.getByRole('button', { name: 'Sessions', exact: true }).click()
      let remoteWindow = picker.locator(`[data-remote-pane="${disposablePane}"]`)
      await expect(remoteWindow.getByRole('button', { name: /^Close remote page / })).toHaveCount(0)
      // Host-side topology changes appear without creating a local remote wrapper.
      await command('rpc', 'kill-pane', JSON.stringify({ pane: disposablePane, confirm: true }))
      await expect(remoteWindow).toHaveCount(0, { timeout: 15000 })
      await expect(disposableRow).toBeVisible()
      await local.keyboard.press('Escape')
      await expect(local.getByRole('button', { name: 'Address', exact: true })).toHaveValue(`${fixtureUrl}/?remaining-page=1`, { timeout: 15000 })
      await expect(local.getByRole('button', { name: 'Take control', exact: true })).toBeEnabled({ timeout: 15000 })
      await focusControls()
      await local.getByRole('button', { name: 'Take control', exact: true }).click()
      await expect(local.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      await local.getByRole('button', { name: 'Close session', exact: true }).click()
      await expect(local.getByRole('alertdialog', { name: 'Close remote session close-from-viewer?' })).toBeVisible()
      await local.keyboard.press('y')
      await expect.poll(async () => (await command('status')).model.sessions.some((session: { id: string }) => session.id === disposable.id)).toBe(false)
      await expect(local.locator('[data-remote-address]')).toHaveCount(0)
      await expect.poll(async () => (await command('status')).model.sessions.some((session: { ephemeral?: boolean }) => session.ephemeral)).toBe(false)
    }, { timeout: 60000 })
    await test.step('One desktop workspace streams two panes and reassigns its own slot without releasing control', async () => {
      let hosted = await command('new-session', '-s', 'workspace-streams')
      let first = hosted.windows[0].panes[0].id
      await command('navigate', '-t', first, `${fixtureUrl}/?stream=1`)
      let second = await command('rpc', 'split-window', JSON.stringify({ pane: first, axis: 'horizontal', url: `${fixtureUrl}/?stream=2` }))
      let third = await command('rpc', 'split-window', JSON.stringify({ pane: second.id, axis: 'vertical', url: `${fixtureUrl}/?stream=3` }))
      for (let pane of [first, second.id, third.id]) await command('wait', '-t', pane, '--selector', 'input')
      await expect.poll(() => local.evaluate(async id => (await (window as any).bmux.remoteSessions()).hosts.flatMap((host: { sessions: { id: string; panes: unknown[] }[] }) => host.sessions).find((session: { id: string }) => session.id === id)?.panes.length, hosted.id), { timeout: 10000 }).toBe(3)
      await local.evaluate(async ({ host, session }) => (window as any).bmux.openRemote(host, session), { host: (await command('remote', 'status')).hostId, session: hosted.id })
      await expect(local.locator('[data-pane-id]')).toHaveCount(3)
      let selected = local.locator('[data-pane-id][data-focused-pane="true"]')
      await expect(selected.getByRole('button', { name: 'Take control', exact: true })).toBeEnabled({ timeout: 15000 })
      await selected.getByRole('button', { name: 'Take control', exact: true }).click()
      await expect.poll(async () => (await command('status')).remoteControl[hosted.id]?.owner).toBe(desktopOwner)
      await expect(selected.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      let lease = (await command('status')).remoteControl[hosted.id]
      expect(lease.owner).toBe(desktopOwner)
      let slots = async () => Number((await pool.query('SELECT count(*) FROM bmux_stream_leases WHERE viewer=$1 AND expires>now()', [lease.owner])).rows[0].count)
      await expect.poll(slots).toBe(2)
      let pane = `remote:${attachedClient.id}:pane:${third.id}`
      await local.evaluate(pane => (window as any).bmux.command({ method: 'select-pane', args: { pane } }), pane)
      await expect(selected).toHaveAttribute('data-pane-id', pane)
      await expect(selected.getByRole('button', { name: 'Release control', exact: true })).toBeVisible()
      await expect.poll(slots).toBe(2)
      await expect.poll(async () => {
        let views = application!.context().pages().filter(page => page.url().endsWith('/remote-client.html'))
        let decoded = await Promise.all(views.map(page => page.evaluate(() => { let video = document.querySelector('video'); return !!video && video.getVideoPlaybackQuality().totalVideoFrames > 0 }).catch(() => false)))
        return decoded.filter(Boolean).length
      }, { timeout: 15000 }).toBe(2)
      expect((await command('status')).remoteControl[hosted.id].owner).toBe(lease.owner)
      await selected.getByRole('button', { name: 'Disconnect', exact: true }).click()
      await expect.poll(slots).toBe(0)
      let persisted = (await command('status')).model.sessions.find((session: { id: string }) => session.id === hosted.id)
      expect(persisted.windows[0].panes).toHaveLength(3)
      await command('rpc', 'kill-session', JSON.stringify({ session: hosted.id, confirm: true }))
    }, { timeout: 45000 })
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
      await expect(viewer.getByRole('complementary', { name: 'Sessions', exact: true })).toHaveCount(0)
    },{timeout:30000})
    failed = false
  } finally {
    // TestInfo's final status is assigned after this callback returns.
    if (application) await recordNativeFocus(application,test.info(),failed)
    if (failed && application) {
      let state = await Promise.race([
        Promise.all([
          application.evaluate(() => (globalThis as any).bmuxTestRemoteMessages),
          Promise.all(application.context().pages().map(page => page.evaluate(() => ({
            page: location.pathname.endsWith('/remote-peer.html') ? 'transport' : location.protocol === 'http:' ? 'viewer-or-fixture' : 'chrome',
            peers: ((window as any).bmuxTestRemotePeers ?? []).map((peer: RTCPeerConnection) => ({ connection: peer.connectionState, ice: peer.iceConnectionState, gathering: peer.iceGatheringState, signaling: peer.signalingState, local: peer.localDescription?.type, remote: peer.remoteDescription?.type })),
          })).catch(() => ({ error: 'Renderer unavailable' })))),
        ]),
        new Promise(resolve => { let timer = setTimeout(() => resolve({ error: 'Remote state capture timed out' }), 5000); timer.unref() }),
      ]).catch(() => ({ error: 'Remote state unavailable' }))
      console.log('REMOTE_TRANSPORT_DIAGNOSTICS', JSON.stringify(state))
      await test.info().attach('remote-transport', { body: JSON.stringify(state, null, 2), contentType: 'application/json' })
    }
    if (failed && applicationProcess) console.log('REMOTE_PROCESS_DIAGNOSTICS', { pid:applicationProcess.pid,exitCode:applicationProcess.exitCode,signalCode:applicationProcess.signalCode })
    if (failed && process.platform === 'linux' && process.env.BMUX_NATIVE_CRASH_DIAGNOSTICS === '1' && applicationProcess?.exitCode === null) {
      // Capture only stack frames, without arguments or profile memory, before
      // bounded shutdown kills an unresponsive native process.
      let trace = await promisify(execFile)('gdb', ['--batch', '-ex', 'set print frame-arguments none', '-ex', 'thread apply all bt', '-p', String(applicationProcess.pid)], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 }).catch(error => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }))
      let output = test.info().outputPath('native-hang.txt')
      await fs.writeFile(output, `${trace.stdout}\n${trace.stderr}`)
      await test.info().attach('native-hang', { path: output, contentType: 'text/plain' })
    }
    await closeTestApplication(application,applicationProcess)
    server.kill('SIGTERM')
    await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',()=>resolve());setTimeout(()=>{server.kill('SIGKILL');resolve()},3000).unref()})
    await new Promise<void>(resolve=>{fixture.close(()=>resolve());fixture.closeAllConnections()})
    await pool.query('DELETE FROM bmux_stream_leases WHERE owner=$1',[owner]); await pool.query('DELETE FROM bmux_attention WHERE service=$1',[service]); await pool.query('DELETE FROM bmux_host_presence WHERE service=$1',[service])
    await pool.query('DELETE FROM bmux_usage WHERE service=$1',[service]); await pool.query('DELETE FROM bmux_services WHERE id=$1',[service]); await pool.query('DELETE FROM bmux_devices WHERE owner=$1',[owner]); await pool.query('DELETE FROM bmux_logins WHERE owner=$1',[owner]); await pool.end()
    await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})
  }
})
