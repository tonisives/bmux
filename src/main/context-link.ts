let HTTP_PROTOCOLS = new Set(['http:', 'https:'])

export let xPostLink = (pageUrl: string, links: string[]) => {
  let page: URL
  try { page = new URL(pageUrl) } catch { return '' }
  if (!['x.com', 'www.x.com'].includes(page.hostname)) return ''
  for (let link of links) {
    try {
      let url = new URL(link, page)
      if (['x.com', 'www.x.com'].includes(url.hostname) && /^\/(?:i\/web\/status|[^/]+\/status)\/\d+\/?$/.test(url.pathname)) return url.href
    } catch { /* Ignore malformed page-provided URLs. */ }
  }
  return ''
}

let pageResolver = (x: number, y: number) => {
  let target = document.elementFromPoint(x, y)
  if (!target) return { pageUrl: location.href, custom: '', links: [] as string[] }
  let detail = { target, url: '' }
  document.dispatchEvent(new CustomEvent('bmux:resolve-context-link', { detail }))
  let custom = detail.url || target.closest('[data-bmux-link]')?.getAttribute('data-bmux-link') || ''
  let article = target.closest('article')
  let timestamp = article?.querySelector('a[href] time')?.closest('a[href]')
  let links = [timestamp?.getAttribute('href') ?? '', ...Array.from(article?.querySelectorAll('a[href*="/status/"]') ?? []).map(link => link.getAttribute('href') ?? '')]
  return { pageUrl: location.href, custom, links }
}

export let contextLinkExpression = (x: number, y: number) => `(${pageResolver.toString()})(${JSON.stringify(x)}, ${JSON.stringify(y)})`

export let resolvedContextLink = (value: unknown) => {
  if (!value || typeof value !== 'object') return ''
  let result = value as { pageUrl?: unknown; custom?: unknown; links?: unknown }
  if (typeof result.pageUrl !== 'string') return ''
  if (typeof result.custom === 'string' && result.custom) {
    try {
      let url = new URL(result.custom, result.pageUrl)
      if (HTTP_PROTOCOLS.has(url.protocol)) return url.href
    } catch { /* Fall through to a built-in resolver. */ }
  }
  return xPostLink(result.pageUrl, Array.isArray(result.links) ? result.links.filter((link): link is string => typeof link === 'string') : [])
}
