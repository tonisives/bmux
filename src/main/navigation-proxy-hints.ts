import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { NavigationProxyHint } from '../shared/types'

type Lookup = (hostname: string) => Promise<{ address: string }[]>
let localAddresses = new BlockList()
for (let [address, prefix] of [['0.0.0.0', 32], ['127.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]] as const) localAddresses.addSubnet(address, prefix, 'ipv4')
for (let [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) localAddresses.addSubnet(address, prefix, 'ipv6')
let localAddress = (address: string) => { let family = isIP(address); return !!family && localAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6') }
let connectionFailure = /\b(?:ERR_(?:PROXY_[A-Z_]+|TUNNEL_CONNECTION_FAILED|SOCKS_[A-Z_]+|CONNECTION_[A-Z_]+|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|TIMED_OUT|EMPTY_RESPONSE|HTTP2_PROTOCOL_ERROR|QUIC_PROTOCOL_ERROR|INTERNET_DISCONNECTED|NETWORK_[A-Z_]+)|PROXY_UNAVAILABLE)\b/

export let createNavigationProxyHints = (notify: () => void, resolve: Lookup = hostname => lookup(hostname, { all: true })) => {
  let hints: Record<string, NavigationProxyHint> = {}
  let clear = (paneId: string) => { delete hints[paneId] }
  let record = (paneId: string, error: string, url: string, proxied: boolean, required = false) => {
    let target: URL
    try { target = new URL(url) } catch { clear(paneId); return }
    if (!proxied || !connectionFailure.test(error) || !/^https?:$/.test(target.protocol)) { clear(paneId); return }
    let hostname = target.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (hints[paneId]?.hostname === hostname && hints[paneId]?.required === required) return
    let hint = { hostname, local: localAddress(hostname) || /(^|\.)localhost$/i.test(hostname), required }
    hints[paneId] = hint
    if (hint.local || isIP(hostname)) return
    // Use the browser host's resolver, including hosts-file entries, without delaying navigation.
    void resolve(hostname).then(addresses => {
      if (hints[paneId] !== hint || !addresses.length || !addresses.every(item => localAddress(item.address))) return
      hints[paneId] = { ...hint, local: true }
      notify()
    }).catch(() => undefined)
  }
  return { hints, record, clear }
}
