import type { Bookmark, HistoryEntry } from './types'
import { fuzzyMatch } from './command-search'

export let searchBookmarks = (bookmarks: Bookmark[], query: string): Bookmark[] => {
  if (!query.trim()) return bookmarks
  return bookmarks.flatMap(bookmark => {
    if (!bookmark.children) return fuzzyMatch(query, `${bookmark.title} ${bookmark.url ?? ''}`) ? [bookmark] : []
    let children = searchBookmarks(bookmark.children, query)
    return children.length || fuzzyMatch(query, bookmark.title) ? [{ ...bookmark, children }] : []
  })
}

export let searchBookmarkPages = (bookmarks: Bookmark[], query: string): Bookmark[] => {
  if (!query.trim()) return []
  return bookmarks.flatMap(bookmark => bookmark.children
    ? searchBookmarkPages(bookmark.children, query)
    : bookmark.url && /^(https?:|file:)/i.test(bookmark.url) && fuzzyMatch(query, bookmark.title) ? [bookmark] : [])
}

export let searchHistory = (history: HistoryEntry[], query: string): HistoryEntry[] => {
  if (!query.trim()) return history
  return history.filter(entry => fuzzyMatch(query, `${entry.title} ${entry.url}`))
}
