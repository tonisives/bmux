import type { HistoryEntry } from './types'
import { searchUrl } from './search-app'
import type { SearchApp } from './search-app'

export type InlineUrlCompletion = { value: string; url: string }

type AddressSuggestion = { kind: string; value: string; title: string; detail: string }

export let withAddressSearch = <T extends AddressSuggestion>(entries: T[], query: string, app: SearchApp, preferAddress: boolean): (T | AddressSuggestion)[] => {
  if (!query.trim()) return entries
  let name = app === 'duckduckgo' ? 'DuckDuckGo' : app[0].toUpperCase() + app.slice(1)
  let search = { kind: 'search', value: searchUrl(query, app), title: `Search ${name} for ${query}`, detail: '' }
  let position = preferAddress ? Math.min(3, entries.length) : 0
  return [...entries.slice(0, position), search, ...entries.slice(position)]
}

export let addressDestination = (input: string, urls: string[]): InlineUrlCompletion | undefined => {
  if (!input || /\s/.test(input)) return
  let explicit = /^(?:[a-z][a-z\d+.-]*:\/\/|file:|about:blank$)/i.test(input)
  let local = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.test(input)
  let parsed: URL
  try { parsed = new URL(explicit ? input : `${local ? 'http' : 'https'}://${input}`) } catch { return }
  let domain = !parsed.username && !parsed.password && /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d-]{2,}\.?$/i.test(parsed.hostname)
  if (explicit || local || domain) return { value: input, url: parsed.href }
  // A short domain name must match a saved host, never a title or path.
  for (let url of urls) {
    try {
      let saved = new URL(url), host = saved.hostname.replace(/^www\./, '')
      if (['http:', 'https:'].includes(saved.protocol) && !saved.username && !saved.password && host.split('.')[0] === input.toLowerCase()) {
        return { value: host, url: saved.origin + '/' }
      }
    } catch { /* Ignore invalid saved URLs. */ }
  }
}

export let urlDestinationTitle = (url: string, entries: { title: string; url?: string }[]): string | undefined => {
  let pageUrl = (value: string) => value.split(/[?#]/)[0].replace(/\/$/, '')
  return entries.find(entry => entry.title.trim() && entry.url && pageUrl(entry.url) === pageUrl(url))?.title
}

let urlVariants = (url: string) => {
  let withoutScheme = url.replace(/^https?:\/\//i, '')
  return [...new Set([url, withoutScheme, withoutScheme.replace(/^www\./i, '')])]
}

export let inlineUrlCompletion = (input: string, url: string): InlineUrlCompletion | undefined => {
  if (!input || /\s/.test(input)) return undefined
  let candidate = urlVariants(url).find(value => value.length > input.length && value.toLowerCase().startsWith(input.toLowerCase()))
  return candidate ? { value: input + candidate.slice(input.length), url } : undefined
}

export let baseUrlCompletion = (input: string, url: string): InlineUrlCompletion | undefined => {
  if (!input || /[\s?#]/.test(input)) return undefined
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
  let candidate = urlVariants(url).find(value => value.toLowerCase().startsWith(input.toLowerCase()))
  if (!candidate) return undefined
  let hostEnd = candidate.match(/^(?:https?:\/\/)?[^/?#]+/i)![0].length
  let nextSeparator = candidate.slice(input.length).search(/[/?#]/)
  let end = hostEnd >= input.length ? hostEnd : input.endsWith('/') ? input.length : nextSeparator < 0 ? candidate.length : input.length + nextSeparator
  let value = input + candidate.slice(input.length, end)
  // Complete only the host or path segment being typed, without saved page state.
  let destination = new URL(/^https?:\/\//i.test(value) ? value : `${parsed.protocol}//${value}`)
  return { value, url: destination.href }
}

export let addressUrlCompletion = (input: string, urls: string[]): InlineUrlCompletion | undefined => {
  let destination = addressDestination(input, urls)
  if (!destination) return
  if (destination.value !== input) return destination
  let host = new URL(destination.url).host
  for (let url of urls) {
    try { if (new URL(url).host !== host) continue } catch { continue }
    let completion = baseUrlCompletion(input, url) ?? inlineUrlCompletion(input, url)
    if (completion) return completion
  }
}

export let searchUrlDestination = (input: string, urls: string[]): InlineUrlCompletion | undefined => {
  let terms = input.trim().toLowerCase().split(/\s+/)
  if (!input.trim() || /[/?#:]/.test(input)) return undefined
  let best: { completion: InlineUrlCompletion; depth: number } | undefined
  for (let url of urls) {
    let parsed: URL
    try { parsed = new URL(url) } catch { continue }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue
    let segments = parsed.pathname.split('/').filter(Boolean)
    for (let depth = 0; depth <= segments.length; depth++) {
      let pathname = segments.slice(0, depth).join('/')
      let address = `${parsed.host}/${pathname}`
      try { address = decodeURIComponent(address) } catch { /* Keep malformed escapes searchable as written. */ }
      if (!terms.every(term => address.toLowerCase().includes(term))) continue
      let destination = `${parsed.origin}/${pathname}`
      // Promote the shortest matching destination, without inferring from titles or query data.
      if (destination !== parsed.href && (!best || depth < best.depth)) {
        best = { completion: { value: address.replace(/^www\./i, '').replace(/\/$/, ''), url: destination }, depth }
      }
      break
    }
  }
  return best?.completion
}

export let prioritizeInlineHistory = (matches: HistoryEntry[], history: HistoryEntry[], inlineUrl?: string): HistoryEntry[] => {
  if (!inlineUrl) return matches
  let inlineEntry = history.find(entry => entry.url === inlineUrl)
  return inlineEntry ? [inlineEntry, ...matches.filter(entry => entry.url !== inlineUrl)] : matches
}
