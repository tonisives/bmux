import { test, expect } from 'vitest'
import { searchBookmarks } from '../src/shared/picker-search'
import { waitOptions } from '../src/main/wait'
import type { Bookmark } from '../src/shared/types'

let bookmarks: Bookmark[] = [{ id: 'work', title: 'Work', children: [
  { id: 'docs', title: 'Documentation', children: [{ id: 'api', title: 'API reference', url: 'https://example.test/api' }] },
  { id: 'notes', title: 'Notes', url: 'https://example.test/notes' },
] }, { id: 'personal', title: 'Personal', children: [{ id: 'recipe', title: 'Recipes', url: 'https://food.test/' }] }]

test('bookmark search preserves folder context without including unrelated siblings', () => {
  let before = structuredClone(bookmarks)
  expect(searchBookmarks(bookmarks, 'api work')).toEqual([{ ...bookmarks[0], children: [bookmarks[0].children![0]] }])
  expect(searchBookmarks(bookmarks, 'EXAMPLE /notes')[0].children?.map(item => item.id)).toEqual(['notes'])
  expect(searchBookmarks(bookmarks, 'work')).toEqual([bookmarks[0]])
  expect(searchBookmarks(bookmarks, 'zzzz')).toEqual([])
  expect(searchBookmarks(bookmarks, '   ')).toBe(bookmarks)
  expect(bookmarks).toEqual(before)
})

test('wait requests validate exclusive modes and reject invalid durations and states', () => {
  for (let args of [{}, { selector: 'div', expression: 'true' }, { selector: 'div', ms: 10 }, { ms: 1, state: 'visible' }, { expression: 'true', state: 'hidden' }]) expect(() => waitOptions(args)).toThrow()
  for (let timeout of ['invalid', 0, -1, Infinity]) expect(() => waitOptions({ selector: 'div', timeout })).toThrow('timeout')
  for (let ms of ['invalid', -1, Infinity]) expect(() => waitOptions({ ms })).toThrow('ms')
  for (let state of ['missing', null, {}]) expect(() => waitOptions({ selector: 'div', state })).toThrow('state')
  expect(() => waitOptions({ selector: ' ' })).toThrow('selector')
  expect(() => waitOptions({ expression: '' })).toThrow('expression')
  expect(waitOptions({ ms: '100', timeout: '10' })).toEqual({ ms: 10, timeout: 10 })
  expect(waitOptions({ expression: 'window.ready', timeout: 100000 })).toEqual({ expression: 'window.ready', timeout: 60000 })
})
