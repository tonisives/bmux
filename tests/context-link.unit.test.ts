import { expect, test } from 'vitest'
import { resolvedContextLink, xPostLink } from '../src/main/context-link'

test('recognizes X post permalinks without accepting lookalike hosts or related pages', () => {
  expect(xPostLink('https://x.com/home', ['/person/status/123456'])).toBe('https://x.com/person/status/123456')
  expect(xPostLink('https://www.x.com/home', ['/i/web/status/42'])).toBe('https://www.x.com/i/web/status/42')
  expect(xPostLink('https://x.com/home', ['/person/status/123/analytics'])).toBe('')
  expect(xPostLink('https://x.example/home', ['https://x.com/person/status/123'])).toBe('')
})

test('prefers a userscript context link and limits it to web URLs', () => {
  expect(resolvedContextLink({ pageUrl: 'https://example.test/feed', custom: '/details/7', links: [] })).toBe('https://example.test/details/7')
  expect(resolvedContextLink({ pageUrl: 'https://x.com/home', custom: 'javascript:alert(1)', links: ['/person/status/7'] })).toBe('https://x.com/person/status/7')
})
