import { it, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { socialRedditSource } from '../src/main/social-reddit-source'

type Card = ReturnType<typeof card>
let card = (attributes: Record<string,string>, text: string, kind = 'SHREDDIT-POST') => {
  let node = {
    tagName: kind, id: attributes.id,
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
    closest: () => null,
    getBoundingClientRect: () => ({top:20,bottom:200,width:600,height:180}),
    querySelectorAll: () => [{innerText:text,closest:()=>node}],
  }
  return node
}
let post = () => card({id:'t3_abc123',permalink:'/r/smallbusiness/comments/abc123/invoices/',author:'owner','post-title':'Invoice reconciliation','created-timestamp':'2026-11-12T00:00:00Z',score:'12','comment-count':'7'}, 'I manually reconcile invoices in Excel every Friday.')
let extract = (cards: Card[], path = '/r/smallbusiness/comments/abc123/invoices/') => runInNewContext(socialRedditSource,{
  URL,Date,innerHeight:800,location:{href:'https://www.reddit.com'+path,pathname:path},document:{querySelector:()=>cards[0],querySelectorAll:()=>cards},
})

it('extracts exact post metadata without card controls and marks feed excerpts incomplete', () => {
  let result = extract([post()])
  expect(result).toHaveLength(1)
  expect(result[0].redditItem).toMatchObject({id:'t3_abc123',subreddit:'smallbusiness',score:12,numComments:7,bodyComplete:true,body:'I manually reconcile invoices in Excel every Friday.'})
  expect(result[0].text).not.toContain('Share')
  expect(extract([post()],'/r/smallbusiness/')[0].redditItem.bodyComplete).toBe(false)
})
it('keeps comment bodies, IDs and parent context separate with unknown metrics left null', () => {
  let comment = card({thingid:'t1_def456',permalink:'/r/smallbusiness/comments/abc123/comment/def456/',author:'bookkeeper',created:'2026-11-12T01:00:00Z'},'Same reconciliation problem here.','SHREDDIT-COMMENT')
  let result = extract([post(),comment])
  expect(result[1].redditItem).toMatchObject({id:'t1_def456',kind:'comment',title:'',body:'Same reconciliation problem here.',parentId:'t3_abc123',parentTitle:'Invoice reconciliation',score:null,numComments:null})
})
it('ignores ads, lookalike links and offscreen cards', () => {
  let ad = post(), outside = post(), bad = post()
  ad.hasAttribute = name => name === 'promoted'
  outside.getBoundingClientRect = () => ({top:900,bottom:1100,width:600,height:200})
  bad.getAttribute = name => name === 'permalink' ? 'https://reddit.com.attacker.test/r/smallbusiness/comments/abc123/invoices/' : post().getAttribute(name)
  expect(extract([ad,outside,bad])).toEqual([])
})
