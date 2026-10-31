import { BrowserWindow, ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createFrameCapture } from './frame-capture'
import { remoteWebPreferences } from '../shared/remote-web-preferences'
import type { createRuntime } from './runtime'
import type { createLocalRemote } from './remote-client'
import type { ActivityEpisode } from '../shared/activity'

type Options = { sourcePane?: string; pane?: string; host?: string; session?: string; generation?: string; episode?: string; id?: string; output?: string }
type Clip = { pane: string; file: string; state: string; window: BrowserWindow; writer: fs.WriteStream; stop?: () => void; timer?: ReturnType<typeof setTimeout>; closed?: boolean }
type Recording = { id: string; options: Options; startedAt: number; finishedAt?: number; state: string; error?: string; gaps?: {pane:string;at:number;open:boolean}[]; directory: string; clips: Clip[]; timer?: ReturnType<typeof setTimeout> }
export let createRecordings = (directory: string, runtime: ReturnType<typeof createRuntime>, remote: ReturnType<typeof createLocalRemote>) => {
  let records = new Map<string, Recording>(), contents = new Map<WebContents,{ record: Recording; clip: Clip }>()
  let manifest = path.join(directory,'recordings.json')
  let save = () => { fs.mkdirSync(directory,{recursive:true}); fs.writeFileSync(manifest+'.tmp',JSON.stringify(history()),{mode:0o600}); fs.renameSync(manifest+'.tmp',manifest) }
  let list = () => [...records.values()].map(({id,options,startedAt,finishedAt,state,error,gaps,directory: destination,clips}) => ({id,options,startedAt,finishedAt,state,error,gaps,directory:destination,clips:clips.map(({pane,file,state,writer})=>({pane,file,state,complete:writer.writableFinished}))}))
  let previous: ReturnType<typeof list> = []
  try { previous = JSON.parse(fs.readFileSync(manifest,'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let history = () => [...previous.filter(old => !records.has(old.id)).map(old => ({...old,state:old.finishedAt ? old.state : 'interrupted'})),...list()]
  let recordingDirectory = (output?: string) => {
    let base=output??(process.platform==='darwin'&&fs.existsSync('/Volumes/sam')?'/Volumes/sam/movies/bmux/observations':path.join(os.homedir(),'Movies','BMUX'))
    if(!path.isAbsolute(base))throw new Error('Choose an absolute recording directory')
    if(base.startsWith('/Volumes/sam/')&&(!fs.existsSync('/Volumes/sam')||fs.statSync('/Volumes/sam').dev===fs.statSync('/Volumes').dev))throw new Error('Recording volume is not mounted')
    return base
  }
  let folder = async () => {
    let base=recordingDirectory();fs.mkdirSync(base,{recursive:true,mode:0o700})
    let error=await shell.openPath(base);if(error)throw new Error(error)
    return {directory:base}
  }
  let finalize = (record: Recording, clip: Clip) => {
    if (clip.closed) return
    clip.closed = true; clearTimeout(clip.timer); clip.stop?.(); contents.delete(clip.window.webContents)
    clip.writer.end(() => {
      if (!clip.window.isDestroyed()) clip.window.destroy()
      let output = clip.file.replace(/\.webm$/,'.mp4'), temp = output.replace(/\.mp4$/,'.partial.mp4')
      let ffmpeg = spawn(process.env.BMUX_FFMPEG ?? (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg'),['-y','-i',clip.file,'-an','-c:v','libx264','-threads','4','-pix_fmt','yuv420p','-movflags','+faststart',temp],{stdio:'ignore',windowsHide:true})
      ffmpeg.on('error',()=>{clip.state='saved-webm';save()})
      ffmpeg.on('exit',code=>{if(code===0){fs.renameSync(temp,output);clip.state='saved'}else clip.state='saved-webm';save()})
    }); clip.state='finalizing'; save()
  }
  let stop = (id: string) => {
    let record = records.get(id)
    if (!record) { let receipt = previous.find(item=>item.id===id); if (receipt) return receipt; throw new Error('Recording not found') }
    if (record.finishedAt) return list().find(item=>item.id===id)
    record.finishedAt=Date.now();record.state='stopped';clearTimeout(record.timer)
    for(let clip of record.clips){ if(!clip.window.isDestroyed())clip.window.webContents.send('capture-message',{type:'stop'});clip.timer=setTimeout(()=>finalize(record,clip),5000) }
    save();return list().find(item=>item.id===id)
  }
  let openClip = async (record: Recording,pane: string) => {
    if (record.finishedAt || record.clips.some(clip=>clip.pane===pane)) return
    if(record.clips.length>=8)throw new Error('Recording pane limit reached')
    let window = new BrowserWindow({show:false,width:1280,height:800,webPreferences:{...remoteWebPreferences,backgroundThrottling:false,preload:path.join(import.meta.dirname,record.options.host?'../preload/remote-client.cjs':'../preload/capture.cjs')}})
    let file=path.join(record.directory,`${pane.replace(/[^a-zA-Z0-9_-]/g,'_')}.webm`),writer=fs.createWriteStream(file,{flags:'wx',mode:0o600})
    let clip: Clip={pane,file,state:'starting',window,writer};record.clips.push(clip);contents.set(window.webContents,{record,clip})
    writer.on('error',()=>{record.error='Recording write failed';stop(record.id)})
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault())
    window.webContents.once('render-process-gone',()=>{record.error='Recording renderer closed';stop(record.id)})
    if(record.options.host){
      await remote.open(record.options.host,record.options.session,async page=>{
        page.attach!(window.webContents,async()=>{stop(record.id)},()=>undefined,pane)
        await window.loadFile(path.join(import.meta.dirname,'../renderer/remote-client.html'))
      },pane,`recording:${record.id}:${pane}`,record.options.generation)
    }else{
      let page=await runtime.recordingContents(pane)
      if(record.finishedAt || clip.closed){finalize(record,clip);return}
      let subscribe=createFrameCapture((frame: Electron.NativeImage)=>frame.isEmpty()?undefined:`data:image/jpeg;base64,${frame.toJPEG(80).toString('base64')}`)
      await window.loadFile(path.join(import.meta.dirname,'../renderer/capture.html'))
      clip.stop=subscribe(page,data=>{if(!window.isDestroyed())window.webContents.send('capture-message',{type:'frame',data})})
    }
  }
  ipcMain.handle('capture-settings',event=>({enabled:contents.has(event.sender)}))
  ipcMain.handle('capture-chunk',async(event,bytes:ArrayBuffer)=>{
    let entry=contents.get(event.sender);if(!entry||!(bytes instanceof ArrayBuffer)||bytes.byteLength>8*1024*1024)throw new Error('Invalid recording chunk')
    if(entry.clip.closed)return
    await new Promise<void>((resolve,reject)=>entry.clip.writer.write(Buffer.from(bytes),error=>error?reject(error):resolve()))
  })
  ipcMain.on('capture-event',(event,value)=>{
    let entry=contents.get(event.sender);if(!entry)return
    let {record,clip}=entry
    if(value?.type==='gap'){record.gaps??=[];record.gaps.push({pane:clip.pane,at:Date.now(),open:value.open===true});save()}
    if(value?.type==='recording'&&!record.finishedAt){clip.state='recording';record.state='recording';save()}
    if(value?.type==='stopped')finalize(record,clip)
    if(value?.type==='error'){record.error=String(value.error).slice(0,200);stop(record.id)}
    if(value?.type==='state'&&record.options.episode&&Array.isArray(value.activity)){
      let episode=(value.activity as ActivityEpisode[]).find(item=>item.id===record.options.episode)
      if(!episode || episode.endedAt !== undefined)stop(record.id)
      else if(episode)for(let pane of episode.panes)void openClip(record,pane).catch(()=>{record.error='Additional pane capture failed';save()})
    }
  })
  let start=async(input:Options)=>{
    let options:Options={pane:input.pane,sourcePane:input.sourcePane,host:input.host,session:input.session,generation:input.generation,episode:input.episode,id:input.id,output:input.output}
    let id=options.id??options.episode??randomUUID()
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new Error('Invalid recording ID')
    let existing=list().find(item=>item.id===id)??previous.find(item=>item.id===id);if(existing)return existing
    if(!options.pane)throw new Error('Select a pane to record')
    if([...records.values()].filter(record=>!record.finishedAt).length>=4)throw new Error('Four recordings are already active')
    let base=recordingDirectory(options.output)
    let destination=path.join(base,new Date().toISOString().slice(0,10),id);fs.mkdirSync(destination,{recursive:true,mode:0o700})
    let record:Recording={id,options,startedAt:Date.now(),state:'starting',directory:destination,clips:[]};records.set(id,record)
    record.timer=setTimeout(()=>stop(id),35*60*1000);save()
    void openClip(record,options.pane).catch(error=>{record.error=error instanceof Error?error.message:'Capture failed';stop(id)})
    return list().find(item=>item.id===id)
  }
  let activitySubscription=runtime.activity.subscribe(()=>{for(let record of records.values())if(!record.options.host&&record.options.episode&&!record.finishedAt){let episode=runtime.activity.episodes().find(item=>item.id===record.options.episode);if(!episode||episode.endedAt!==undefined)stop(record.id);else for(let pane of episode.panes)void openClip(record,pane).catch(()=>{record.error='Additional pane capture failed';save()})}})
  return {start,stop,folder,skip:(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid episode');let existing=history().find(item=>item.id===id);if(existing)return stop(id);let receipt={id,options:{episode:id},startedAt:Date.now(),finishedAt:Date.now(),state:'skipped',error:undefined,gaps:undefined,directory:'',clips:[]};previous.push(receipt);save();return receipt},play:async(id:string)=>{let record=history().find(item=>item.id===id),clip=record?.clips.find(clip=>['saved','saved-webm'].includes(clip.state));if(!clip)throw new Error('No completed video');let error=await shell.openPath(clip.state==='saved'?clip.file.replace(/\.webm$/,'.mp4'):clip.file);if(error)throw new Error(error)},list:history,reveal:(id:string)=>{let record=list().find(item=>item.id===id)??previous.find(item=>item.id===id);if(!record)throw new Error('Recording not found');shell.showItemInFolder(record.directory)},close:async()=>{activitySubscription();for(let record of records.values())stop(record.id);await new Promise(resolve=>setTimeout(resolve,1200));for(let record of records.values())for(let clip of record.clips)finalize(record,clip)}}
}
