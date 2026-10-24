import { expect, it } from 'vitest'
import { attentionIdFromData, attentionIdFromUrl } from '../src/links'
import { attentionSelection, attentionStatus } from '../src/types'
import type { AttentionTarget, Host } from '../src/types'

let host = { id: 'host', generation: 'generation', service: 'Laptop', permission: 'control', key: {}, sessions: [{ id: 'session', name: 'Work', panes: [{ id: 'pane', title: 'Page' }] }] } as Host
let target: AttentionTarget = { id: 'opaque-id', reason: 'help', host: 'host', generation: 'generation', session: 'session', pane: 'pane', episode: 'stable-episode', resolved: false, online: true }
it('accepts canonical web and native links', () => {
  for (let value of ['https://remote.bmux.cc/attention/opaque-id', 'bmux-remote://attention/opaque-id', 'bmux-remote:///attention/opaque-id']) expect(attentionIdFromUrl(value)).toBe('opaque-id')
})
it('rejects foreign origins, paths, and payloads', () => {
  for (let value of ['https://remote.bmux.cc.evil.test/attention/opaque-id', 'https://remote.bmux.cc:8443/attention/opaque-id', 'http://remote.bmux.cc/attention/opaque-id', 'bmux-remote://auth/callback', 'bmux-remote://attention/a%2Fb']) expect(attentionIdFromUrl(value)).toBeUndefined()
  expect(attentionIdFromData({ attentionId: 'opaque-id', pane: 'untrusted-pane' })).toBe('opaque-id')
  expect(attentionIdFromData({ pane: 'pane' })).toBeUndefined()
})
it('selects only the resolved exact host generation, session, and pane', () => {
  expect(attentionSelection(target, [host])).toEqual({ host: 'host', generation: 'generation', session: 'session', pane: 'pane' })
  expect(() => attentionSelection({ ...target, generation: 'old' }, [host])).toThrow('no longer available')
  expect(() => attentionSelection({ ...target, pane: 'old' }, [host])).toThrow('no longer available')
  expect(() => attentionSelection({ ...target, online: false }, [host])).toThrow('offline')
  expect(() => attentionSelection({ ...target, resolved: true }, [host])).toThrow('already resolved')
})
it('supports the deployed attention list without inventing verification success', () => {
  expect(attentionStatus({ id: 'id', reason: 'help', created_at: '' })).toBe('pending')
  expect(attentionStatus({ id: 'id', reason: 'help', created_at: '', status: 'verifying' })).toBe('verifying')
})
