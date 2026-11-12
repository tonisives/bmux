import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { socialXSource } from '../src/main/social-x-source'

it('captures modern X cards without mixing quoted text into the post body', () => {
  let card: Record<string, unknown>
  const link = { href: 'https://x.com/founder/status/1855996800000000000', closest: () => card }
  const own = { innerText: 'Manual invoices take hours every week', closest: () => card, parentElement: { closest: () => null } }
  const quoted = { innerText: 'Quoted promotion', closest: () => ({ nested: true }), parentElement: { closest: () => null } }
  card = { innerText: own.innerText, querySelector: (selector: string) => selector.includes('embedded-tweet-frame') ? {} : null, querySelectorAll: (selector: string) => selector === 'a[href]' ? [link] : selector === '[dir="auto"]' ? [own, quoted] : [], closest: () => null }
  const document = { querySelectorAll: (selector: string) => selector === 'article:not(article article)' ? [card] : [] }
  const rows = runInNewContext(socialXSource, { document, URL, Date, BigInt })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ text: own.innerText, is_quote: true, is_reply: false, is_retweet: false, url: link.href })
  expect(rows[0].posted_at).toMatch(/^2024-/)
})
