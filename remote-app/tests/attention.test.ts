import { expect, it } from 'vitest'
import { attentionIdFromData, attentionIdFromUrl } from '../src/links'
import { attentionSelection, attentionStatus } from '../src/types'
import type { AttentionTarget, Host } from '../src/types'
import { createResumeRequests, mergeAttention, resumeAcknowledgement } from '../src/attention'

let host = { id: 'host', generation: 'generation', service: 'Laptop', permission: 'control', key: {}, sessions: [{ id: 'session', name: 'Work', panes: [{ id: 'pane', title: 'Page' }] }] } as Host
let target: AttentionTarget = { id: 'opaque-id', revision: 1, reason: 'help', status: 'pending', createdAt: '2026-10-24T00:00:00Z', host: 'host', generation: 'generation', session: 'session', pane: 'pane', episode: 'stable-episode', resolved: false, online: true }
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
it('keeps verifying distinct from a verified result and ignores stale feed revisions', () => {
  let verifying = { ...target, revision: 2, status: 'verifying' as const }
  expect(attentionStatus(verifying)).toBe('verifying')
  expect(mergeAttention([verifying], [target])).toEqual([verifying])
  expect(() => attentionSelection({ ...target, status: 'cancelled' }, [host])).toThrow('no longer active')
})
it('requires the episode and new revision in a durable verification acknowledgement', () => {
  let acknowledgement = { resumed: true, status: 'verifying', episode: target.episode, revision: 2, attemptId: 'attempt', acknowledgedAt: Date.now() }
  expect(resumeAcknowledgement(acknowledgement, target)).toEqual(acknowledgement)
  for (let value of [{ resumed: true }, { ...acknowledgement, status: 'resolved' }, { ...acknowledgement, episode: 'old' }, { ...acknowledgement, revision: 1 }]) expect(() => resumeAcknowledgement(value, target)).toThrow('did not confirm')
})
it('reuses the persisted request after a lost acknowledgement and scopes retries to owner and revision', async () => {
  let values = new Map<string, string>(), count = 0
  let read = async (key: string) => values.get(key) ?? null
  let write = async (key: string, value: string) => { values.set(key, value) }
  let uuid = () => '00000000-0000-4000-8000-' + (++count).toString().padStart(12, '0')
  let request = createResumeRequests(read, write, uuid)
  let [first, duplicate] = await Promise.all([request('owner', target), request('owner', target)])
  expect(duplicate).toBe(first)
  expect(await createResumeRequests(read, write, uuid)('owner', target)).toBe(first)
  expect(await request('owner', { ...target, revision: 3 })).not.toBe(first)
  expect(await request('other', target)).not.toBe(first)
})
