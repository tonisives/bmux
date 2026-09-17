import type { Bookmark, HistoryEntry } from './types'
import { fuzzyMatch } from './command-search'

let titleMatches = (title: string, query: string) => title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())

export let searchBookmarks = (bookmarks: Bookmark[], query: string): Bookmark[] => {
  if (!query.trim()) return bookmarks
  return bookmarks.flatMap(bookmark => {
    if (!bookmark.children) return titleMatches(bookmark.title, query) ? [bookmark] : []
    let children = searchBookmarks(bookmark.children, query)
    return children.length || titleMatches(bookmark.title, query) ? [{ ...bookmark, children }] : []
  })
}

export let searchBookmarkPages = (bookmarks: Bookmark[], query: string): Bookmark[] => {
  if (!query.trim()) return []
  return bookmarks.flatMap(bookmark => bookmark.children
    ? searchBookmarkPages(bookmark.children, query)
    : bookmark.url && /^(https?:|file:)/i.test(bookmark.url) && titleMatches(bookmark.title, query) ? [bookmark] : [])
}

export let searchHistory = (history: HistoryEntry[], query: string): HistoryEntry[] => {
  if (!query.trim()) return history
  return history.filter(entry => fuzzyMatch(query, `${entry.title} ${entry.url}`))
}
