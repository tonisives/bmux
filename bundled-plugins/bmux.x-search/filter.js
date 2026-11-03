(settings) => {
  let connectionPost = text => /\blet['’]?s\s+#?connect\b(?!\s+(?:to|the|a|an|our|your|my)\b)|\b(?:looking|want|hoping|like)\s+to\s+#?connect\s+with\s+(?:people|folks|others|fellow|founders|builders|developers|creators|indie\s+hackers)\b|\bfollow\s+(?:me\s+)?for\s+(?:a\s+)?follow\b/i.test(text.normalize('NFKC'))
  let originals = new Map(), timer, closed = false
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
    let search = /^\/search\/?$/.test(new URL(location.href).pathname)
    let nodes = search && settings.connectionPosts ? [...document.querySelectorAll('article[data-testid="tweet"]')] : [], current = new Set(nodes)
    for (let node of originals.keys()) if (!current.has(node)) restore(node)
    for (let node of nodes) {
      let text = node.querySelector('[data-testid="tweetText"]')?.textContent || ''
      if (connectionPost(text)) {
        if (!originals.has(node)) originals.set(node, { value: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') })
        node.style.setProperty('display', 'none', 'important')
      } else restore(node)
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-testid'] })
  }
  let observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 50) })
  apply()
  return () => { closed = true; clearTimeout(timer); observer.disconnect(); for (let node of originals.keys()) restore(node) }
}
