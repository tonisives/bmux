import type { BookmarkParameters } from './types'

export let queryParameters = (url: string): [string, string][] => {
  try { return [...new URL(url).searchParams].filter(([key], index, entries) => entries.findIndex(([other]) => other === key) === index) }
  catch { return [] }
}

export let parameterizedBookmarkUrl = (url: string, settings?: BookmarkParameters): string => {
  if (!settings) return url
  let parsed = new URL(url)
  for (let key of settings.hidden) parsed.searchParams.delete(key)
  for (let [key, value] of Object.entries(settings.values)) if (!settings.hidden.includes(key) && parsed.searchParams.has(key)) parsed.searchParams.set(key, value)
  return parsed.href
}
