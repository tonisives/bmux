import { test, expect, _electron as electron } from '@playwright/test'
import { closeTestApplication } from './electron-fixture'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

test('records a pane without changing selection, saves playable video, and preserves history across restarts',async()=>{
  let directory=await fs.mkdtemp(path.join(os.tmpdir(),'bmux-recording-')),application:Awaited<ReturnType<typeof electron.launch>>|undefined
  let server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Recording fixture</title><style>body{margin:0;background:#181818;color:white;font:32px monospace}h1{padding:32px}</style><h1>Recording fixture</h1><canvas width="480" height="160"></canvas><script>let n=0,c=document.querySelector("canvas").getContext("2d");setInterval(()=>{c.fillStyle=n++%2?"#228844":"#224488";c.fillRect(0,0,480,160)},100)</script>')})
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    let url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,output=path.join(directory,'movies'),config=path.join(directory,'config.yaml')
    await fs.writeFile(config,'vimEditing: false\nbrowser:\n  adblock: false\n  autoUpdateFilters: false\n')
    let launch=async()=>{application=await electron.launch({args:[process.cwd()],env:{...process.env,BMUX_DATA_DIR:directory,BMUX_CONFIG:config,BMUX_BACKGROUND:'0'}});await expect.poll(()=>application!.context().pages().some(page=>page.url().endsWith('/renderer/index.html'))).toBe(true);return application.context().pages().find(page=>page.url().endsWith('/renderer/index.html'))!}
    let chrome=await launch(),rpc=(method:string,args:Record<string,unknown>={})=>chrome.evaluate(({method,args})=>(window as any).bmux.command({method,args}),{method,args})
    let state=await chrome.evaluate(()=>(window as any).bmux.state()),client=state.model.clients.find((item:any)=>item.id===state.clientId),pane=client.paneId
    await rpc('navigate',{pane,url,agentId:'fixture'})
    let first=await rpc('record.start',{pane,output,id:'fixture-recording'}) as any
    expect(await rpc('record.start',{pane,output,id:first.id})).toMatchObject({id:first.id})
    await expect.poll(async()=>((await rpc('record.list')) as any[]).find(item=>item.id===first.id)?.state).toBe('recording')
    await expect.poll(async()=>{let clips=((await rpc('record.list')) as any[]).find(item=>item.id===first.id)?.clips;return clips?.[0] ? (await fs.stat(clips[0].file)).size : 0},{timeout:15000}).toBeGreaterThan(4096)
    expect((await chrome.evaluate(()=>(window as any).bmux.state())).model.clients.find((item:any)=>item.id===client.id).paneId).toBe(pane)
    await rpc('record.stop',{id:first.id})
    await expect.poll(async()=>((await rpc('record.list')) as any[]).find(item=>item.id===first.id)?.clips[0]?.state,{timeout:15000}).toMatch(/^saved/)
    let clip=((await rpc('record.list')) as any[])[0].clips[0],file=clip.state==='saved'?clip.file.replace(/\.webm$/,'.mp4'):clip.file
    let opened=application!.waitForEvent('window');await application!.evaluate(async({BrowserWindow},file)=>{let window=new BrowserWindow({show:false,webPreferences:{sandbox:true}});await window.loadFile(file)},file);let video=await opened;await expect.poll(()=>video.locator('video').evaluate((video:HTMLVideoElement)=>video.videoWidth)).toBeGreaterThan(0);await video.close()
    await closeTestApplication(application);application=undefined;chrome=await launch()
    expect((await rpc('record.list')) as any[]).toHaveLength(1)
    await rpc('record.start',{pane,output,id:'second-recording'});await rpc('record.stop',{id:'second-recording'})
    expect(JSON.parse(await fs.readFile(path.join(directory,'recordings.json'),'utf8')).map((item:any)=>item.id)).toContain(first.id)
  }finally{await closeTestApplication(application);await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(directory,{recursive:true,force:true})}
})
