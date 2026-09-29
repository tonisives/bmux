import type { HistoryEntry } from './types'

let historyIdentity = (url: string): string | undefined => {
  let parsed: URL
  try { parsed = new URL(url) } catch { return url }
  let host = parsed.hostname.replace(/^(?:www|maps)\./, '')
  if (!/^google\.(?:com(?:\.[a-z]{2})?|[a-z]{2,3})$/.test(host)) return url

  if (parsed.pathname === '/search' && parsed.searchParams.has('q')) {
    let search = new URLSearchParams()
    for (let key of ['q', 'udm', 'tbm', 'tbs']) {
      let value = parsed.searchParams.get(key)
      if (value) search.set(key, value)
    }
    return `${parsed.protocol}//${host}/search?${search}`
  }
  if (!/^\/maps(?:\/|$)/.test(parsed.pathname)) return url

  let place = /^\/maps\/place\/([^/]+)/.exec(parsed.pathname)?.[1]
  if (place) return `${parsed.protocol}//${host}/maps/place/${place}`
  let placeId = parsed.searchParams.get('query_place_id') || parsed.searchParams.get('cid')
  if (placeId) return `${parsed.protocol}//${host}/maps/place-id/${placeId}`
  return undefined
}

let pagePath = (url: string): string | undefined => {
  let parsed: URL
  try { parsed = new URL(url) } catch { return }
  if (!['http:', 'https:'].includes(parsed.protocol)) return
  return `${parsed.hostname.replace(/^www\./, '')}:${parsed.port}${parsed.pathname.replace(/\/+$/, '') || '/'}`
}

let sameHistoryPage = (entry: HistoryEntry, url: string, title: string, identity: string): boolean => {
  if (historyIdentity(entry.url) === identity) return true
  if (!title || title === url || !entry.title || entry.title === entry.url || entry.title !== title) return false
  let path = pagePath(url)
  return path !== undefined && pagePath(entry.url) === path
}

export let compactHistory = (history: HistoryEntry[]): HistoryEntry[] => {
  let compacted: HistoryEntry[] = []
  for (let entry of history) {
    let identity = historyIdentity(entry.url)
    if (!identity) continue
    let previous = compacted.find(saved => sameHistoryPage(saved, entry.url, entry.title, identity))
    if (!previous) compacted.push({ ...entry })
    else if (previous.title === previous.url && entry.title !== entry.url) previous.title = entry.title
  }
  return compacted.slice(0, 1000)
}

export let recordHistory = (history: HistoryEntry[], url: string, title: string, visitedAt: number): HistoryEntry[] => {
  let identity = historyIdentity(url)
  if (!identity) return history
  let previous = history.find(entry => sameHistoryPage(entry, url, title, identity))
  let savedTitle = title.trim() || url
  if (savedTitle === url && previous?.title && previous.title !== url) savedTitle = previous.title
  return [{ url, title: savedTitle, visitedAt }, ...history.filter(entry => !sameHistoryPage(entry, url, savedTitle, identity))].slice(0, 1000)
}
