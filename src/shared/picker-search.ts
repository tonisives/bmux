import type { Bookmark, HistoryEntry } from './types'
import { fuzzyMatch } from './command-search'

export let searchBookmarks = (bookmarks: Bookmark[], query: string, ancestors = ''): Bookmark[] => {
  if (!query.trim()) return bookmarks
  return bookmarks.flatMap(bookmark => {
    let title = `${ancestors} ${bookmark.title}`
    if (!bookmark.children) return fuzzyMatch(query, `${title} ${bookmark.url ?? ''}`) ? [bookmark] : []
    let children = searchBookmarks(bookmark.children, query, title)
    return children.length ? [{ ...bookmark, children }] : []
  })
}

export let searchHistory = (history: HistoryEntry[], query: string): HistoryEntry[] => {
  if (!query.trim()) return history
  return history.filter(entry => fuzzyMatch(query, `${entry.title} ${entry.url}`))
}
