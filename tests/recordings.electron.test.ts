import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

test('recordings built-in plugin opens its folder and preserves playable session history without status bar controls',async()=>{
  let directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmux-recording-')),application:Awaited<ReturnType<typeof electron.launch>>|undefined,observer:ChildProcess|undefined
  let defaultFolder=path.join(os.homedir(),'Movies','BMUX'),folderExisted=await fs.stat(defaultFolder).then(()=>true,()=>false)
  let server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Recording fixture</title><style>body{margin:0;background:#181818;color:white;font:32px monospace}h1{padding:32px}</style><h1>Recording fixture</h1><canvas width="480" height="160"></canvas><script>let n=0,c=document.querySelector("canvas").getContext("2d");setInterval(()=>{c.fillStyle=n++%2?"#228844":"#224488";c.fillRect(0,0,480,160)},100)</script>')})
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    let url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,output=path.join(directory,'movies'),config=path.join(directory,'config.yaml')
    await fs.writeFile(config,'vimEditing: false\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
    let launch=async()=>{application=await electron.launch({args:[process.cwd()],env:{...process.env,BMUX_DATA_DIR:directory,BMUX_CONFIG:config,BMUX_BACKGROUND:'0'}});await expect.poll(()=>application!.context().pages().some(page=>page.url().endsWith('/renderer/index.html'))).toBe(true);return application.context().pages().find(page=>page.url().endsWith('/renderer/index.html'))!}
    let chrome=await launch(),rpc=(method:string,args:Record<string,unknown>={})=>chrome.evaluate(({method,args})=>(window as any).bmux.command({method,args}),{method,args})
    let state=await chrome.evaluate(()=>(window as any).bmux.state()),client=state.model.clients.find((item:any)=>item.id===state.clientId),pane=client.paneId
    let openRecordings=async()=>{
      await rpc('activate-client',{client:(await chrome.evaluate(()=>(window as any).bmux.state())).clientId})
      await chrome.getByRole('button',{name:'Command prompt'}).click()
      let command=chrome.getByRole('combobox',{name:'Command',exact:true});await command.fill('plugins');await command.press('Enter')
      let panel=chrome.getByRole('dialog',{name:'Plugins',exact:true})
      await expect(panel.getByRole('heading',{name:'Built-in',exact:true})).toBeVisible()
      await panel.getByRole('button',{name:'Recordings',exact:true}).click()
      return panel.getByRole('region',{name:'Recordings',exact:true})
    }
    await expect(chrome.getByRole('button',{name:'Record pane',exact:true})).toHaveCount(0)
    await expect(chrome.getByRole('button',{name:'Show recordings',exact:true})).toHaveCount(0)
    let recordings=await openRecordings()
    await expect(recordings).toContainText('No recorded sessions yet.')
    await application!.evaluate(({shell})=>{
      let calls:string[]=[];(globalThis as any).bmuxTestFolder={calls,fail:true}
      shell.openPath=async directory=>{calls.push(directory);return (globalThis as any).bmuxTestFolder.fail?'Fixture folder unavailable':''}
    })
    await recordings.getByRole('button',{name:'Open recordings folder',exact:true}).click()
    await expect(recordings.getByRole('alert')).toHaveText('Fixture folder unavailable')
    await application!.evaluate(()=>{(globalThis as any).bmuxTestFolder.fail=false})
    await recordings.getByRole('button',{name:'Open recordings folder',exact:true}).click()
    await expect(recordings.getByRole('alert')).toHaveCount(0)
    expect(await application!.evaluate(()=>(globalThis as any).bmuxTestFolder.calls)).toEqual([defaultFolder,defaultFolder])
    expect((await fs.stat(defaultFolder)).isDirectory()).toBe(true)
    expect(await rpc('record.list')).toEqual([])
    await chrome.keyboard.press('Escape');await chrome.keyboard.press('Escape')
    await rpc('navigate',{pane,url,agentId:'fixture'})
    let observed:Buffer[]=[]
    observer=spawn(process.execPath,[path.resolve('bin/bmux.mjs'),'observe','-t',pane,'--output',output,'--id','fixture-recording'],{env:{...process.env,BMUX_DATA_DIR:directory}})
    observer.stdout!.on('data',chunk=>observed.push(chunk))
    let observedDone=new Promise<number|null>((resolve,reject)=>{observer!.once('exit',resolve);observer!.once('error',reject)})
    await expect.poll(async()=>((await rpc('record.list')) as any[]).some(item=>item.id==='fixture-recording')).toBe(true)
    let first={id:'fixture-recording'}
    expect(await rpc('record.start',{pane,output,id:first.id})).toMatchObject({id:first.id})
    await expect.poll(async()=>((await rpc('record.list')) as any[]).find(item=>item.id===first.id)?.state).toBe('recording')
    await promisify(execFile)(process.execPath,[path.resolve('bin/bmux.mjs'),'rpc','cdp',JSON.stringify({pane,agentId:'recording-fixture',method:'Input.dispatchMouseEvent',params:{type:'mouseMoved',x:300,y:200}})],{env:{...process.env,BMUX_DATA_DIR:directory},timeout:30000})
    let fixture=application!.context().pages().find(page=>page.url()===`${url}/`)!;await expect(fixture.locator('#bmux-virtual-mouse')).toHaveCSS('display','block')
    await expect.poll(async()=>{let clips=((await rpc('record.list')) as any[]).find(item=>item.id===first.id)?.clips;return clips?.[0] ? (await fs.stat(clips[0].file)).size : 0},{timeout:15000}).toBeGreaterThan(4096)
    expect((await chrome.evaluate(()=>(window as any).bmux.state())).model.clients.find((item:any)=>item.id===client.id).paneId).toBe(pane)
    await rpc('record.stop',{id:first.id})
    await expect.poll(async()=>((await rpc('record.list')) as any[]).find(item=>item.id===first.id)?.clips[0]?.state,{timeout:15000}).toMatch(/^saved/)
    expect(await observedDone).toBe(0);observer=undefined
    let sourceClip=((await rpc('record.list')) as any[])[0].clips[0]
    expect(Buffer.concat(observed)).toEqual(await fs.readFile(sourceClip.file))
    expect([...Buffer.concat(observed).subarray(0,4)]).toEqual([0x1a,0x45,0xdf,0xa3])
    let clip=((await rpc('record.list')) as any[])[0].clips[0],file=clip.state==='saved'?clip.file.replace(/\.webm$/,'.mp4'):clip.file
    let player=path.join(directory,'player.html');await fs.writeFile(player,`<!doctype html><title>Recorded video</title><video controls autoplay muted src="${pathToFileURL(file).href}"></video>`)
    let artifact=path.resolve('artifacts',`recorded-pane-${test.info().repeatEachIndex}.${clip.state==='saved'?'mp4':'webm'}`);await fs.mkdir(path.dirname(artifact),{recursive:true});await fs.copyFile(file,artifact)
    await test.info().attach('recorded-pane',{path:artifact,contentType:clip.state==='saved'?'video/mp4':'video/webm'})
    await application!.evaluate(async({BrowserWindow},file)=>{let window=new BrowserWindow({show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});(globalThis as any).bmuxTestRecordingPlayer=window;await window.loadFile(file)},player)
    await expect.poll(()=>application!.context().pages().some(page=>page.url()===pathToFileURL(player).href)).toBe(true)
    let video=application!.context().pages().find(page=>page.url()===pathToFileURL(player).href)!
    await expect.poll(()=>video.locator('video').evaluate((video:HTMLVideoElement)=>video.videoWidth)).toBeGreaterThan(0)
    await expect.poll(()=>video.locator('video').evaluate((video:HTMLVideoElement)=>video.readyState)).toBeGreaterThanOrEqual(2)
    await test.info().attach('recorded-frame',{body:await video.locator('video').screenshot({path:artifact+'.png'}),contentType:'image/png'});await video.close()
    await closeTestApplication(application);application=undefined;chrome=await launch()
    expect((await rpc('record.list')) as any[]).toHaveLength(1)
    recordings=await openRecordings()
    await expect(recordings.locator('article')).toHaveCount(1)
    await expect(recordings.locator('code')).toContainText(first.id)
    await expect(recordings.getByRole('button',{name:'Play',exact:true})).toBeVisible()
    await expect(recordings.getByRole('button',{name:'Show files',exact:true})).toBeVisible()
    await fs.mkdir(path.resolve('artifacts'),{recursive:true})
    await test.info().attach('recordings-plugin',{body:await chrome.screenshot({path:path.resolve('artifacts/recordings-plugin.png')}),contentType:'image/png'})
    await chrome.keyboard.press('Escape');await chrome.keyboard.press('Escape')
    await chrome.getByRole('button',{name:'Command prompt'}).click()
    let command=chrome.getByRole('combobox',{name:'Command',exact:true});await command.fill('activity');await command.press('Enter')
    await expect(chrome.getByRole('dialog',{name:'Activity',exact:true})).toBeVisible()
    await expect(chrome.getByRole('region',{name:'Recordings',exact:true})).toHaveCount(0)
    await chrome.keyboard.press('Escape')
    await rpc('record.start',{pane,output,id:'second-recording'});await rpc('record.stop',{id:'second-recording'})
    expect(JSON.parse(await fs.readFile(path.join(directory,'recordings.json'),'utf8')).map((item:any)=>item.id)).toContain(first.id)
  }finally{observer?.kill('SIGTERM');await closeTestApplication(application);await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(directory,{recursive:true,force:true});if(!folderExisted)await fs.rmdir(defaultFolder).catch(()=>undefined)}
})
