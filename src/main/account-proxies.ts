import net from 'node:net'
import { WebSocket, createWebSocketStream } from 'ws'
import type { ProfileProxy } from '../shared/types'

export let includedProxies = [
  { id: 'home', name: 'HomeProxy', protocol: 'socks5' },
  { id: 'us-west', name: 'US West', protocol: 'http' },
  { id: 'us-east', name: 'US East', protocol: 'http' },
  { id: 'singapore', name: 'Singapore', protocol: 'http' },
  { id: 'finland', name: 'Finland', protocol: 'socks5' },
  { id: 'estonia', name: 'Estonia', protocol: 'http' },
] as const
export let includedProxy = (route: string): ProfileProxy => {
  let entry = includedProxies.find(item => item.id === route)
  if (!entry) throw new Error('ACCOUNT_PROXY_UNAVAILABLE')
  return { protocol: entry.protocol, host: `${route}.proxy.bmux.invalid`, port: 443, authenticated: false, route }
}
export let createAccountProxies = () => {
  let identity: { origin: string; token: string; host: string; generation: string } | undefined
  let servers = new Map<string, Promise<net.Server>>(), connections = new Set<net.Socket>()
  let close = () => { identity = undefined; for (let socket of connections) socket.destroy(); for (let server of servers.values()) void server.then(server => server.close()); servers.clear() }
  return {
    configure: (value: NonNullable<typeof identity>) => { for (let socket of connections) socket.destroy(); identity = value }, disconnect: () => { identity = undefined; for (let socket of connections) socket.destroy() }, close,
    resolve: async (proxy: ProfileProxy): Promise<ProfileProxy> => {
      if (!proxy.route) return proxy
      if (JSON.stringify(proxy) !== JSON.stringify(includedProxy(proxy.route)) || !identity) throw new Error('ACCOUNT_PROXY_UNAVAILABLE')
      let server = servers.get(proxy.route)
      if (!server) {
        let route = proxy.route
        server = new Promise((resolve, reject) => {
          let listener = net.createServer(socket => {
            let current = identity
            if (!current) { socket.destroy(); return }
            connections.add(socket); socket.pause()
            let url = new URL('/api/v1/proxy/' + route, current.origin)
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
            url.searchParams.set('host', current.host); url.searchParams.set('generation', current.generation)
            let ws = new WebSocket(url, { headers: { Authorization: `Bearer ${current.token}` }, maxPayload: 65536, handshakeTimeout: 10000 })
            let stream = createWebSocketStream(ws, { highWaterMark: 32768 })
            stream.on('error', () => socket.destroy()); ws.on('error', () => socket.destroy())
            socket.on('error', () => stream.destroy()); socket.on('close', () => { connections.delete(socket); stream.destroy(); ws.terminate() })
            stream.on('close', () => socket.destroy())
            ws.on('open', () => { if (identity !== current) { socket.destroy(); return }; socket.pipe(stream).pipe(socket); socket.resume() })
            socket.setTimeout(300000, () => socket.destroy())
          })
          listener.once('error', reject)
          listener.listen(0, '127.0.0.1', () => resolve(listener))
        })
        servers.set(route, server)
      }
      let address = (await server).address()
      if (!address || typeof address === 'string') throw new Error('ACCOUNT_PROXY_UNAVAILABLE')
      return { protocol: proxy.protocol, host: '127.0.0.1', port: address.port, authenticated: false }
    },
  }
}
