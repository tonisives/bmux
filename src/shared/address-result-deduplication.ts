type AddressEntry = { title: string; url?: string }

let addressKeys = ({ title, url }: AddressEntry): string[] => {
  if (!url) return []
  let parsed: URL
  try { parsed = new URL(url) } catch { return [`url:${url}`] }
  if (!['http:', 'https:'].includes(parsed.protocol)) return [`url:${url}`]
  let host = parsed.hostname.replace(/^www\./, '')
  let maps = /^google\.(?:com(?:\.[a-z]{2})?|[a-z]{2,3})$/.test(host.replace(/^maps\./, '')) && /^\/maps(?:\/|$)/.test(parsed.pathname)
  if (maps) host = host.replace(/^maps\./, '')
  let site = `${host}:${parsed.port}`
  let search = new URLSearchParams(parsed.search)
  for (let key of [...search.keys()]) {
    if (/^(?:utm_.+|gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl)$/i.test(key) || maps && /^(?:entry|g_ep|hl|authuser)$/.test(key)) search.delete(key)
  }
  search.sort()
  let pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  let keys = [`url:${site}${pathname}?${search}${parsed.hash}`]
  let normalizedTitle = title.trim().replace(/\s+/g, ' ').toLowerCase()
  if (normalizedTitle && title !== url) keys.push(`title:${site}:${normalizedTitle}?${search}${maps ? '' : parsed.hash}`)
  if (maps) {
    let placeId = parsed.searchParams.get('query_place_id') || parsed.searchParams.get('cid') || /!1s([^!/?#]+)/.exec(parsed.pathname)?.[1]
    let place = /^\/maps\/place\/([^/]+)/.exec(parsed.pathname)?.[1]
    try { if (placeId) placeId = decodeURIComponent(placeId); if (place) place = decodeURIComponent(place.replace(/\+/g, ' ')) } catch { /* Preserve malformed URL escapes. */ }
    if (placeId) keys.push(`maps-id:${site}:${placeId}`)
    if (place) keys.push(`maps-place:${site}:${place}`)
  }
  return keys
}

export let deduplicateAddressEntries = <T extends AddressEntry>(entries: T[], preferred: AddressEntry[] = []): T[] => {
  let seen = new Set(preferred.flatMap(addressKeys))
  return entries.filter(entry => {
    let keys = addressKeys(entry)
    if (keys.some(key => seen.has(key))) return false
    for (let key of keys) seen.add(key)
    return true
  })
}
