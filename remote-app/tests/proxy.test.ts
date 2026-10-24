import { expect, it } from 'vitest'
import { proxyDraft } from '../src/proxy'

it('keeps saved credentials without exposing them and separates an explicit replacement or clear', () => {
  expect(proxyDraft('http', 'proxy.example.com', '8080', 'keep', true, '', '')).toEqual({ proxy: { protocol: 'http', host: 'proxy.example.com', port: 8080, authenticated: true }, credentials: { action: 'keep' } })
  expect(proxyDraft('socks5', '::1', '1080', 'clear', true, '', '')).toEqual({ proxy: { protocol: 'socks5', host: '::1', port: 1080, authenticated: false }, credentials: { action: 'clear' } })
  expect(proxyDraft('https', 'proxy.example.com', '443', 'replace', false, 'user', 'secret').credentials).toEqual({ action: 'replace', username: 'user', password: 'secret' })
})
it('rejects inline credentials, invalid ports, and incomplete authentication before sending', () => {
  for (let host of ['http://proxy.example.com', 'user:pass@proxy.example.com', 'proxy.example.com/path']) expect(() => proxyDraft('http', host, '8080', 'clear', false, '', '')).toThrow('proxy host')
  for (let port of ['0', '65536', '80.5', '80abc']) expect(() => proxyDraft('http', 'proxy.example.com', port, 'clear', false, '', '')).toThrow('port')
  expect(() => proxyDraft('http', 'proxy.example.com', '8080', 'replace', false, 'user', '')).toThrow('username and password')
})
