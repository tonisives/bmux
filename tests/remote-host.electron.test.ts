import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { Pool } from 'pg'

test('discovers a host, watches its live page, coordinates control, and revokes a viewer', async () => {
  test.skip(!process.env.BMUX_TEST_DATABASE_URL, 'Requires a disposable local PostgreSQL fixture')
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-test-'))
  let pool = new Pool({ connectionString: process.env.BMUX_TEST_DATABASE_URL, max: 2 })
  let origin = 'http://127.0.0.1:18889', owner = randomBytes(12).toString('hex'), service = `test-${owner}`, token = randomBytes(32).toString('hex'), cookie = randomBytes(32).toString('hex')
  let digest = (value: string) => createHash('sha256').update(value).digest('hex')
  let hostKey = generateKeyPairSync('ed25519'), viewerKey = generateKeyPairSync('ed25519')
  let hostPublic = hostKey.publicKey.export({ format: 'jwk' }), viewerPublic = viewerKey.publicKey.export({ format: 'jwk' })
  let fixture = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Remote fixture</title><input autofocus aria-label="Fixture input"><div id="tick"></div><script>window.memory="retained";setInterval(()=>document.querySelector("#tick").textContent=Date.now(),100)</script>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  let fixtureUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
  await pool.query(await fs.readFile('remote/schema.sql', 'utf8'))
  await pool.query('INSERT INTO bmux_services (id,owner,token_hash,public_key) VALUES ($1,$2,$3,$4)', [service, owner, digest(token), hostPublic])
  await pool.query("INSERT INTO bmux_logins VALUES ($1,$2,now()+interval '1 hour')", [digest(cookie),owner])
  await fs.writeFile(path.join(directory,'identity.pem'),hostKey.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600})
  await fs.writeFile(path.join(directory,'remote.json'),JSON.stringify({url:origin,token,identityFile:path.join(directory,'identity.pem'),approvedClients:{[digest(viewerPublic.x!)]:viewerPublic}}),{mode:0o600})
  await fs.writeFile(path.join(directory,'config.yaml'),'browser:\n  autoUpdateFilters: false\n')
  let server = spawn(process.execPath,['--import','tsx','remote/server.ts'],{env:{...process.env,DATABASE_URL:process.env.BMUX_TEST_DATABASE_URL,PORT:'18889',BMUX_PUBLIC_ORIGIN:origin,BMUX_GOOGLE_CLIENT_ID:'fixture',BMUX_TURN_SECRET:'fixture',BMUX_TURN_URLS:'turn:127.0.0.1:3478'},stdio:'ignore'})
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await expect.poll(async()=>{try{return(await fetch(`${origin}/health`)).ok}catch{return false}}).toBe(true)
    application = await electron.launch({args:[process.cwd(),'--background'],env:{...process.env,BMUX_DATA_DIR:directory,BMUX_CONFIG:path.join(directory,'config.yaml'),BMUX_REMOTE_CONFIG:path.join(directory,'remote.json'),BMUX_BACKGROUND:'1'}})
    let command = async (...args:string[]) => JSON.parse((await promisify(execFile)(process.execPath,['bin/bmux.mjs',...args],{env:{...process.env,BMUX_DATA_DIR:directory}})).stdout).result
    let status = await command('status'), pane = status.model.sessions[0].windows[0].panes[0].id
    await command('navigate','-t',pane,fixtureUrl)
    await command('wait','-t',pane,'--selector','input')
    await command('eval','-t',pane,'document.querySelector("input").focus()')
    await expect.poll(async()=>(await command('remote','status')).connected).toBe(true)
    let host = await command('remote','status')
    let other = await command('new-session','-s','uncontrolled')
    let otherPane = other.windows[0].panes[0].id
    await application.evaluate(async({BrowserWindow,session},{origin,cookie})=>{
      await session.defaultSession.cookies.set({url:origin,name:'bmux_session',value:cookie,httpOnly:true})
      session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('http://127.0.0.1:') && !details.url.startsWith('ws://127.0.0.1:')}))
      let viewer = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      await viewer.loadURL(origin)
    },{origin,cookie})
    await expect.poll(()=>application!.context().pages().some(page=>page.url()===origin+'/')).toBe(true)
    let viewer = application.context().pages().find(page=>page.url()===origin+'/')!
    await viewer.evaluate(key=>localStorage.setItem('bmux-device-key',JSON.stringify(key)),viewerKey.privateKey.export({format:'jwk'}))
    await viewer.getByRole('button',{name:'Reconnect',exact:true}).click()
    await expect(viewer.getByRole('option',{name:new RegExp(service)})).toHaveCount(1)
    await viewer.getByLabel('Host',{exact:true}).selectOption(host.hostId)
    await viewer.getByLabel('Trusted host fingerprint').fill(host.fingerprint)
    await viewer.getByRole('button',{name:'Watch',exact:true}).click()
    await expect(viewer.getByLabel('Pane',{exact:true})).toBeVisible()
    await expect.poll(()=>viewer.evaluate(()=>document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames),{timeout:15000}).toBeGreaterThan(5)
    expect(await command('eval','-t',pane,'window.memory')).toBe('retained')
    await viewer.getByRole('button',{name:'Take control',exact:true}).click()
    await expect(viewer.getByText('You control this session')).toBeVisible()
    await expect(command('eval','-t',pane,'window.memory')).rejects.toThrow()
    expect(await command('eval','-t',otherPane,'1+1')).toBe(2)
    await expect(command('dark','on','-t',otherPane,'--scope','global')).rejects.toThrow()
    await expect(command('dark','on','-t',otherPane,'--scope','profile')).rejects.toThrow()
    await viewer.getByLabel('Type into page').fill('remote text')
    await viewer.getByRole('button',{name:'Type',exact:true}).click()
    let page = application.context().pages().find(page=>page.url()===fixtureUrl+'/')!
    await expect(page.getByLabel('Fixture input')).toHaveValue('remote text')
    await viewer.getByRole('button',{name:'Release control',exact:true}).click()
    await expect.poll(async()=>await command('eval','-t',pane,'window.memory')).toBe('retained')
    await command('rpc','remote.job',JSON.stringify({id:'job',attempt:'one'}))
    await command('rpc','remote.job',JSON.stringify({id:'job',attempt:'one',result:'succeeded'}))
    await command('rpc','remote.job',JSON.stringify({id:'job',attempt:'one',result:'succeeded'}))
    await expect.poll(async()=>(await pool.query('SELECT succeeded FROM bmux_usage WHERE service=$1',[service])).rows[0]?.succeeded,{timeout:10000}).toBe('1')
    let response = await fetch(`${origin}/api/revoke`,{method:'POST',headers:{Origin:origin,Cookie:`bmux_session=${cookie}`,'Content-Type':'application/json'},body:JSON.stringify({id:digest(viewerPublic.x!)})})
    expect(response.ok).toBe(true)
    await expect(viewer.getByText('Disconnected. Reconnect to continue.')).toBeVisible()
  } finally {
    await application?.close()
    server.kill('SIGTERM')
    await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',()=>resolve());setTimeout(()=>{server.kill('SIGKILL');resolve()},3000).unref()})
    await new Promise<void>(resolve=>fixture.close(()=>resolve()))
    await pool.query('DELETE FROM bmux_usage WHERE service=$1',[service]); await pool.query('DELETE FROM bmux_services WHERE id=$1',[service]); await pool.query('DELETE FROM bmux_devices WHERE owner=$1',[owner]); await pool.query('DELETE FROM bmux_logins WHERE owner=$1',[owner]); await pool.end()
    await fs.rm(directory,{recursive:true,force:true})
  }
})
