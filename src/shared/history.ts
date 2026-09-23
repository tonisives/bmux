import type { HistoryEntry } from './types'

export let recordHistory = (history: HistoryEntry[], url: string, title: string, visitedAt: number): HistoryEntry[] => {
  let previous = history.find(entry => entry.url === url)
  let savedTitle = title.trim() || url
  if (savedTitle === url && previous?.title && previous.title !== url) savedTitle = previous.title
  return [{ url, title: savedTitle, visitedAt }, ...history.filter(entry => entry.url !== url)].slice(0, 1000)
}
