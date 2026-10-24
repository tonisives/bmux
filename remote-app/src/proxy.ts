import type { RemoteProxy, RemoteProxyCredentials } from '../../src/shared/remote-management'

export let proxyDraft = (protocol: RemoteProxy['protocol'], host: string, port: string, action: RemoteProxyCredentials['action'], savedCredentials: boolean, username: string, password: string): { proxy: RemoteProxy; credentials: RemoteProxyCredentials } => {
  let name = host.trim(), number = Number(port)
  if (!name || /[\s/@?#]/.test(name)) throw new Error('Enter a proxy host without a URL or credentials.')
  if (!/^\d+$/.test(port) || !Number.isInteger(number) || number < 1 || number > 65535) throw new Error('Enter a port from 1 to 65535.')
  let address: URL
  try { address = new URL('http://' + (name.includes(':') && !name.startsWith('[') ? '[' + name + ']' : name) + ':' + number) }
  catch { throw new Error('Enter a valid proxy host.') }
  if (action === 'replace' && (!username || !password)) throw new Error('Enter the proxy username and password.')
  let authenticated = action === 'replace' || action === 'keep' && savedCredentials
  let credentials: RemoteProxyCredentials = action === 'replace' ? { action, username, password } : { action }
  return { proxy: { protocol, host: address.hostname.replace(/^\[|\]$/g, ''), port: number, authenticated }, credentials }
}
