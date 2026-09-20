import type { BookmarkParameters } from './types'

export let queryParameters = (url: string): [string, string][] => {
  try { return [...new URL(url).searchParams].filter(([key], index, entries) => entries.findIndex(([other]) => other === key) === index) }
  catch { return [] }
}

let xSearch = (url: URL) => ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) && url.pathname === '/search'
let xMinimum = /(min_faves|min_replies):(\d+)(?=\s|$)/g
let xSince = /(?:^|\s)since:(\d{4}-\d{2}-\d{2})(?=\s|$)/g
let DAY = 24 * 60 * 60 * 1000

let dateOnly = (date: Date) => date.toISOString().slice(0, 10)
let ageFromSince = (query: string, now: Date) => {
  let match = [...query.matchAll(xSince)].at(-1)
  if (!match) return '0'
  let since = new Date(`${match[1]}T00:00:00Z`)
  return Number.isNaN(since.getTime()) ? '0' : String(Math.max(0, Math.ceil((new Date(`${dateOnly(now)}T00:00:00Z`).getTime() - since.getTime()) / DAY)))
}

export let editableBookmarkParameters = (url: string, settings?: BookmarkParameters, now = new Date()): [string, string][] => {
  let ordinary = queryParameters(url)
  let parsed: URL
  try { parsed = new URL(url) } catch { return ordinary }
  if (!xSearch(parsed) || settings?.hidden.includes('q')) return ordinary
  let query = settings?.values.q ?? parsed.searchParams.get('q') ?? ''
  let minimums = [...query.matchAll(xMinimum)].map(([, key, value]) => [`x:${key}`, value] as [string, string])
  return [...ordinary, ...minimums.filter(([key], index) => minimums.findIndex(([other]) => other === key) === index), ['x:max_age_days', ageFromSince(query, now)]]
}

export let bookmarkParameterPresentation = (url: string, key: string) => {
  let parsed: URL
  try { parsed = new URL(url) } catch { return { label: key } }
  if (!xSearch(parsed)) return { label: key }
  if (key === 'f') return { label: 'Results', help: 'X result type; live means Latest' }
  if (key === 'x:min_faves') return { label: 'Min likes' }
  if (key === 'x:min_replies') return { label: 'Min replies' }
  if (key === 'x:max_age_days') return { label: 'Post age (days)', help: '0 means any age' }
  return { label: key }
}

export let parameterizedBookmarkUrl = (url: string, settings?: BookmarkParameters, now = new Date()): string => {
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
    if (settings.hidden.includes('x:max_age_days')) { query = query.replace(xSince, ''); removed = true }
    else if (settings.values['x:max_age_days'] !== undefined) {
      query = query.replace(xSince, '')
      let age = Math.max(0, Math.floor(Number(settings.values['x:max_age_days']) || 0))
      if (age) query = `${query.trim()} since:${dateOnly(new Date(now.getTime() - age * DAY))}`
      removed = true
    }
    parsed.searchParams.set('q', removed ? query.replace(/\s+/g, ' ').trim() : query)
  }
  return parsed.href
}
