import type { BookmarkParameters } from './types'

export let queryParameters = (url: string): [string, string][] => {
  try { return [...new URL(url).searchParams].filter(([key], index, entries) => entries.findIndex(([other]) => other === key) === index) }
  catch { return [] }
}

let xSearch = (url: URL) => ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) && url.pathname === '/search'
let xMinimum = /(min_faves|min_replies):(\d+)(?=\s|$)/g

export let editableBookmarkParameters = (url: string, settings?: BookmarkParameters): [string, string][] => {
  let ordinary = queryParameters(url)
  let parsed: URL
  try { parsed = new URL(url) } catch { return ordinary }
  if (!xSearch(parsed) || settings?.hidden.includes('q')) return ordinary
  let query = settings?.values.q ?? parsed.searchParams.get('q') ?? ''
  let minimums = [...query.matchAll(xMinimum)].map(([, key, value]) => [`x:${key}`, value] as [string, string])
  return [...ordinary, ...minimums.filter(([key], index) => minimums.findIndex(([other]) => other === key) === index)]
}

export let parameterizedBookmarkUrl = (url: string, settings?: BookmarkParameters): string => {
  if (!settings) return url
  let parsed = new URL(url)
  for (let key of settings.hidden) parsed.searchParams.delete(key)
  for (let [key, value] of Object.entries(settings.values)) if (!key.startsWith('x:') && !settings.hidden.includes(key) && parsed.searchParams.has(key)) parsed.searchParams.set(key, value)
  if (xSearch(parsed) && parsed.searchParams.has('q')) {
    let query = parsed.searchParams.get('q')!
    let removed = false
    for (let key of ['min_faves', 'min_replies']) {
      let virtualKey = `x:${key}`
      let expression = new RegExp(`(?:^|\\s)${key}:\\d+(?=\\s|$)`, 'g')
      if (settings.hidden.includes(virtualKey)) { query = query.replace(expression, ''); removed = true }
      else if (settings.values[virtualKey] !== undefined) query = query.replace(expression, match => match.replace(/\d+$/, settings.values[virtualKey]))
    }
    parsed.searchParams.set('q', removed ? query.replace(/\s+/g, ' ').trim() : query)
  }
  return parsed.href
}
