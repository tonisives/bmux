import type { Bookmark } from './types'
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
