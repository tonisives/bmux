import type { HistoryEntry } from './types'

export type InlineUrlCompletion = { value: string; url: string }

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
  let end = input.endsWith('/') ? input.length : hostEnd >= input.length ? hostEnd : nextSeparator < 0 ? candidate.length : input.length + nextSeparator
  let value = input + candidate.slice(input.length, end)
  // Complete only the host or path segment being typed, without saved page state.
  let destination = new URL(/^https?:\/\//i.test(value) ? value : `${parsed.protocol}//${value}`)
  return { value, url: destination.href }
}

export let prioritizeInlineHistory = (matches: HistoryEntry[], history: HistoryEntry[], inlineUrl?: string): HistoryEntry[] => {
  if (!inlineUrl) return matches
  let inlineEntry = history.find(entry => entry.url === inlineUrl)
  return inlineEntry ? [inlineEntry, ...matches.filter(entry => entry.url !== inlineUrl)] : matches
}
