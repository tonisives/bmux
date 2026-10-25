import { expect, test, vi } from 'vitest'
import { createNavigationProxyHints } from '../src/main/navigation-proxy-hints'

test.each(['localhost', 'app.localhost', '127.4.3.2', '0.0.0.0', '10.1.2.3', '100.64.1.2', '172.16.0.1', '192.168.1.4', '169.254.1.2', '[::1]', '[::]', '[fd12::1]', '[fe80::1]', '[::ffff:127.0.0.1]'])('recognizes local destination %s without DNS', hostname => {
  let resolve = vi.fn(), hints = createNavigationProxyHints(vi.fn(), resolve)
  hints.record('pane', 'ERR_CONNECTION_REFUSED', `http://${hostname}:4317/page`, true)
  expect(hints.hints.pane.local).toBe(true)
  expect(resolve).not.toHaveBeenCalled()
})

test.each(['172.15.0.1', '172.32.0.1', '100.128.0.1', '192.0.2.1', '8.8.8.8', '[2001:4860:4860::8888]'])('keeps public destination %s conditional', hostname => {
  let resolve = vi.fn(), hints = createNavigationProxyHints(vi.fn(), resolve)
  hints.record('pane', 'ERR_HTTP2_PROTOCOL_ERROR', `https://${hostname}/page`, true)
  expect(hints.hints.pane.local).toBe(false)
  expect(resolve).not.toHaveBeenCalled()
})

test('recognizes a custom hostname through the browser host resolver', async () => {
  let notify = vi.fn(), resolve = vi.fn(async () => [{ address: '127.0.0.1' }, { address: '::1' }])
  let hints = createNavigationProxyHints(notify, resolve)
  hints.record('pane', 'net::ERR_EMPTY_RESPONSE', 'https://videos.custom-domain.dev/private?value=fixture', true)
  expect(hints.hints.pane).toEqual({ hostname: 'videos.custom-domain.dev', local: false, required: false })
  await Promise.resolve()
  expect(hints.hints.pane.local).toBe(true)
  expect(resolve).toHaveBeenCalledWith('videos.custom-domain.dev')
  expect(notify).toHaveBeenCalledOnce()
})

test('keeps mixed, public, empty and failed DNS answers conditional', async () => {
  for (let answers of [[{ address: '127.0.0.1' }, { address: '203.0.113.8' }], [{ address: '203.0.113.8' }], []]) {
    let hints = createNavigationProxyHints(vi.fn(), async () => answers)
    hints.record('pane', 'ERR_NAME_NOT_RESOLVED', 'https://custom-domain.dev/', true)
    await Promise.resolve()
    expect(hints.hints.pane.local).toBe(false)
  }
  let hints = createNavigationProxyHints(vi.fn(), async () => { throw new Error('DNS unavailable') })
  hints.record('pane', 'ERR_TUNNEL_CONNECTION_FAILED', 'https://custom-domain.dev/', true)
  await Promise.resolve()
  expect(hints.hints.pane.local).toBe(false)
})

test('limits hints to proxied network failures and preserves required-host context', () => {
  let resolve = vi.fn(), hints = createNavigationProxyHints(vi.fn(), resolve)
  for (let error of ['ERR_CONNECTION_RESET', 'ERR_PROXY_CONNECTION_FAILED', 'PROXY_UNAVAILABLE']) {
    hints.record('pane', error, 'http://localhost/', true, true)
    expect(hints.hints.pane.required).toBe(true)
  }
  for (let [error, url, proxied] of [['ERR_CERT_AUTHORITY_INVALID', 'https://localhost/', true], ['ERR_ABORTED', 'http://localhost/', true], ['Page process crashed', 'http://localhost/', true], ['ERR_EMPTY_RESPONSE', 'file:///fixture', true], ['ERR_EMPTY_RESPONSE', 'http://localhost/', false]] as const) {
    hints.record('pane', error, url, proxied)
    expect(hints.hints.pane).toBeUndefined()
  }
  expect(resolve).not.toHaveBeenCalled()
})

test('ignores DNS results after navigation, replacement, or pane disposal', async () => {
  let pending: ((addresses: { address: string }[]) => void)[] = [], notify = vi.fn()
  let hints = createNavigationProxyHints(notify, () => new Promise(resolve => pending.push(resolve)))
  hints.record('pane', 'ERR_EMPTY_RESPONSE', 'http://first.custom-domain.dev/', true)
  hints.clear('pane')
  hints.record('pane', 'ERR_EMPTY_RESPONSE', 'http://second.custom-domain.dev/', true)
  pending[0]([{ address: '127.0.0.1' }])
  await Promise.resolve()
  expect(hints.hints.pane).toMatchObject({ hostname: 'second.custom-domain.dev', local: false })
  hints.clear('pane')
  pending[1]([{ address: '127.0.0.1' }])
  await Promise.resolve()
  expect(hints.hints.pane).toBeUndefined()
  expect(notify).not.toHaveBeenCalled()
})
