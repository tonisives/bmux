import type { HistoryEntry } from './types'

let historyIdentity = (url: string): string | undefined => {
  let parsed: URL
  try { parsed = new URL(url) } catch { return url }
  let host = parsed.hostname.replace(/^(?:www|maps)\./, '')
  if (!/^google\.(?:com(?:\.[a-z]{2})?|[a-z]{2,3})$/.test(host) || !/^\/maps(?:\/|$)/.test(parsed.pathname)) return url

  let place = /^\/maps\/place\/([^/]+)/.exec(parsed.pathname)?.[1]
  if (place) return `${parsed.protocol}//${host}/maps/place/${place}`
  let placeId = parsed.searchParams.get('query_place_id') || parsed.searchParams.get('cid')
  if (placeId) return `${parsed.protocol}//${host}/maps/place-id/${placeId}`
  return undefined
}

export let compactHistory = (history: HistoryEntry[]): HistoryEntry[] => {
  let seen = new Map<string, HistoryEntry>()
  for (let entry of history) {
    let identity = historyIdentity(entry.url)
    if (!identity) continue
    let previous = seen.get(identity)
    if (!previous) seen.set(identity, { ...entry })
    else if (previous.title === previous.url && entry.title !== entry.url) previous.title = entry.title
  }
  return [...seen.values()].slice(0, 1000)
}

export let recordHistory = (history: HistoryEntry[], url: string, title: string, visitedAt: number): HistoryEntry[] => {
  let identity = historyIdentity(url)
  if (!identity) return history
  let previous = history.find(entry => historyIdentity(entry.url) === identity)
  let savedTitle = title.trim() || url
  if (savedTitle === url && previous?.title && previous.title !== url) savedTitle = previous.title
  return [{ url, title: savedTitle, visitedAt }, ...history.filter(entry => historyIdentity(entry.url) !== identity)].slice(0, 1000)
}
