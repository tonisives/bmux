import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { Pool } from 'pg'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createActivityHooks, publicAddress } from '../remote/activity-hooks'
import type { ActivityEvent } from '../src/shared/activity'

vi.mock('node:dns/promises',()=>({lookup:async()=>[{address:'1.1.1.1',family:4}]}))
it('rejects local and mapped hook destinations',()=>{
  for(let address of ['127.0.0.1','100.64.0.1','100.127.255.254','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])expect(publicAddress(address),address).toBe(false)
  for(let address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])expect(publicAddress(address),address).toBe(true)
})
describe.skipIf(!process.env.BMUX_HOOKS_TEST_DATABASE_URL).sequential('durable relay hooks',()=>{
  let schema=`hook_test_${randomUUID().replaceAll('-','')}`, admin:Pool, pool:Pool
  let source={owner:'owner',id:randomUUID(),service:'fixture',generation:randomUUID()}, target={sessionId:'session',paneId:'pane',profileId:'profile',agentId:'agent'}
  let event=(type:ActivityEvent['type'],episodeId:string=randomUUID(),sequence=1):ActivityEvent=>({version:1,id:randomUUID(),episodeId,sequence,type,occurredAt:Date.now(),target})
  beforeAll(async()=>{
    process.env.BMUX_HOOKS_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64')
    admin=new Pool({connectionString:process.env.BMUX_HOOKS_TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`)
    pool=new Pool({connectionString:process.env.BMUX_HOOKS_TEST_DATABASE_URL,options:`-c search_path=${schema}`})
    let sql=fs.readFileSync(new URL('../remote/schema.sql',import.meta.url),'utf8');await pool.query('CREATE TABLE IF NOT EXISTS bmux_activity_events'+sql.split('CREATE TABLE IF NOT EXISTS bmux_activity_events')[1])
  })
  beforeEach(async()=>{await pool.query('TRUNCATE bmux_hook_deliveries,bmux_activity_hooks,bmux_activity_events,bmux_activity_episodes')})
  afterAll(async()=>{await pool?.end();await admin?.query(`DROP SCHEMA ${schema} CASCADE`);await admin?.end();delete process.env.BMUX_HOOKS_ENCRYPTION_KEY})
  let config=(kind='webhook')=>({enabled:true,filter:{sessionId:'session'},destination:kind==='clawtab'?{kind,url:'https://triggers.clawtab.cc/v1/triggers/run',deviceId:randomUUID(),job:'bmux/record-session'}:{kind,url:'https://1.1.1.1/hook'},secret:'fixture-token'})
  it('commits deduplicated events with owner filters, preserves the original generation, and hides credentials',async()=>{
    let hooks=createActivityHooks(pool), hook=await hooks.api('owner','POST','/api/hooks',config()) as {id:string}, start=event('agent.session.start')
    await Promise.all([hooks.record(source,start),hooks.record(source,start)])
    expect((await pool.query('SELECT * FROM bmux_hook_deliveries')).rows).toHaveLength(1)
    let listed=await hooks.api('owner','GET','/api/hooks');expect(JSON.stringify(listed)).not.toContain('fixture-token');expect(JSON.stringify((await pool.query('SELECT secret FROM bmux_activity_hooks')).rows)).not.toContain('fixture-token')
    await expect(hooks.api('other','POST',`/api/hooks/${hook.id}`,{enabled:false})).rejects.toThrow('not found')
    await hooks.record({...source,generation:randomUUID()},event('agent.session.end',start.episodeId,2))
    expect((await pool.query("SELECT payload->>'generation' AS generation FROM bmux_activity_events")).rows.every(row=>row.generation===source.generation)).toBe(true)
    await expect(hooks.record({...source,owner:'other'},event('agent.action',start.episodeId,3))).rejects.toThrow('target changed')
  })
  it('retries transport errors with the same key and polls a saved ClawTab receipt after restart',async()=>{
    let calls:{url:string;method:string;key:string}[]=[], run=randomUUID(), fail=true
    let send=async(url:string,method:'GET'|'POST',headers:Record<string,string>)=>{calls.push({url,method,key:headers['Idempotency-Key']});if(fail){fail=false;throw new Error('offline')}return {status:200,body:JSON.stringify({id:run,status:method==='GET'?'succeeded':'dispatched'})}}
    let hooks=createActivityHooks(pool,send);await hooks.api('owner','POST','/api/hooks',config('clawtab'));await hooks.record(source,event('agent.session.start'))
    await hooks.deliver();await pool.query('UPDATE bmux_hook_deliveries SET next_at=now()');await hooks.deliver()
    expect(calls[0].key).toBe(calls[1].key);expect((await pool.query('SELECT trigger_id FROM bmux_hook_deliveries')).rows[0].trigger_id).toBe(run)
    hooks=createActivityHooks(pool,send);await pool.query('UPDATE bmux_hook_deliveries SET next_at=now()');await hooks.deliver()
    expect(calls[2]).toMatchObject({method:'GET',url:`https://triggers.clawtab.cc/v1/triggers/${run}`});expect((await pool.query('SELECT status FROM bmux_hook_deliveries')).rows[0].status).toBe('delivered')
  })
  it('skips stale recording starts, delivers their stops, and exercises a disabled hook with a harmless test',async()=>{
    let received:any[]=[], hooks=createActivityHooks(pool,async(_url,_method,_headers,body)=>{received.push(body);return {status:200,body:JSON.stringify({id:randomUUID(),status:'succeeded'})}})
    let hook=await hooks.api('owner','POST','/api/hooks',config('clawtab')) as {id:string},start=event('agent.session.start')
    await hooks.record(source,start);await hooks.record(source,event('agent.session.end',start.episodeId,2));await hooks.deliver();await hooks.deliver()
    expect(received).toHaveLength(1);expect(JSON.parse(received[0].params.event).type).toBe('agent.session.end')
    await hooks.api('owner','POST',`/api/hooks/${hook.id}`,{enabled:false});await hooks.api('owner','POST',`/api/hooks/${hook.id}/test`,{});await hooks.deliver()
    expect(JSON.parse(received[1].params.event).test).toBe(true)
  })
})
