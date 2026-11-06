import { createProxyRecovery } from './proxy-recovery'

type FailedPage = { pane: string; connection: string; url: string }
let transportFailure = /\bERR_(?:TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED|SOCKS_CONNECTION_FAILED|CONNECTION_(?:CLOSED|RESET|REFUSED|TIMED_OUT)|INTERNET_DISCONNECTED|NETWORK_CHANGED)\b/

export let createProxyNavigationRecovery = (check: (connection: string) => Promise<boolean>, load: (pane: string, url: string) => Promise<unknown>) => {
  let pages = new Map<string, FailedPage>(), retrying = new Set<string>()
  let forConnection = (connection: string) => [...pages.values()].filter(page => page.connection === connection)
  let recovery = createProxyRecovery(async connection => {
    if (!forConnection(connection).length) return true
    if (!await check(connection)) return false
    for (let page of forConnection(connection)) {
      if (pages.get(page.pane) !== page) continue
      retrying.add(connection)
      try { await load(page.pane, page.url).catch(() => undefined) }
      finally { retrying.delete(connection) }
    }
    return !forConnection(connection).length
  }, 30000)
  let clear = (pane: string) => {
    let page = pages.get(pane)
    pages.delete(pane)
    if (page && !retrying.has(page.connection) && !forConnection(page.connection).length) recovery.cancel(page.connection)
  }
  return {
    record: (pane: string, connection: string, url: string, error: string, proxied: boolean) => {
      if (!proxied || !/^https?:\/\//.test(url) || !transportFailure.test(error)) { clear(pane); return }
      let previous = pages.get(pane)
      if (previous?.connection === connection && previous.url === url) return
      clear(pane)
      pages.set(pane, { pane, connection, url })
      recovery.schedule(connection)
    },
    clear,
    retry: () => { for (let connection of new Set([...pages.values()].map(page => page.connection))) void recovery.retry(connection) },
    close: () => { pages.clear(); recovery.close() },
  }
}
