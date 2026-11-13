import { expect, test } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

test('X search evaluates the generated page script and returns bounded post results', () => {
  let source = fs.readFileSync('optional-plugins/bmux.x/social.mjs', 'utf8')
  let start = source.indexOf('  const expression = isX')
  let end = source.indexOf('  return collectSearchResults(', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  let expression = vm.runInNewContext(`(() => { let isX = true, resultLimit = 1; ${source.slice(start, end)}; return expression })()`)
  let card = (text: string, url: string) => ({
    querySelector: (selector: string) => selector === '[data-testid="tweetText"]' ? { innerText: text } : selector === 'time' ? { closest: () => ({ href: url }) } : selector === '[data-testid="User-Name"]' ? { innerText: 'Founder\n@founder' } : null,
    querySelectorAll: () => [],
  })
  let document = { querySelectorAll: () => [card('Profile', 'https://x.com/founder'), card('Looking for a tool', 'https://x.com/founder/status/123'), card('Another post', 'https://x.com/founder/status/456')] }
  expect(vm.runInNewContext(expression, { document })).toEqual([{ author: 'Founder', url: 'https://x.com/founder/status/123', text: 'Looking for a tool' }])
})
