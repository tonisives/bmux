(settings, report = () => {}) => {
  let connectionPost = text => /\blet['’]?s\s+#?connect\b(?!\s+(?:to|the|a|an|our|your|my)\b)|\b(?:looking|want|hoping|like)\s+to\s+#?connect\s+with\s+(?:people|folks|others|fellow|founders|builders|developers|creators|indie\s+hackers)\b|\bfollow\s+(?:me\s+)?for\s+(?:a\s+)?follow\b/i.test(text.normalize('NFKC'))
  let originals = new Map(), hits = new Map(), page = location.href, timer, closed = false
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
    if (page !== location.href) { hits.clear(); page = location.href }
    let search = /^\/search\/?$/.test(new URL(location.href).pathname)
    let nodes = search && settings.connectionPosts ? [...document.querySelectorAll('article[data-testid="tweet"]')] : [], current = new Set(nodes)
    if (!search || !settings.connectionPosts) hits.clear()
    for (let node of originals.keys()) if (!current.has(node)) restore(node)
    for (let node of nodes) {
      let text = node.querySelector('[data-testid="tweetText"]')?.textContent || ''
      let href = node.querySelector('a[href*="/status/"]')?.getAttribute('href') || ''
      let url = href ? new URL(href, location.href).href : '', key = url || text
      if (connectionPost(text)) {
        if (!originals.has(node)) originals.set(node, { value: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') })
        node.style.setProperty('display', 'none', 'important')
        hits.set(key, { key, title: text.trim().replace(/\s+/g, ' ').slice(0, 500), url, reasons: ['Connection post'] })
      } else { restore(node); hits.delete(key) }
    }
    report([...hits.values()])
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-testid', 'href'] })
  }
  let observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 50) })
  apply()
  return () => { closed = true; clearTimeout(timer); observer.disconnect(); for (let node of originals.keys()) restore(node); report([]) }
}
