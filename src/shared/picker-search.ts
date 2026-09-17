import type { Bookmark, HistoryEntry } from './types'
import { fuzzyMatch } from './command-search'

type BookmarkMatch = { priority: number; score: number }
type ScoredBookmark = { bookmark: Bookmark; match: BookmarkMatch }

let fieldMatch = (query: string, value: string, priority: number): BookmarkMatch | undefined => {
  let normalizedQuery = query.trim().toLocaleLowerCase(), normalizedValue = value.toLocaleLowerCase(), terms = normalizedQuery.split(/\s+/).filter(Boolean)
  if (!terms.every(term => normalizedValue.includes(term))) return
  let firstMatch = Math.min(...terms.map(term => normalizedValue.indexOf(term)))
  return { priority, score: (normalizedValue === normalizedQuery ? 1000 : normalizedValue.includes(normalizedQuery) ? 700 : 500) - firstMatch * 0.1 - value.length * 0.01 }
}

let compareMatches = (a: BookmarkMatch, b: BookmarkMatch) => b.priority - a.priority || b.score - a.score
let bestMatch = (matches: (BookmarkMatch | undefined)[]) => matches.filter((match): match is BookmarkMatch => !!match).sort(compareMatches)[0]
let pageMatch = (bookmark: Bookmark, query: string) => bestMatch([
  fieldMatch(query, bookmark.title, 3),
  bookmark.url ? fieldMatch(query, bookmark.url, 1) : undefined,
])

let searchBookmarkResults = (bookmarks: Bookmark[], query: string): ScoredBookmark[] => bookmarks.flatMap(bookmark => {
  if (!bookmark.children) {
    let match = pageMatch(bookmark, query)
    return match ? [{ bookmark, match }] : []
  }
  let children = searchBookmarkResults(bookmark.children, query), match = bestMatch([
    fieldMatch(query, bookmark.title, 2),
    children[0]?.match,
  ])
  return match ? [{ bookmark: { ...bookmark, children: children.map(result => result.bookmark) }, match }] : []
}).sort((a, b) => compareMatches(a.match, b.match))

let searchBookmarkPageResults = (bookmarks: Bookmark[], query: string): ScoredBookmark[] => bookmarks.flatMap(bookmark => {
  if (bookmark.children) return searchBookmarkPageResults(bookmark.children, query)
  if (!bookmark.url || !/^(https?:|file:)/i.test(bookmark.url)) return []
  let match = pageMatch(bookmark, query)
  return match ? [{ bookmark, match }] : []
}).sort((a, b) => compareMatches(a.match, b.match))

export let searchBookmarks = (bookmarks: Bookmark[], query: string): Bookmark[] => {
  if (!query.trim()) return bookmarks
  return searchBookmarkResults(bookmarks, query).map(result => result.bookmark)
}

export let searchBookmarkPages = (bookmarks: Bookmark[], query: string): Bookmark[] => {
  if (!query.trim()) return []
  return searchBookmarkPageResults(bookmarks, query).map(result => result.bookmark)
}

export let searchHistory = (history: HistoryEntry[], query: string): HistoryEntry[] => {
  if (!query.trim()) return history
  return history.filter(entry => fuzzyMatch(query, `${entry.title} ${entry.url}`))
}
