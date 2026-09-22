import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { chromiumSecurity, initialSecurity } from '../src/shared/site-security'
import type { SiteSecurity } from '../src/shared/site-security'
import { trackSiteSecurity } from '../src/main/site-security'

let certificateSecurityState = { subjectName: 'example.test', issuer: 'Fixture CA', validFrom: 100, validTo: 200, protocol: 'TLS 1.3' }
let secure = { securityState: 'secure', securityStateIssueIds: [], certificateSecurityState }
describe('connection classification', () => {
  it('requires a Chromium certificate and secure state before showing a lock', () => {
    expect(initialSecurity('https://example.test').status).toBe('unknown')
    expect(chromiumSecurity('https://example.test', { ...secure, certificateSecurityState: undefined }).status).toBe('unknown')
    expect(chromiumSecurity('https://example.test', secure).status).toBe('secure')
    expect(chromiumSecurity('http://localhost', secure).status).toBe('http')
    expect(chromiumSecurity('file:///tmp/example.html', secure).status).toBe('local')
  })
  it('gives certificate failures and mixed content precedence over secure transport', () => {
    expect(chromiumSecurity('https://example.test', { ...secure, certificateSecurityState: { ...certificateSecurityState, certificateNetworkError: 'net::ERR_CERT_DATE_INVALID' } }).status).toBe('certificate-error')
    for (let issue of ['displayed-mixed-content', 'ran-mixed-content', 'insecure-form']) expect(chromiumSecurity('https://example.test', { ...secure, securityStateIssueIds: [issue] }).status).toBe('mixed')
    expect(chromiumSecurity('https://example.test', { ...secure, securityState: 'insecure-broken' }).status).toBe('insecure')
  })
})

it('uses only the committed main document response and clears details across navigation', async () => {
  let url = 'about:blank', updates: SiteSecurity[] = []
  let debuggerEvents = Object.assign(new EventEmitter(), { isAttached: () => true, sendCommand: vi.fn(async () => ({ frameTree: { frame: { id: 'main' } } })) })
  let contents = Object.assign(new EventEmitter(), { getURL: () => url, isDestroyed: () => false, debugger: debuggerEvents })
  await trackSiteSecurity(contents as unknown as WebContents, state => updates.push(state))()
  let message = (method: string, params: unknown, session?: string) => debuggerEvents.emit('message', {}, method, params, session)
  let response = { url: 'https://first.test', securityState: 'secure', securityDetails: certificateSecurityState }
  url = response.url
  contents.emit('did-start-navigation', {}, url, false, true)
  message('Network.requestWillBeSent', { type: 'Document', frameId: 'main', loaderId: 'first', request: { url } })
  message('Network.responseReceived', { type: 'Document', frameId: 'child', loaderId: 'first', response })
  expect(updates.at(-1)?.status).toBe('loading')
  message('Network.responseReceived', { type: 'Document', frameId: 'main', loaderId: 'first', response })
  expect(updates.at(-1)?.status).toBe('loading')
  message('Page.frameNavigated', { frame: { id: 'main', loaderId: 'first', url } })
  expect(updates.at(-1)?.status).toBe('secure')
  message('Network.requestWillBeSent', { type: 'Image', request: { url: 'http://mixed.test/image', mixedContentType: 'optionally-blockable' } })
  expect(updates.at(-1)?.status).toBe('mixed')
  contents.emit('did-start-navigation', {}, url, false, true)
  message('Network.responseReceived', { type: 'Document', frameId: 'main', loaderId: 'first', response })
  expect(updates.at(-1)).toEqual({ url, status: 'loading' })
  message('Page.frameNavigated', { frame: { id: 'main', loaderId: 'first', url } })
  message('Network.responseReceived', { type: 'Document', frameId: 'main', loaderId: 'first', response })
  expect(updates.at(-1)?.status).toBe('loading')
  contents.emit('did-start-navigation', {}, 'https://bad.test', false, true)
  let reply = vi.fn()
  contents.emit('certificate-error', {}, 'https://bad.test', 'net::ERR_CERT_DATE_INVALID', { subjectName: 'bad.test', issuerName: 'Fixture CA', validStart: 1, validExpiry: 2 }, reply, true)
  message('Page.frameNavigated', { frame: { id: 'main', loaderId: 'error', url: 'chrome-error://chromewebdata/' } })
  contents.emit('did-stop-loading')
  expect(updates.at(-1)?.status).toBe('certificate-error')
  expect(reply).not.toHaveBeenCalled()
  url = 'file:///tmp/local.html'
  contents.emit('did-start-navigation', {}, url, false, true)
  message('Page.frameNavigated', { frame: { id: 'main', loaderId: 'local', url } })
  expect(updates.at(-1)).toEqual({ url, status: 'local' })
})
