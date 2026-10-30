import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import https from 'node:https'
import type { Pool } from 'pg'
import type { ActivityEvent } from '../src/shared/activity'

type Source = { owner: string; id: string; service: string; generation: string }
type Hook = { id: string; owner: string; enabled: boolean; filter: Record<string, string>; events: string[]; destination: { kind: 'webhook' | 'clawtab'; url: string; deviceId?: string; job?: string }; secret?: string }
let key = () => { let value = Buffer.from(process.env.BMUX_HOOKS_ENCRYPTION_KEY ?? '', 'base64'); if (value.length !== 32) throw new Error('Hook credential encryption is not configured'); return value }
let encrypt = (text: string) => { let iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString('base64') }
let decrypt = (text: string) => { let bytes = Buffer.from(text, 'base64'), cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0,12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString() }
export let publicAddress = (address: string) => {
  if (isIP(address) === 4) return !/^(0\.|10\.|127\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|192\.0\.|198\.(1[89])\.)/.test(address) && Number(address.split('.')[0]) < 224
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(db8|0{0,3}):/i.test(address) && !/^2002:/i.test(address)
}
let publicUrl = async (value: string) => {
  let url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('Use a public HTTPS destination')
  let hostname = url.hostname.replace(/^\[|\]$/g,''), addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await lookup(hostname,{all:true})
  if (!addresses.length || addresses.some(({address}) => !publicAddress(address))) throw new Error('Destination must resolve to public addresses')
  return {url,address:addresses[0]}
}
type Send = (url: string,method: 'GET' | 'POST',headers: Record<string,string>,body?: unknown) => Promise<{status:number; body:string}>
// The validated DNS answer is used for the connection; redirects are never followed.
let request: Send = async (value,method,headers,body) => {
  let {url,address} = await publicUrl(value)
  return new Promise((resolve,reject) => {
    let req = https.request(url,{method,headers,lookup:(_hostname,options,callback)=>options.all ? callback(null,[address]) : callback(null,address.address,address.family),timeout:10000},response=>{
      let chunks: Buffer[] = [], size = 0
      response.on('data',chunk=>{ size += chunk.length; if(size>65536) response.destroy(new Error('Hook response too large')); else chunks.push(chunk) })
      response.on('error',reject); response.on('end',()=>resolve({status:response.statusCode ?? 0,body:Buffer.concat(chunks).toString()}))
    })
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Hook request timed out')))
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
export let createActivityHooks = (pool: Pool,send: Send = request) => {
  let record = async (source: Source, event: ActivityEvent) => {
    if (!event || event.version !== 1 || !/^[a-f0-9-]{36}$/.test(event.id) || !/^[a-f0-9-]{36}$/.test(event.episodeId) || !['agent.session.start','agent.action','agent.session.end'].includes(event.type) || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || !Number.isFinite(event.occurredAt) || !event.target || ['sessionId','paneId','profileId','agentId'].some(k => typeof event.target[k as keyof typeof event.target] !== 'string' || event.target[k as keyof typeof event.target].length > 128)) throw new Error('Invalid activity event')
    let payload = { version:1,id:event.id,episodeId:event.episodeId,sequence:event.sequence,type:event.type,occurredAt:event.occurredAt,target:{sessionId:event.target.sessionId,paneId:event.target.paneId,profileId:event.target.profileId,agentId:event.target.agentId},method:typeof event.method === 'string' ? event.method.slice(0,128) : undefined,outcome:['success','error'].includes(event.outcome ?? '') ? event.outcome : undefined,durationMs:Number.isFinite(event.durationMs) ? event.durationMs : undefined,reason:typeof event.reason === 'string' ? event.reason.slice(0,64) : undefined,hostId:source.id,generation:source.generation,serviceId:source.service }
    let client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[event.episodeId])
      let episode = (await client.query('SELECT * FROM bmux_activity_episodes WHERE id=$1',[event.episodeId])).rows[0]
      if(episode && (episode.owner !== source.owner || episode.host !== source.id || episode.session !== event.target.sessionId)) throw new Error('Activity episode target changed')
      if(episode) payload.generation = episode.generation
      let inserted = await client.query('INSERT INTO bmux_activity_events(id,owner,episode,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[event.id,source.owner,event.episodeId,payload])
      if (inserted.rowCount) {
        await client.query(`INSERT INTO bmux_activity_episodes(id,owner,host,generation,session,ended) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET ended=bmux_activity_episodes.ended OR excluded.ended`,[event.episodeId,source.owner,source.id,payload.generation,event.target.sessionId,event.type === 'agent.session.end'])
        let hooks = (await client.query('SELECT * FROM bmux_activity_hooks WHERE owner=$1 AND enabled',[source.owner])).rows as Hook[]
        for (let hook of hooks) if (hook.events.includes(event.type) && (Object.entries(hook.filter).every(([k,v]) => String((payload as Record<string,unknown>)[k] ?? (event.target as Record<string,unknown>)[k]) === v) || event.type === 'agent.session.end' && !!(await client.query('SELECT 1 FROM bmux_hook_deliveries d JOIN bmux_activity_events e ON e.id=d.event WHERE d.hook=$1 AND e.episode=$2 LIMIT 1',[hook.id,event.episodeId])).rowCount)) await client.query('INSERT INTO bmux_hook_deliveries(id,hook,event) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[randomUUID(),hook.id,event.id])
      }
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  let api = async (owner: string, method: string, pathname: string, input: Record<string,unknown> = {}) => {
    let match = /^\/api\/hooks(?:\/([a-f0-9-]{36})(?:\/(deliveries|test))?)?$/.exec(pathname)
    if (!match) throw new Error('Invalid hooks endpoint')
    let [,id,action] = match
    if (method === 'GET' && action === 'deliveries') return (await pool.query('SELECT d.id,d.status,d.attempts,d.error,d.next_at FROM bmux_hook_deliveries d JOIN bmux_activity_hooks h ON h.id=d.hook WHERE h.owner=$1 AND h.id=$2 ORDER BY d.created_at DESC LIMIT 100',[owner,id])).rows
    if (method === 'GET') return (await pool.query('SELECT id,enabled,filter,events,destination,secret IS NOT NULL AS has_secret FROM bmux_activity_hooks WHERE owner=$1 ORDER BY created_at',[owner])).rows
    if (method === 'DELETE' && id) { await pool.query('DELETE FROM bmux_activity_hooks WHERE owner=$1 AND id=$2',[owner,id]); return { deleted:true } }
    if (!['POST','PATCH'].includes(method)) throw new Error('Unsupported hook operation')
    let existing = id ? (await pool.query('SELECT * FROM bmux_activity_hooks WHERE owner=$1 AND id=$2',[owner,id])).rows[0] : undefined
    if (id && !existing) throw new Error('Hook not found')
    if(action === 'test') {
      let eventId = randomUUID(), episodeId = randomUUID(), deliveryId = randomUUID()
      let payload = {version:1,id:eventId,episodeId,sequence:1,type:'agent.session.start',occurredAt:Date.now(),target:{sessionId:'test',paneId:'test',profileId:'test',agentId:'test'},hostId:'test',generation:'test',serviceId:'test',test:true}
      await pool.query('INSERT INTO bmux_activity_events(id,owner,episode,payload) VALUES($1,$2,$3,$4)',[eventId,owner,episodeId,payload])
      await pool.query('INSERT INTO bmux_hook_deliveries(id,hook,event) VALUES($1,$2,$3)',[deliveryId,id,eventId])
      return {id:deliveryId,status:'pending'}
    }
    let value = { ...existing,...input }, raw = value.destination, destination = raw && {kind:raw.kind,url:raw.url,...(raw.kind==='clawtab'?{deviceId:raw.deviceId,job:raw.job}:{})}
    if (!destination || !['webhook','clawtab'].includes(destination.kind)) throw new Error('Choose a hook destination')
    destination.url = (await publicUrl(destination.url)).url.href
    if (destination.kind === 'clawtab' && (destination.url !== 'https://triggers.clawtab.cc/v1/triggers/run' || !/^[a-f0-9-]{36}$/.test(destination.deviceId) || !/^[a-zA-Z0-9_/-]+$/.test(destination.job))) throw new Error('Set the ClawTab device and job')
    let filter = value.filter ?? {}, events = value.events ?? ['agent.session.start','agent.session.end']
    if (typeof filter !== 'object' || Array.isArray(filter) || Object.entries(filter).some(([k,v]) => !['serviceId','hostId','sessionId','paneId','profileId','agentId'].includes(k) || typeof v !== 'string' || !v || v.length > 128) || !Array.isArray(events) || events.some(e => !['agent.session.start','agent.action','agent.session.end'].includes(e))) throw new Error('Invalid hook filters')
    if(input.secret !== undefined && (typeof input.secret !== 'string' || input.secret.length > 8192)) throw new Error('Invalid hook credential')
    let secret = typeof input.secret === 'string' ? input.secret ? encrypt(input.secret) : null : existing?.secret
    if(value.enabled === true && destination.kind === 'clawtab' && !secret) throw new Error('Add the ClawTab API token')
    let hookId = id ?? randomUUID()
    await pool.query('INSERT INTO bmux_activity_hooks(id,owner,enabled,filter,events,destination,secret) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,filter=excluded.filter,events=excluded.events,destination=excluded.destination,secret=excluded.secret',[hookId,owner,value.enabled === true,filter,JSON.stringify(events),destination,secret])
    return { id:hookId }
  }
  let busy = false
  let deliver = async () => {
    if (busy) return
    busy = true
    try {
      let rows = (await pool.query(`UPDATE bmux_hook_deliveries SET next_at=now()+interval '60 seconds' WHERE id IN (SELECT d.id FROM bmux_hook_deliveries d JOIN bmux_activity_hooks h ON h.id=d.hook JOIN bmux_activity_events e ON e.id=d.event WHERE (h.enabled OR e.payload->>'test'='true') AND d.status='pending' AND d.next_at<=now() AND NOT EXISTS(SELECT 1 FROM bmux_hook_deliveries older JOIN bmux_activity_events oe ON oe.id=older.event WHERE older.hook=d.hook AND older.status='pending' AND oe.episode=e.episode AND (oe.payload->>'sequence')::bigint<(e.payload->>'sequence')::bigint) ORDER BY d.created_at LIMIT 4 FOR UPDATE OF d SKIP LOCKED) RETURNING *`)).rows
      for (let delivery of rows) {
        if(Date.now()-new Date(delivery.created_at).getTime()>86400000){await pool.query("UPDATE bmux_hook_deliveries SET status='expired',error='Delivery expired' WHERE id=$1",[delivery.id]);continue}
        let hook = (await pool.query('SELECT * FROM bmux_activity_hooks WHERE id=$1',[delivery.hook])).rows[0] as Hook
        let event = (await pool.query('SELECT payload FROM bmux_activity_events WHERE id=$1',[delivery.event])).rows[0].payload
        try {
          let ended = (await pool.query('SELECT ended FROM bmux_activity_episodes WHERE id=$1',[event.episodeId])).rows[0]?.ended
          if (!delivery.trigger_id && hook.destination.kind === 'clawtab' && event.type === 'agent.session.start' && ended && !event.test) { await pool.query("UPDATE bmux_hook_deliveries SET status='skipped',error='Episode ended before recording started' WHERE id=$1",[delivery.id]); continue }
          let secret = hook.secret ? decrypt(hook.secret) : undefined, cwt = hook.destination.kind === 'clawtab', polling = cwt && delivery.trigger_id
          let headers = {'Content-Type':'application/json','User-Agent':'bmux-hooks/1','Idempotency-Key':`${delivery.id}:${delivery.attempts}`,...(secret ? {Authorization:`Bearer ${secret}`} : {})}
          let result = await send(polling ? `https://triggers.clawtab.cc/v1/triggers/${delivery.trigger_id}` : hook.destination.url,polling ? 'GET' : 'POST',headers,polling ? undefined : cwt ? {device_id:hook.destination.deviceId,job:hook.destination.job,params:{event:JSON.stringify(event)},wait:false} : event)
          if(result.status < 200 || result.status >= 300) throw new Error('HTTP delivery failed')
          if(cwt) {
            let response = JSON.parse(result.body) as {id?:string; status?:string}
            if(!/^[a-f0-9-]{36}$/.test(response.id ?? '')) throw new Error('Invalid ClawTab receipt')
            if(['pending','dispatched','running'].includes(response.status ?? '')) { await pool.query("UPDATE bmux_hook_deliveries SET trigger_id=$2,next_at=now()+interval '5 seconds',error=NULL WHERE id=$1",[delivery.id,response.id]); continue }
            if(response.status !== 'succeeded') { await pool.query('UPDATE bmux_hook_deliveries SET trigger_id=NULL,attempts=attempts+1 WHERE id=$1',[delivery.id]); throw new Error('ClawTab run failed') }
          }
          await pool.query("UPDATE bmux_hook_deliveries SET status='delivered',error=NULL WHERE id=$1",[delivery.id])
        } catch (error) { await pool.query("UPDATE bmux_hook_deliveries SET failures=failures+1,error=$2,next_at=now()+make_interval(secs=>LEAST(300,power(2,LEAST(failures,8))::int)),status=CASE WHEN created_at<now()-interval '24 hours' THEN 'expired' ELSE 'pending' END WHERE id=$1",[delivery.id,'Delivery failed; retry pending']) }
      }
    } finally { busy = false }
  }
  return {record,api,deliver}
}
