import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { emptySocialHook } from '../shared/social-hooks'
import type { SocialHookConfig, SocialHookReceipt } from '../shared/social-hooks'
import { socialXSource } from './social-x-source'
import { socialRedditSource } from './social-reddit-source'

type Post = Record<string, unknown>
type Job = { id: string; plugin: string; profile: string; posts: Post[]; attempts: number; due: number; destination: string; failed?: boolean }
type Data = { configs: Record<string, SocialHookConfig>; jobs: Job[]; seen: Record<string, string>; recent: SocialHookReceipt[]; counts: Record<string, number>; migrated: string[] }
type Options = { directory: string; encrypt: (text: string) => Buffer; decrypt: (data: Buffer) => string; available: () => boolean; targets: () => { contents: WebContents; profile: string; private: boolean }[]; enabled: (id: string) => boolean; changed: () => void; fetcher?: typeof fetch }
export let socialPlatform = (value: string) => {
  try { let host = new URL(value).hostname.replace(/^www\./, ''); return Object.entries({ x: ['x.com','twitter.com'], linkedin: ['linkedin.com'], reddit: ['reddit.com'], instagram: ['instagram.com'], tiktok: ['tiktok.com'], youtube: ['youtube.com'], threads: ['threads.net','threads.com'], bluesky: ['bsky.app'], mastodon: ['mastodon.social'] }).find(([, hosts]) => hosts.includes(host))?.[0] } catch { return undefined }
}
// Serialized into an isolated page world; no credentials enter the page.
let extractPosts = () => [...document.querySelectorAll<HTMLElement>('article,shreddit-post,[data-urn],[componentkey^="expanded"],[data-pressable-container="true"],.status[data-id],ytd-rich-item-renderer,ytd-reel-video-renderer,[data-e2e="recommend-list-item-container"],[data-testid^="feedItem-by-"],[data-testid^="postThreadItem-by-"]')].slice(0,200).flatMap(card => {
  let link = [...card.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a => a.matches('.status__relative-time') || /\/status\/|\/posts\/|\/feed\/update\/|\/comments\/|\/p\/|\/reel\/|\/video\/|\/shorts\/|\/watch\?|\/post\//.test(a.href))
  let url = link?.href || card.getAttribute('permalink'), text = card.innerText?.trim().slice(0,16000)
  if (!url || !text) return []
  let canonical = new URL(url, location.href); canonical.hash = ''; if (!canonical.pathname.includes('/watch')) canonical.search = ''
  return [{ id: canonical.href, url: canonical.href, text, author: card.querySelector('[rel="author"]')?.textContent || null, publishedAt: card.querySelector('time')?.getAttribute('datetime') || null, media: [...card.querySelectorAll<HTMLImageElement>('img')].slice(0,10).map(image => image.currentSrc || image.src) }]
})
export let createSocialHooks = (options: Options) => {
  let file = path.join(options.directory,'social-hooks.json'), data: Data = { configs: {}, jobs: [], seen: {}, recent: [], counts: {}, migrated: [] }, busy = false
  let writes = Promise.resolve()
  let ready = fs.readFile(file,'utf8').then(value => { data = JSON.parse(value) }).catch(error => { if (error.code !== 'ENOENT') throw error })
  let persist = () => { let value = JSON.stringify(data); writes = writes.catch(() => undefined).then(async () => { await fs.mkdir(options.directory,{recursive:true}); await fs.writeFile(file+'.tmp',value,{mode:0o600}); await fs.rename(file+'.tmp',file) }); return writes }
  let key = (plugin: string, profile = '') => plugin+':'+profile
  let effective = (plugin: string, profile = '') => data.configs[key(plugin,profile)] ?? data.configs[key(plugin)] ?? emptySocialHook()
  let state = async (plugin: string, profile = '') => {
    await ready
    let { secret, ...config } = effective(plugin,profile), jobs = data.jobs.filter(j => j.plugin === plugin && (!profile || j.profile === profile))
    return { config: {...config,hasSecret:!!secret}, override: !!profile && !!data.configs[key(plugin,profile)], sent: Object.entries(data.counts).filter(([k]) => profile ? k === key(plugin,profile) : k.startsWith(plugin+':')).reduce((n,[,count]) => n+count,0), pending: jobs.filter(j => !j.failed).reduce((n,j) => n+j.posts.length,0), failed: jobs.filter(j => j.failed).reduce((n,j) => n+j.posts.length,0), recent: data.recent.filter(r => r.plugin === plugin && (!profile || r.profile === profile)) }
  }
  let save = async (plugin: string, profile: string, input: SocialHookConfig | null) => {
    await ready
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(plugin)) throw new Error('Invalid social plugin')
    if (!input) delete data.configs[key(plugin,profile)]
    else {
      let url = input.url ? new URL(input.url) : null
      if (url && (!['http:','https:'].includes(url.protocol) || url.username || url.password)) throw new Error('Enter an HTTP or HTTPS endpoint')
      if (input.enabled && !url) throw new Error('Enter an endpoint before enabling the hook')
      if (!['none','bearer','api-key'].includes(input.auth) || !['posts','tweettrace'].includes(input.format) || input.format === 'tweettrace' && plugin !== 'bmux.x') throw new Error('Invalid hook format or authentication')
      if (!/^[a-zA-Z0-9-]+$/.test(input.header)) throw new Error('Invalid header name')
      let secret = effective(plugin,profile).secret
      if (input.secret !== undefined) { if (input.secret && !options.available()) throw new Error('Credential encryption unavailable'); secret = input.secret ? options.encrypt(input.secret).toString('base64') : undefined }
      data.configs[key(plugin,profile)] = { enabled:input.enabled === true,url:url?.href ?? '',format:input.format,auth:input.auth,header:input.header,secret }
    }
    for (let job of data.jobs) if (job.plugin === plugin && (!profile || job.profile === profile) && job.destination === effective(plugin,job.profile).url) { job.failed = false; job.attempts = 0; job.due = 0 }
    await persist(); options.changed(); return state(plugin,profile)
  }
  let enqueue = async (plugin: string, profile: string, posts: Post[]) => {
    await ready
    let config = effective(plugin,profile)
    if (!config.enabled || !options.enabled(plugin)) return
    let fresh = posts.filter(post => {
      let id = String(post.url || post.id || ''), k = key(plugin,profile)+':'+id, signature = createHash('sha256').update(JSON.stringify(post)).digest('hex')
      if (!id || data.seen[k] === signature) return false
      data.seen[k] = signature; return true
    }).map(post => ({...post,profileId:profile,observedAt:new Date().toISOString()}))
    if (!fresh.length) return
    for (let i=0;i<fresh.length;i+=100) data.jobs.push({id:randomUUID(),plugin,profile,posts:fresh.slice(i,i+100),attempts:0,due:0,destination:config.url})
    let keys = Object.keys(data.seen); for (let k of keys.slice(0,Math.max(0,keys.length-50000))) delete data.seen[k]
    await persist(); options.changed()
  }
  let tick = async () => {
    if (busy) return
    busy = true
    try {
      await ready
      for (let target of options.targets()) {
        let site = socialPlatform(target.contents.getURL()), plugin = 'bmux.'+site
        if (target.private || !site) continue
        if (!options.enabled(plugin) || !effective(plugin,target.profile).enabled) {
          await target.contents.executeJavaScriptInIsolatedWorld(996,[{code:'globalThis.__bmuxSocialPosts?.cleanup(); delete globalThis.__bmuxSocialPosts'}]).catch(() => undefined)
          continue
        }
        try {
          let extract = site === 'x' ? socialXSource : site === 'reddit' ? socialRedditSource : '('+extractPosts.toString()+')()'
          let code = `(() => {
            if (!globalThis.__bmuxSocialPosts) {
              let queue = [], seen = new Map(), timer;
              let capture = () => { for (let post of ${extract}) { let key = post.url || post.id, value = JSON.stringify(post); if (seen.get(key) !== value) { seen.set(key,value); queue.push(post) } }; if(queue.length > 2000) queue.splice(0,queue.length-2000); if(seen.size > 5000) seen.clear() };
              let schedule = () => { if (!timer) timer = setTimeout(() => { timer = undefined; capture() },300) };
              let observer = new MutationObserver(schedule); observer.observe(document,{childList:true,subtree:true,characterData:true}); window.addEventListener('scroll',schedule,true);
              globalThis.__bmuxSocialPosts = { queue, cleanup: () => { observer.disconnect(); window.removeEventListener('scroll',schedule,true); clearTimeout(timer) } }; capture();
            }
            return globalThis.__bmuxSocialPosts.queue.splice(0,200);
          })()`
          let posts = await target.contents.executeJavaScriptInIsolatedWorld(996,[{code}]); if (Array.isArray(posts)) await enqueue(plugin,target.profile,posts.slice(0,200)) } catch { /* Retry documents replaced during extraction on the next scan. */ }
      }
      let job = data.jobs.find(j => !j.failed && j.due <= Date.now() && effective(j.plugin,j.profile).enabled && options.enabled(j.plugin))
      if (!job) return
      let config = effective(job.plugin,job.profile)
      if (job.destination !== config.url) { job.failed = true; await persist(); return }
      try {
        let headers: Record<string,string> = {'content-type':'application/json','idempotency-key':job.id}
        if (config.auth !== 'none') { if (!config.secret) throw new Error('Missing credentials'); let secret = options.decrypt(Buffer.from(config.secret,'base64')); headers[config.auth === 'bearer' ? 'authorization' : config.header] = config.auth === 'bearer' ? 'Bearer '+secret : secret }
        let response = await (options.fetcher ?? fetch)(config.url,{method:'POST',headers,body:JSON.stringify(config.format === 'tweettrace' ? {tweets:job.posts} : {version:1,platform:job.plugin.slice(5),posts:job.posts.map(post => ({...post,id:post.id ?? post.tweet_id ?? post.url,author:post.author ?? (post.handle ? {handle:post.handle,name:post.author_name ?? null} : null),publishedAt:post.publishedAt ?? post.posted_at ?? null,engagement:post.engagement ?? (post.tweet_id ? {likes:post.likes,retweets:post.retweets,replies:post.replies,views:post.views} : null)}))}),redirect:'error',signal:AbortSignal.timeout(10000)})
        if (!response.ok) throw Object.assign(new Error('HTTP '+response.status),{permanent:response.status < 500 && response.status !== 429,retry:response.headers.get('retry-after')})
        let result = await response.json().catch(() => ({}))
        data.counts[key(job.plugin,job.profile)] = (data.counts[key(job.plugin,job.profile)] ?? 0)+job.posts.length
        data.recent.unshift({plugin:job.plugin,profile:job.profile,sent:job.posts.length,inserted:typeof result.inserted === 'number' ? result.inserted : undefined,skipped:typeof result.skipped === 'number' ? result.skipped : undefined,at:Date.now()})
        data.jobs = data.jobs.filter(j => j.id !== job.id)
      } catch (error) {
        let failure = error as Error & {permanent?:boolean;retry?:string}; job.attempts++; job.failed = failure.permanent || job.attempts >= 10
        let retry = failure.retry ? Number(failure.retry)*1000 || Date.parse(failure.retry)-Date.now() : 0
        job.due = Date.now()+Math.max(retry || 0,Math.min(3600000,1000*2**job.attempts))
        data.recent.unshift({plugin:job.plugin,profile:job.profile,sent:0,at:Date.now(),error:failure.message.startsWith('HTTP ') ? failure.message : 'Delivery failed; check endpoint and credentials'})
      }
      data.recent = data.recent.slice(0,100); await persist(); options.changed()
    } finally { busy = false }
  }
  return { ready,state,save,enqueue,tick, sent: (plugin:string) => Object.entries(data.counts).filter(([k]) => k.startsWith(plugin+':')).reduce((n,[,v]) => n+v,0), migrate: async (profile: string, settings: {apiKey?:string;endpoint?:string;log?:unknown[]}) => {
    await ready
    if (data.migrated.includes(profile)) return
    if (!settings.apiKey) throw new Error('TweetTrace credential unavailable')
    let shared = data.configs[key('bmux.x')]
    let config: SocialHookConfig = {enabled:true,url:(settings.endpoint || 'https://xscrape.tonis.dev').replace(/\/$/,'')+'/v1/tweets',format:'tweettrace',auth:'api-key',header:'x-api-key',secret:settings.apiKey}
    // Existing UI edits win; a differing imported profile becomes an override.
    if (!data.configs[key('bmux.x',profile)]) {
      if (!shared) await save('bmux.x','',config)
      else if (shared.url !== config.url || !shared.secret || options.decrypt(Buffer.from(shared.secret,'base64')) !== settings.apiKey) await save('bmux.x',profile,config)
    }
    await fs.mkdir(path.join(options.directory,'tweettrace-history'),{recursive:true})
    await fs.writeFile(path.join(options.directory,'tweettrace-history',encodeURIComponent(profile)+'.json'),JSON.stringify(settings.log ?? []),{mode:0o600})
    data.migrated.push(profile); await persist()
  } }
}
