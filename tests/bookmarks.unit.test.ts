import { expect, test } from 'vitest'
import { createBookmarkFolder, saveBookmark } from '../src/main/bookmarks'
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
