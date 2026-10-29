#!/usr/bin/env node
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ClawTab owns only this short request. The BMUX process owns the capture.
let value=process.env.CLAWTAB_PARAM_EVENT
if(!value || value.length>65536)throw new Error('Missing activity event')
let event=JSON.parse(value)
if(event.version!==1 || !['agent.session.start','agent.action','agent.session.end'].includes(event.type))throw new Error('Unsupported activity event')
let child=spawn(process.execPath,[fileURLToPath(new URL('../bin/bmux.mjs',import.meta.url)),'record','event','--stdin'],{stdio:['pipe','pipe','inherit']})
child.stdin.end(JSON.stringify(event))
let chunks=[],size=0
child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1048576)child.kill();else chunks.push(chunk)})
let code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
let result=JSON.parse(Buffer.concat(chunks).toString())
if(code!==0 || !result.ok)throw new Error(result.error ?? 'Recording request failed')
if(process.env.CLAWTAB_RESULT_FILE)fs.writeFileSync(process.env.CLAWTAB_RESULT_FILE,JSON.stringify(result.result),{mode:0o600})
process.stdout.write(JSON.stringify(result.result)+'\n')
