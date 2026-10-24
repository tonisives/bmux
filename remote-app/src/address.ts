export let browserAddress = (input: string): string | undefined => {
  let value = input.trim()
  if (!value) return
  if (value === 'about:blank') return value
  try {
    let url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'https://' + value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url.href
  } catch { throw new Error('Enter an HTTP or HTTPS address.') }
}
