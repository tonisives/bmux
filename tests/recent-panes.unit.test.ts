import { expect, test } from 'vitest'
import { newSession, newWindow } from '../src/main/model'
import { recentBackgroundPanes } from '../src/main/recent-panes'
import type { Client } from '../src/shared/types'

let fixture = () => {
  let session = newSession('gp', 'default')
  session.windows = Array.from({ length: 8 }, (_, index) => newWindow(String(index + 1), 'default'))
  let ids = session.windows.map(window => window.panes[0].id)
  let client = { windowHistory: session.windows.slice().reverse().map(window => window.id) } as Client
  let now = 30 * 60_000
  let visits = new Map(ids.map(id => [id, now - 1000]))
  return { session, ids, client, now, visits }
}

test('retains four hidden panes in Recent order rather than background activity order', () => {
  let { session, ids, client, now, visits } = fixture()
  session.windows[0].panes[0].lastActivityAt = now
  visits.set(ids[0], now)
  let recent = recentBackgroundPanes([session], [client], new Set(ids.slice(0, 7)), visits, now)
  expect(recent.order).toEqual(ids.slice(0, 7).reverse())
  expect([...recent.retained]).toEqual(ids.slice(3, 7).reverse())
})

test('switching gp 6 to 8 to 6 retains the original renderer slot', () => {
  let { session, ids, client, now, visits } = fixture()
  client.windowHistory = [session.windows[7].id, session.windows[5].id]
  let hidden = new Set(ids.filter(id => id !== ids[7]))
  expect(recentBackgroundPanes([session], [client], hidden, visits, now).retained.has(ids[5])).toBe(true)
  client.windowHistory.unshift(session.windows[5].id)
  hidden.delete(ids[5]); hidden.add(ids[7])
  expect(recentBackgroundPanes([session], [client], hidden, visits, now).retained.has(ids[7])).toBe(true)
})

test('protection expires after twenty minutes and background-only panes do not get it', () => {
  let { session, ids, client, now, visits } = fixture()
  visits.delete(ids[7])
  visits.set(ids[6], now - 20 * 60_000)
  visits.set(ids[5], now - 20 * 60_000 + 1)
  let recent = recentBackgroundPanes([session], [client], new Set(ids), visits, now)
  expect(recent.retained.has(ids[7])).toBe(false)
  expect(recent.retained.has(ids[6])).toBe(false)
  expect(recent.retained.has(ids[5])).toBe(true)
  expect(recentBackgroundPanes([session], [client], new Set(ids), visits, now + 20 * 60_000).retained.size).toBe(0)
})

test('split panes share window recency and only loaded hidden panes take slots', () => {
  let { session, ids, client, now, visits } = fixture()
  session.windows[7].panes.push(...session.windows[6].panes)
  session.windows.splice(6, 1)
  let recent = recentBackgroundPanes([session], [client], new Set([ids[7], ids[6], ids[0]]), visits, now)
  expect([...recent.retained]).toEqual([ids[7], ids[6], ids[0]])
})
