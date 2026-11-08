import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSocialHooks, socialPlatform } from '../src/main/social-hooks'
import { emptySocialHook } from '../src/shared/social-hooks'

describe('social hooks', () => {
  it('recognizes platform hosts without matching lookalikes', () => {
    expect(socialPlatform('https://www.x.com/home')).toBe('x')
    expect(socialPlatform('https://x.com.attacker.test')).toBeUndefined()
    expect(socialPlatform('https://mastodon.social/@person/123')).toBe('mastodon')
  })
  it('keeps credentials private, inherits defaults and persists successful counts', async () => {
    let directory = await mkdtemp(join(tmpdir(),'social-hooks-')), requests: {url:string;body:unknown}[] = []
    let options = { directory, available: () => true, encrypt: (text:string) => Buffer.from(text), decrypt: (data:Buffer) => data.toString(), targets: () => [], enabled: () => true, changed: () => {}, fetcher: (async (url:unknown, init:RequestInit) => { requests.push({url:String(url),body:JSON.parse(String(init.body))}); return new Response(JSON.stringify({inserted:1,skipped:0}),{status:200}) }) as typeof fetch }
    try {
      let hooks = createSocialHooks(options)
      await hooks.save('bmux.x','',{...emptySocialHook(),enabled:true,url:'https://receiver.test/v1/tweets',format:'tweettrace',auth:'api-key',secret:'test-token'})
      expect((await hooks.state('bmux.x','one')).config).not.toHaveProperty('secret')
      expect((await hooks.state('bmux.x','one')).config.hasSecret).toBe(true)
      let post = {url:'https://x.com/user/status/1',text:'A post'}
      await hooks.enqueue('bmux.x','one',[post,post]); await hooks.tick(); await hooks.tick()
      expect(requests).toHaveLength(1)
      expect(requests[0].body).toMatchObject({tweets:[post]})
      expect((await hooks.state('bmux.x')).sent).toBe(1)
      expect((await createSocialHooks(options).state('bmux.x')).sent).toBe(1)
      await hooks.save('bmux.x','one',{...emptySocialHook(),enabled:false})
      await hooks.enqueue('bmux.x','one',[{...post,text:'Changed'}])
      expect((await hooks.state('bmux.x','one')).pending).toBe(0)
      await hooks.save('bmux.x','one',null)
      expect((await hooks.state('bmux.x','one')).config.enabled).toBe(true)
    } finally { await rm(directory,{recursive:true,force:true}) }
  })
  it('retains permanent failures without counting them as sent', async () => {
    let directory = await mkdtemp(join(tmpdir(),'social-hooks-'))
    try {
      let hooks = createSocialHooks({directory,available:()=>true,encrypt:Buffer.from,decrypt:data=>data.toString(),targets:()=>[],enabled:()=>true,changed:()=>{},fetcher:(async()=>new Response('',{status:401})) as typeof fetch})
      await hooks.save('bmux.reddit','',{...emptySocialHook(),enabled:true,url:'https://receiver.test'})
      await hooks.enqueue('bmux.reddit','one',[{url:'https://reddit.com/r/test/comments/1',text:'Test'}]); await hooks.tick()
      expect(await hooks.state('bmux.reddit')).toMatchObject({sent:0,failed:1,pending:0})
    } finally { await rm(directory,{recursive:true,force:true}) }
  })
})
