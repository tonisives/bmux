import type { Cookie, Cookies } from 'electron'

type CookieStore = Pick<Cookies, 'get' | 'set' | 'flushStore'>
let cookieKey = (cookie: Cookie) => JSON.stringify([cookie.domain, cookie.path, cookie.name])

export let copyConnectionCookies = async (source: CookieStore, target: CookieStore) => {
  let [cookies, existing] = await Promise.all([source.get({}), target.get({})])
  let present = new Set(existing.map(cookieKey)), rejected = 0
  for (let cookie of cookies) {
    let { name, value, domain, path, secure, httpOnly, expirationDate, sameSite, hostOnly } = cookie
    if (!domain || present.has(cookieKey(cookie))) continue
    // Secure controls transmission, not the scheme that originally set a cookie.
    // Restore through HTTPS so overlapping Secure and non-Secure cookies can coexist.
    let url = `https://${domain.replace(/^\./, '')}${path || '/'}`
    try {
      await target.set({ url, name, value, ...(hostOnly ? {} : { domain }), path, secure, httpOnly, expirationDate, sameSite })
      present.add(cookieKey(cookie))
    } catch { rejected++ }
  }
  await target.flushStore()
  return rejected
}
