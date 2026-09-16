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

export let parseSearchSuggestions = (payload: unknown, query: string) => {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return []
  let normalized = query.trim().toLowerCase(), seen = new Set<string>()
  return payload[1].filter((value): value is string => {
    if (typeof value !== 'string') return false
    let suggestion = value.trim(), key = suggestion.toLowerCase()
    if (!suggestion || key === normalized || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)
}
