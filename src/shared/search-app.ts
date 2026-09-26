export let SEARCH_APPS = ['google', 'duckduckgo', 'bing', 'brave'] as const
export type SearchApp = typeof SEARCH_APPS[number]
export type SearchApps = { normal: SearchApp; private: SearchApp }
export let DEFAULT_SEARCH_APPS: SearchApps = { normal: 'google', private: 'google' }

export let searchUrl = (query: string, app: SearchApp = 'google') => {
  let encoded = encodeURIComponent(query)
  if (app === 'duckduckgo') return `https://duckduckgo.com/?q=${encoded}`
  if (app === 'bing') return `https://www.bing.com/search?q=${encoded}`
  if (app === 'brave') return `https://search.brave.com/search?q=${encoded}`
  return `https://www.google.com/search?q=${encoded}`
}
