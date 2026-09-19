import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createProfileProxyRelays, createProxyCredentialStore, parseProfileProxy } from '../src/main/profile-proxy'

let close: (() => Promise<void>)[] = []
let listen = (server: net.Server | http.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)))
let stop = (server: net.Server | http.Server) => new Promise<void>(resolve => server.close(() => resolve()))

afterEach(async () => { await Promise.all(close.splice(0).map(operation => operation())) })

let socksServer = async (expected: { username: string; password: string }) => {
  let authenticated = false
  let server = net.createServer(client => {
    let buffer = Buffer.alloc(0), state: 'hello' | 'auth' | 'connect' | 'pipe' = 'hello'
    let consume = () => {
      if (state === 'hello') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return
        buffer = buffer.subarray(2 + buffer[1]); client.write(Buffer.from([5, 2])); state = 'auth'
      }
      if (state === 'auth') {
        if (buffer.length < 2) return
        let usernameLength = buffer[1]
        if (buffer.length < 3 + usernameLength) return
        let passwordLength = buffer[2 + usernameLength]
        if (buffer.length < 3 + usernameLength + passwordLength) return
        let username = buffer.subarray(2, 2 + usernameLength).toString(), password = buffer.subarray(3 + usernameLength, 3 + usernameLength + passwordLength).toString()
        buffer = buffer.subarray(3 + usernameLength + passwordLength)
        authenticated = username === expected.username && password === expected.password
        client.write(Buffer.from([1, authenticated ? 0 : 1]))
        if (!authenticated) { client.end(); return }
        state = 'connect'
      }
      if (state === 'connect') {
        if (buffer.length < 7) return
        let type = buffer[3], offset = 4, host = ''
        if (type === 1) { if (buffer.length < 10) return; host = [...buffer.subarray(offset, offset + 4)].join('.'); offset += 4 }
        else if (type === 3) { let length = buffer[offset]; if (buffer.length < 7 + length) return; host = buffer.subarray(offset + 1, offset + 1 + length).toString(); offset += 1 + length }
        else { client.end(); return }
        let port = buffer.readUInt16BE(offset), remaining = buffer.subarray(offset + 2)
        state = 'pipe'; buffer = Buffer.alloc(0)
        let target = net.createConnection({ host, port }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          if (remaining.length) target.write(remaining)
          client.pipe(target); target.pipe(client)
        })
        target.on('error', () => client.destroy())
      }
    }
    client.on('data', chunk => { if (state !== 'pipe') { buffer = Buffer.concat([buffer, chunk]); consume() } })
  })
  let port = await listen(server)
  close.push(() => stop(server))
  return { port, wasAuthenticated: () => authenticated }
}

let requestThrough = (relay: { host: string; port: number; username: string; password: string }, target: string, authenticated = true) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  let authorization = Buffer.from(`${relay.username}:${relay.password}`).toString('base64')
  let request = http.request({ host: relay.host, port: relay.port, path: target, headers: authenticated ? { 'Proxy-Authorization': `Basic ${authorization}` } : {} }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk }); response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
  })
  request.on('error', reject); request.end()
})

describe('profile proxies', () => {
  it('validates only supported fail-closed endpoints', () => {
    expect(parseProfileProxy({ protocol: 'socks5', host: 'proxy.example', port: 1080, authenticated: true })).toEqual({ protocol: 'socks5', host: 'proxy.example', port: 1080, authenticated: true })
    expect(() => parseProfileProxy({ protocol: 'direct', host: 'proxy.example', port: 1, authenticated: false })).toThrow('protocol')
    expect(() => parseProfileProxy({ protocol: 'http', host: 'user@proxy.example', port: 80, authenticated: false })).toThrow('host')
    expect(() => parseProfileProxy({ protocol: 'http', host: 'proxy.example', port: 0, authenticated: false })).toThrow('port')
  })

  it('encrypts credentials and relays through authenticated SOCKS5 without becoming an open proxy', async () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-proxy-unit-'))
    close.push(async () => { fs.rmSync(directory, { recursive: true, force: true }) })
    let destinationHits = 0
    let destination = http.createServer((_request, response) => { destinationHits++; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ip: '203.0.113.8' })) })
    let destinationPort = await listen(destination); close.push(() => stop(destination))
    let upstream = await socksServer({ username: 'service-user', password: 'service-password' })
    let store = createProxyCredentialStore({ directory, available: () => true, encrypt: text => Buffer.from(text.split('').reverse().join('')), decrypt: data => data.toString().split('').reverse().join('') })
    store.set('profile_default', { username: 'service-user', password: 'service-password' })
    expect(fs.readFileSync(path.join(directory, 'profile_default.bin'), 'utf8')).not.toContain('service-password')
    let relays = createProfileProxyRelays(store); close.push(() => relays.closeAll())
    let relay = await relays.create('profile_default', { protocol: 'socks5', host: '127.0.0.1', port: upstream.port, authenticated: true })
    expect((await requestThrough(relay, `http://127.0.0.1:${destinationPort}/ip`)).body).toContain('203.0.113.8')
    expect(upstream.wasAuthenticated()).toBe(true)
    expect(destinationHits).toBe(1)
    expect((await requestThrough(relay, `http://127.0.0.1:${destinationPort}/ip`, false)).status).toBe(407)
    expect(destinationHits).toBe(1)
  })
})
