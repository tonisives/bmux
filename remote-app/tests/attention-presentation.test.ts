import { expect, it } from 'vitest'
import { attentionDetails, paneAttention, pendingAttention } from '../src/attention-presentation'
import type { Attention, Host } from '../src/types'

let host = { id: 'host', generation: 'current', service: 'Work computer', permission: 'control', key: {}, sessions: [{ id: 'session', name: 'Scraper', panes: [{ id: 'page', title: 'Browser check' }] }] } as Host
let item: Attention = { id: 'attention', host: host.id, generation: host.generation, session: 'session', pane: 'page', episode: 'episode', reason: 'challenge', status: 'pending', resolved: false, online: true, createdAt: '2026-10-25T00:00:00Z', revision: 1 }

it('labels the exact current request without borrowing a page from another runtime or session', () => {
  expect(attentionDetails(item, [host])).toMatchObject({ title: 'Browser needs attention', page: 'Browser check', context: 'Work computer · Scraper' })
  expect(attentionDetails({ ...item, generation: 'previous' }, [host])).toMatchObject({ page: undefined, context: 'Work computer' })
  expect(attentionDetails({ ...item, session: 'other' }, [host]).page).toBeUndefined()
  expect(attentionDetails({ ...item, pane: 'other' }, [host]).page).toBeUndefined()
})

it('marks only the matching current page and leaves completed or dismissed work out of the pending list', () => {
  let checking = { ...item, id: 'checking', status: 'verifying' as const }
  let complete = { ...item, id: 'complete', status: 'resolved' as const, resolved: true }
  let dismissed = { ...item, id: 'dismissed', dismissedAt: '2026-10-25T00:01:00Z' }
  expect(pendingAttention([item, checking, complete, dismissed])).toEqual([item, checking])
  expect(paneAttention([item], item)).toBe(item)
  for (let change of [{ generation: 'previous' }, { session: 'other' }, { pane: 'other' }]) expect(paneAttention([item], { ...item, ...change })).toBeUndefined()
  expect(paneAttention([complete, dismissed], item)).toBeUndefined()
})
