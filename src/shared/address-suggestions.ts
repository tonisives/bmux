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
