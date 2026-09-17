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
