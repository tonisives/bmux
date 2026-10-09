import type { HistoryEntry } from './types'

export type InlineUrlCompletion = { value: string; url: string }

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
