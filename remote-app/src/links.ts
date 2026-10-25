export let attentionIdFromUrl = (value: string): string | undefined => {
  try {
    let url = new URL(value)
    if (url.protocol === 'https:' && url.origin !== 'https://remote.bmux.cc') return
    if (!['https:', 'bmux-remote:'].includes(url.protocol)) return
    let path = url.protocol === 'bmux-remote:' && url.host ? '/' + url.host + url.pathname : url.pathname
    let match = /^\/attention\/([A-Za-z0-9_-]{1,128})\/?$/.exec(path)
    return match?.[1]
  } catch { return }
}
export let attentionIdFromData = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') return
  let value = (data as Record<string, unknown>).attentionId
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined
}
