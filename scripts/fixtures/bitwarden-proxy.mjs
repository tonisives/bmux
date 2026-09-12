import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

export let createProxy = (host, port, destination, tls) => {
  let target = new URL(destination)
  let handle = (request, response) => {
    let upstream = http.request(target, { path: request.url, method: request.method, headers: { ...request.headers, host: target.host } }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response)
    })
    upstream.on('error', () => { response.writeHead(502); response.end() })
    request.pipe(upstream)
  }
  let server = tls ? https.createServer(tls, handle) : http.createServer(handle)
  let sockets = new Set()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.closeFixture = () => { for (let socket of sockets) socket.destroy(); server.close() }
  server.on('upgrade', (request, socket, head) => {
    let upstream = net.connect(Number(target.port) || 80, target.hostname, () => {
      let headers = { ...request.headers, host: target.host }
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
      if (head.length) upstream.write(head)
      upstream.pipe(socket); socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  })
  server.listen(port, host)
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) createProxy(process.argv[2], Number(process.argv[3]), process.argv[4])
