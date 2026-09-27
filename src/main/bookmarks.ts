import type { Bookmark, Profile } from '../shared/types'

type BookmarkLocation = { bookmark: Bookmark; parent: Bookmark[] }

export let bookmarkById = (bookmarks: Bookmark[], bookmarkId: string): Bookmark | undefined => {
  for (let bookmark of bookmarks) {
    if (bookmark.id === bookmarkId) return bookmark
    let nested = bookmark.children && bookmarkById(bookmark.children, bookmarkId)
    if (nested) return nested
  }
}

let findFolder = (bookmarks: Bookmark[], folderId: string): Bookmark | undefined => {
  for (let bookmark of bookmarks) {
    if (bookmark.id === folderId && bookmark.children) return bookmark
    let nested = bookmark.children && findFolder(bookmark.children, folderId)
    if (nested) return nested
  }
  return undefined
}

let findByUrl = (bookmarks: Bookmark[], url: string): BookmarkLocation[] => bookmarks.flatMap(bookmark => [
  ...(bookmark.url === url ? [{ bookmark, parent: bookmarks }] : []),
  ...(bookmark.children ? findByUrl(bookmark.children, url) : []),
])

export let saveBookmark = (profile: Profile, values: { url: string; title: string; folderId?: string }, createId: () => string) => {
  let bookmarks = profile.bookmarks ?? []
  let destination = values.folderId ? findFolder(bookmarks, values.folderId)?.children : bookmarks
  if (!destination) throw new Error('Bookmark folder not found')
  let matches = findByUrl(bookmarks, values.url)
  let bookmark = matches[0]?.bookmark ?? { id: createId(), title: values.title, url: values.url }
  for (let match of matches) match.parent.splice(match.parent.indexOf(match.bookmark), 1)
  bookmark.title = values.title
  bookmark.url = values.url
  destination.push(bookmark)
  profile.bookmarks = bookmarks
  return { bookmark, created: matches.length === 0 }
}

export let createBookmarkFolder = (profile: Profile, values: { title: string; parentId?: string }, createId: () => string) => {
  let bookmarks = profile.bookmarks ?? []
  let destination = values.parentId ? findFolder(bookmarks, values.parentId)?.children : bookmarks
  if (!destination) throw new Error('Parent bookmark folder not found')
  let existing = destination.find(bookmark => bookmark.children && bookmark.title.localeCompare(values.title, undefined, { sensitivity: 'accent' }) === 0)
  if (existing) return { folder: existing, created: false }
  let folder: Bookmark = { id: createId(), title: values.title, children: [] }
  destination.push(folder)
  profile.bookmarks = bookmarks
  return { folder, created: true }
}

export let reorderBookmark = (profile: Profile, bookmarkId: string, direction: 'up' | 'down') => {
  let siblings = (items: Bookmark[]): Bookmark[] | undefined => {
    if (items.some(item => item.id === bookmarkId)) return items
    for (let item of items) {
      let found = item.children && siblings(item.children)
      if (found) return found
    }
  }
  let items = siblings(profile.bookmarks ?? [])
  if (!items) throw new Error('Bookmark not found')
  let index = items.findIndex(item => item.id === bookmarkId), next = index + (direction === 'up' ? -1 : 1)
  if (next < 0 || next >= items.length) return { moved: false }
  let bookmark = items[index]
  items[index] = items[next]
  items[next] = bookmark
  return { moved: true }
}

export let moveBookmark = (profile: Profile, bookmarkId: string, targetId: string, position: 'before' | 'after') => {
  let siblings = (items: Bookmark[]): Bookmark[] | undefined => {
    if (items.some(item => item.id === bookmarkId)) return items
    for (let item of items) {
      let found = item.children && siblings(item.children)
      if (found) return found
    }
  }
  let items = siblings(profile.bookmarks ?? [])
  if (!items) throw new Error('Bookmark not found')
  let source = items.findIndex(item => item.id === bookmarkId)
  let target = items.findIndex(item => item.id === targetId)
  if (target < 0) throw new Error('Bookmarks must be in the same folder')
  let destination = target + (position === 'after' ? 1 : 0) - (source < target ? 1 : 0)
  if (destination === source) return { moved: false }
  items.splice(destination, 0, items.splice(source, 1)[0])
  return { moved: true }
}

export let updateBookmark = (profile: Profile, bookmarkId: string, values: { title?: string; url?: string }) => {
  let bookmark = bookmarkById(profile.bookmarks ?? [], bookmarkId)
  if (!bookmark) throw new Error('Bookmark not found')
  if (values.url !== undefined && !bookmark.url) throw new Error('A folder cannot have a URL')
  if (values.title !== undefined) bookmark.title = values.title
  if (values.url !== undefined) bookmark.url = values.url
  return bookmark
}
