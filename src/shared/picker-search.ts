import type { Bookmark, Client, HistoryEntry, InternalWindow, WorkspaceSession } from './types'
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
type SessionSearchResult = { session: WorkspaceSession; windows: InternalWindow[]; matched: boolean }

export let sortSessionsByRecentVisit = (sessions: WorkspaceSession[], client?: Pick<Client, 'sessionHistory' | 'windowHistory'>): WorkspaceSession[] => {
  let sortByHistory = <T extends { id: string }>(items: T[], history: string[] = []) => {
    let positions = new Map(history.map((id, index) => [id, index]))
    return [...items].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity))
  }
  return sortByHistory(sessions, client?.sessionHistory).map(session => ({ ...session, windows: sortByHistory(session.windows, client?.windowHistory) }))
}

export let searchSessions = (sessions: WorkspaceSession[], query: string): SessionSearchResult[] => {
  if (!query.trim()) return sessions.map(session => ({ session, windows: session.windows, matched: true }))
  let search = (literal: boolean) => sessions.flatMap(session => {
    let matchField = (value: string, priority: number): BookmarkMatch | undefined => {
      if (literal) return fieldMatch(query, value, priority)
      let match = fuzzyMatch(query, value)
      return match ? { priority, score: match.score } : undefined
    }
    let sessionMatch = matchField(session.name, 4)
    let windows = session.windows.flatMap(window => {
      let match = bestMatch([sessionMatch, matchField(window.name, 3), ...window.panes.flatMap(pane => [matchField(pane.title, 2), matchField(pane.url, 1)]), matchField(`${session.name} ${window.name} ${window.panes.map(pane => `${pane.title} ${pane.url}`).join(' ')}`, 0)])
      return match ? [{ window, match }] : []
    }).sort((a, b) => compareMatches(a.match, b.match))
    let match = bestMatch([sessionMatch, ...windows.map(item => item.match)])
    return match ? [{ session, windows: windows.map(item => item.window), matched: !!sessionMatch, match }] : []
  }).sort((a, b) => compareMatches(a.match, b.match))
  let literal = search(true)
  return (literal.length ? literal : search(false)).map(({ session, windows, matched }) => ({ session, windows, matched }))
}

let pageMatch = (bookmark: Bookmark, query: string) => bestMatch([
  fieldMatch(query, bookmark.title, 3),
  bookmark.url ? fieldMatch(query, bookmark.url, 1) : undefined,
])

let searchBookmarkResults = (bookmarks: Bookmark[], query: string): ScoredBookmark[] => bookmarks.flatMap(bookmark => {
  if (!bookmark.children) {
    let match = pageMatch(bookmark, query)
    return match ? [{ bookmark, match }] : []
  }
  let children = searchBookmarkResults(bookmark.children, query), folderMatch = fieldMatch(query, bookmark.title, 2), match = bestMatch([
    folderMatch,
    children[0]?.match,
  ])
  return match ? [{ bookmark: { ...bookmark, children: folderMatch ? bookmark.children : children.map(result => result.bookmark) }, match }] : []
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
  let terms = query.trim().toLocaleLowerCase().split(/\s+/)
  let ranked = history.map(entry => {
    let title = entry.title.toLocaleLowerCase(), url = entry.url.toLocaleLowerCase()
    let address = url.split(/[?#]/, 1)[0]
    let priority = 0
    if (terms.every(term => address.includes(term))) priority = 4
    else if (terms.every(term => title.includes(term))) priority = 3
    else if (terms.every(term => url.includes(term))) priority = 2
    else if (terms.every(term => title.includes(term) || url.includes(term))) priority = 1
    return { entry, priority }
  })
  let wordMatches = ranked.filter(result => result.priority > 0)
  if (wordMatches.length) return wordMatches.sort((a, b) => b.priority - a.priority).map(result => result.entry)
  return history.filter(entry => fuzzyMatch(query, `${entry.title} ${entry.url}`))
}
