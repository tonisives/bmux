import { expect, it } from 'vitest'
import { browserAddress } from '../src/address'

it('accepts web addresses and a blank new page', () => {
  expect(browserAddress(' example.com/path ')).toBe('https://example.com/path')
  expect(browserAddress('localhost:3000')).toBe('https://localhost:3000/')
  expect(browserAddress('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
  expect(browserAddress('about:blank')).toBe('about:blank')
  expect(browserAddress('')).toBeUndefined()
})
it.each(['javascript:alert(1)', 'file:///tmp/private', 'data:text/html,hello', 'https://user:password@example.com'])('rejects non-web or credential-bearing addresses', value => {
  expect(() => browserAddress(value)).toThrow()
})
