(settings) => {
  let parseCount = value => {
    if (value === null || value === undefined) return undefined
    let text = String(value).trim().replace(/,/g, '')
    let match = text.match(/^(-?\d+(?:\.\d+)?)\s*([km])?(?:\s+(?:votes?|points?|comments?|replies))?$/i)
    if (!match) return undefined
    return Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2]?.toLowerCase()] ?? 1)
  }
  let titleKey = title => title.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
  let linkKey = href => {
    try {
      let url = new URL(href, location.href)
      if (!['http:', 'https:'].includes(url.protocol) || /(^|\.)reddit\.com$/.test(url.hostname) || /(^|\.)redd\.it$/.test(url.hostname)) return ''
      url.hash = ''
      for (let key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'msclkid'].includes(key.toLowerCase())) url.searchParams.delete(key)
      return url.href
    } catch { return '' }
  }
  let postId = value => String(value ?? '').match(/(?:t3_|\/comments\/)([a-z0-9]+)/i)?.[1]?.toLowerCase() ?? ''
  let originals = new Map(), timer, closed = false
  let roots = () => {
    let nodes = [...document.querySelectorAll('shreddit-post, [data-testid="search-post"], [data-testid="post-container"], .search-result-link')]
    return nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)))
  }
  let read = node => {
    let permalink = node.getAttribute('permalink') || node.querySelector('a.search-title, a[data-testid="post-title"], a[slot="title"], a[href*="/comments/"]')?.getAttribute('href') || ''
    let title = node.getAttribute('post-title') || node.querySelector('a.search-title, [data-testid="post-title"], [slot="title"], h2, h3')?.textContent || ''
    let countText = node.textContent || ''
    let score = parseCount(node.getAttribute('score') ?? node.getAttribute('data-score') ?? node.querySelector('[data-testid="score"], .search-score, .score.unvoted, faceplate-number[number]')?.getAttribute('number') ?? node.querySelector('[data-testid="score"], .search-score, .score.unvoted')?.textContent ?? countText.match(/(-?[\d,.]+\s*[kKmM]?)\s+(?:votes?|points?)\b/i)?.[1])
    let comments = parseCount(node.getAttribute('comment-count') ?? node.getAttribute('data-comments') ?? node.querySelector('[data-testid="comments-count"], .search-comments, a[data-click-id="comments"]')?.textContent ?? countText.match(/([\d,.]+\s*[kKmM]?)\s+comments?\b/i)?.[1])
    let external = node.getAttribute('content-href') || node.querySelector('a.search-link, a[data-testid="outbound-link"], a[data-click-id="body"]')?.getAttribute('href') || ''
    return { id: postId(node.getAttribute('id') || node.getAttribute('data-fullname')) || postId(permalink), parent: postId(node.getAttribute('crosspost-parent-id') || node.getAttribute('crosspost-parent')), title: titleKey(title), link: linkKey(external), score, comments }
  }
  let restore = node => {
    let value = originals.get(node)
    if (value === undefined) return
    if (value.value) node.style.setProperty('display', value.value, value.priority)
    else node.style.removeProperty('display')
    originals.delete(node)
  }
  let apply = () => {
    if (closed) return
    observer.disconnect()
    let url = new URL(location.href)
    let search = /^(?:\/r\/[^/]+)?\/search\/?$/.test(url.pathname) && (!url.searchParams.has('type') || ['link', 'posts'].includes(url.searchParams.get('type')))
    let nodes = search ? roots() : [], current = new Set(nodes), ids = new Set(), links = new Set(), titles = new Set()
    for (let node of originals.keys()) if (!current.has(node)) restore(node)
    for (let node of nodes) {
      let result = read(node), minimums = []
      if (settings.minScore > 0) minimums.push(result.score === undefined ? undefined : result.score >= settings.minScore)
      if (settings.minComments > 0) minimums.push(result.comments === undefined ? undefined : result.comments >= settings.minComments)
      let qualified = !minimums.length || minimums.includes(undefined) || (settings.rule === 'Require either minimum' ? minimums.some(Boolean) : minimums.every(Boolean))
      let duplicate = (settings.duplicatePosts && result.id && ids.has(result.id)) || (settings.duplicateLinks && ((result.link && links.has(result.link)) || (result.parent && ids.has(result.parent)))) || (settings.duplicateTitles && result.title && titles.has(result.title))
      let hidden = !qualified || duplicate
      if (hidden) {
        if (!originals.has(node)) originals.set(node, { value: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') })
        node.style.setProperty('display', 'none', 'important')
      } else {
        restore(node)
        if (result.id) ids.add(result.id)
        if (settings.duplicateLinks && result.parent) ids.add(result.parent)
        if (result.link) links.add(result.link)
        if (result.title) titles.add(result.title)
      }
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['score', 'data-score', 'comment-count', 'data-comments', 'post-title', 'href', 'content-href', 'crosspost-parent-id', 'crosspost-parent', 'id', 'data-fullname', 'permalink'] })
  }
  let observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 50) })
  apply()
  return () => { closed = true; clearTimeout(timer); observer.disconnect(); for (let node of originals.keys()) restore(node) }
}
