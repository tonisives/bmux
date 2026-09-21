import { test, expect } from 'vitest'
import { searchBookmarkPages, searchBookmarks, searchHistory } from '../src/shared/picker-search'
import { waitOptions } from '../src/main/wait'
import type { Bookmark } from '../src/shared/types'

let bookmarks: Bookmark[] = [{ id: 'work', title: 'Work', children: [
  { id: 'docs', title: 'Documentation', children: [{ id: 'api', title: 'API reference', url: 'https://example.test/api' }] },
  { id: 'notes', title: 'Notes', url: 'https://example.test/notes' },
] }, { id: 'personal', title: 'Personal', children: [{ id: 'recipe', title: 'Recipes', url: 'https://food.test/' }] }]

test('bookmark search preserves folder context without including unrelated siblings', () => {
  let before = structuredClone(bookmarks)
  expect(searchBookmarks(bookmarks, 'api reference')).toEqual([{ ...bookmarks[0], children: [bookmarks[0].children![0]] }])
  expect(searchBookmarks(bookmarks, 'NOTES')[0].children?.map(item => item.id)).toEqual(['notes'])
  expect(searchBookmarks(bookmarks, 'work')).toEqual([{ ...bookmarks[0], children: [] }])
  expect(searchBookmarks(bookmarks, 'zzzz')).toEqual([])
  expect(searchBookmarks(bookmarks, '   ')).toBe(bookmarks)
  expect(bookmarks).toEqual(before)
})

test('bookmark search finds page names and URLs without carrying a matching folder into every result', () => {
  let personal: Bookmark[] = [{ id: 'personal', title: 'Personal', children: [
    { id: 'sessions', title: 'Sessions', url: 'https://example.test/sessions' },
    { id: 'suggestions', title: 'Search suggestions', url: 'https://example.test/suggestions' },
    { id: 'url-only', title: 'Other page', url: 'https://example.test/sessions/other' },
    { id: 'purchase', title: 'Purchase screen', url: 'https://example.test/purchase' },
  ] }]
  expect(searchBookmarks(personal, 'sessions')[0].children?.map(item => item.id)).toEqual(['sessions', 'url-only'])
  expect(searchBookmarks(personal, 'SeSsIoNs')[0].children?.map(item => item.id)).toEqual(['sessions', 'url-only'])
  expect(searchBookmarks(personal, 'purchase screen')[0].children?.map(item => item.id)).toEqual(['purchase'])
  expect(searchBookmarkPages(personal, 'sessions').map(item => item.id)).toEqual(['sessions', 'url-only'])
  expect(searchBookmarkPages(personal, 'purchase screen').map(item => item.id)).toEqual(['purchase'])
  expect(searchBookmarkPages(personal, 'personal')).toEqual([])
})

test('bookmark search ranks titles before folders and URLs', () => {
  let ranked: Bookmark[] = [
    { id: 'url', title: 'Social home', url: 'https://x.com' },
    { id: 'folder', title: 'x.com', children: [] },
    { id: 'title', title: 'X.com guide', url: 'https://example.test/guide' },
  ]
  expect(searchBookmarks(ranked, 'x.com').map(bookmark => bookmark.id)).toEqual(['title', 'folder', 'url'])
})

test('history search matches titles and URLs without changing recency order', () => {
  let history = [
    { title: 'API reference', url: 'https://example.test/docs/api', visitedAt: 3 },
    { title: 'Project notes', url: 'https://notes.test/project', visitedAt: 2 },
    { title: 'URL inspection', url: 'https://search.google.com/search-console/inspect?resource_id=sc-domain:trend-seeker.app', visitedAt: 1.5 },
    { title: 'Recipes', url: 'https://food.test/', visitedAt: 1 },
  ]
  expect(searchHistory(history, 'proj note')).toEqual([history[1]])
  expect(searchHistory(history, 'example api')).toEqual([history[0]])
  expect(searchHistory(history, 'search trend')).toEqual([history[2]])
  expect(searchHistory(history, 'trend search')).toEqual([history[2]])
  expect(searchHistory(history, 'SRCH TRND')).toEqual([history[2]])
  expect(searchHistory(history, 'zzzz')).toEqual([])
  expect(searchHistory(history, '   ')).toBe(history)
})

test('wait requests validate exclusive modes and reject invalid durations and states', () => {
  for (let args of [{}, { selector: 'div', expression: 'true' }, { selector: 'div', ms: 10 }, { ms: 1, state: 'visible' }, { expression: 'true', state: 'hidden' }]) expect(() => waitOptions(args)).toThrow()
  for (let timeout of ['invalid', '', true, null, [], 0, -1, Infinity]) expect(() => waitOptions({ selector: 'div', timeout })).toThrow('timeout')
  for (let ms of ['invalid', '', true, null, [], -1, Infinity]) expect(() => waitOptions({ ms })).toThrow('ms')
  for (let state of ['missing', null, {}]) expect(() => waitOptions({ selector: 'div', state })).toThrow('state')
  expect(() => waitOptions({ selector: ' ' })).toThrow('selector')
  expect(() => waitOptions({ expression: '' })).toThrow('expression')
  expect(waitOptions({ ms: '100', timeout: '10' })).toEqual({ ms: 10, timeout: 10 })
  expect(waitOptions({ expression: 'window.ready', timeout: 100000 })).toEqual({ expression: 'window.ready', timeout: 60000 })
})
