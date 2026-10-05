import { expect, test } from 'vitest'
import { createBookmarkFolder, moveBookmark, removeBookmark, reorderBookmark, saveBookmark, updateBookmark } from '../src/main/bookmarks'
import type { Profile } from '../src/shared/types'

let profile = (): Profile => ({ id: 'profile', name: 'Profile', background: false, bookmarks: [
  { id: 'work', title: 'Work', children: [{ id: 'docs', title: 'Docs', children: [] }] },
  { id: 'existing', title: 'Old title', url: 'https://example.test/page' },
] })

test('saves a new bookmark in the chosen nested folder', () => {
  let current = profile()
  let result = saveBookmark(current, { url: 'https://example.test/new', title: 'New page', folderId: 'docs' }, () => 'bookmark_new')
  expect(result).toMatchObject({ created: true, bookmark: { id: 'bookmark_new', title: 'New page' } })
  expect(current.bookmarks?.[0].children?.[0].children).toEqual([{ id: 'bookmark_new', title: 'New page', url: 'https://example.test/new' }])
})

test('updates and moves an existing URL instead of creating a duplicate', () => {
  let current = profile()
  let result = saveBookmark(current, { url: 'https://example.test/page', title: 'Updated title', folderId: 'work' }, () => 'unused')
  expect(result.created).toBe(false)
  expect(current.bookmarks?.filter(bookmark => bookmark.url)).toEqual([])
  expect(current.bookmarks?.[0].children?.at(-1)).toEqual({ id: 'existing', title: 'Updated title', url: 'https://example.test/page' })
})

test('rejects an unknown bookmark folder without changing the profile', () => {
  let current = profile(), before = structuredClone(current)
  expect(() => saveBookmark(current, { url: 'https://example.test/new', title: 'New page', folderId: 'missing' }, () => 'unused')).toThrow('Bookmark folder not found')
  expect(current).toEqual(before)
})

test('creates nested folders and reuses a same-name folder in that parent', () => {
  let current = profile()
  let result = createBookmarkFolder(current, { title: 'Reading', parentId: 'docs' }, () => 'folder_reading')
  expect(result).toMatchObject({ created: true, folder: { id: 'folder_reading', title: 'Reading', children: [] } })
  expect(current.bookmarks?.[0].children?.[0].children).toEqual([result.folder])
  expect(createBookmarkFolder(current, { title: 'reading', parentId: 'docs' }, () => 'unused')).toEqual({ folder: result.folder, created: false })
})

test('rejects an unknown parent folder without changing the profile', () => {
  let current = profile(), before = structuredClone(current)
  expect(() => createBookmarkFolder(current, { title: 'Reading', parentId: 'missing' }, () => 'unused')).toThrow('Parent bookmark folder not found')
  expect(current).toEqual(before)
})

test('reorders siblings inside a nested folder without moving bookmarks across folders', () => {
  let current = profile()
  let docs = current.bookmarks![0].children![0].children!
  docs.push({ id: 'first', title: 'First', url: 'https://example.test/first' }, { id: 'second', title: 'Second', url: 'https://example.test/second' })
  expect(reorderBookmark(current, 'second', 'up')).toEqual({ moved: true })
  expect(docs.map(bookmark => bookmark.id)).toEqual(['second', 'first'])
  expect(reorderBookmark(current, 'second', 'up')).toEqual({ moved: false })
  expect(current.bookmarks?.map(bookmark => bookmark.id)).toEqual(['work', 'existing'])
  expect(() => reorderBookmark(current, 'missing', 'down')).toThrow('Bookmark not found')
})

test('moves a bookmark directly to a sibling position', () => {
  let current = profile()
  let docs = current.bookmarks![0].children![0].children!
  docs.push(...['first', 'second', 'third'].map(id => ({ id, title: id, url: `https://example.test/${id}` })))
  expect(moveBookmark(current, 'third', 'first', 'before')).toEqual({ moved: true })
  expect(docs.map(bookmark => bookmark.id)).toEqual(['third', 'first', 'second'])
  expect(moveBookmark(current, 'third', 'second', 'after')).toEqual({ moved: true })
  expect(docs.map(bookmark => bookmark.id)).toEqual(['first', 'second', 'third'])
  expect(moveBookmark(current, 'third', 'second', 'after')).toEqual({ moved: false })
  expect(() => moveBookmark(current, 'third', 'existing', 'before')).toThrow('Bookmarks must be in the same folder')
})

test('updates saved bookmark URLs and folder titles by ID', () => {
  let current = profile()
  expect(updateBookmark(current, 'existing', { url: 'https://example.test/updated' }).url).toBe('https://example.test/updated')
  expect(updateBookmark(current, 'work', { title: 'Renamed work' }).title).toBe('Renamed work')
  expect(() => updateBookmark(current, 'work', { url: 'https://example.test/folder' })).toThrow('A folder cannot have a URL')
})

test('removes nested bookmarks and entire folders without changing siblings or other profiles', () => {
  let current = profile(), other = profile(), before = structuredClone(other)
  let docs = current.bookmarks![0].children![0]
  docs.children!.push({ id: 'nested', title: 'Nested', url: 'https://example.test/nested' })
  expect(removeBookmark(current, 'nested').id).toBe('nested')
  expect(docs.children).toEqual([])
  expect(removeBookmark(current, 'work').children).toEqual([docs])
  expect(current.bookmarks?.map(bookmark => bookmark.id)).toEqual(['existing'])
  expect(other).toEqual(before)
  let remaining = structuredClone(current)
  expect(() => removeBookmark(current, 'missing')).toThrow('Bookmark not found')
  expect(current).toEqual(remaining)
})
