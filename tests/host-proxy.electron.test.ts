import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { Server } from 'proxy-chain'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('required home egress fails closed across outages and new profiles', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-required-proxy-')), requests = 0
  let fixture = http.createServer((_request,response)=>{requests++;response.end('<!doctype html><title>Home route</title><h1>Home route</h1>')})
  await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve))
  let url = `http://127.0.0.1:${(fixture.address() as {port:number}).port}`
  let proxy = new Server({host:'127.0.0.1',port:0})
  proxy.on('requestFailed',()=>undefined)
  await proxy.listen()
  await fs.writeFile(path.join(directory,'config.yaml'),'browser:\n  autoUpdateFilters: false\n')
  let application = await electron.launch({args:[process.cwd(),'--background'],env:{...process.env,BMUX_DATA_DIR:directory,BMUX_CONFIG:path.join(directory,'config.yaml'),BMUX_REQUIRED_PROXY:`http://127.0.0.1:${proxy.port}`,BMUX_BACKGROUND:'1'}})
  try {
    let run = async (...args:string[])=>JSON.parse((await promisify(execFile)(process.execPath,['bin/bmux.mjs',...args],{env:{...process.env,BMUX_DATA_DIR:directory}})).stdout).result
    let state = await run('status'), pane = state.model.sessions[0].windows[0].panes[0]
    await run('navigate','-t',pane.id,url)
    expect(requests).toBeGreaterThan(0)
    let profile = await run('profile','create','required','--background')
    expect(profile.proxy.port).toBe(proxy.port)
    await expect(run('rpc','profile.proxy.clear',JSON.stringify({profile:profile.id}))).rejects.toThrow()
    await proxy.close(true)
    let before = requests
    await expect(run('navigate','-t',pane.id,`${url}/outage`)).rejects.toThrow()
    expect(requests).toBe(before)
  } finally {
    await application.close(); await proxy.close(true).catch(()=>undefined)
    await new Promise<void>(resolve=>fixture.close(()=>resolve()))
    await fs.rm(directory,{recursive:true,force:true})
  }
})
