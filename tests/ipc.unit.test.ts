import { expect, test } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { controlSocketPath, createPluginSocket, prepareControlSocket, listenSocket, removeSocket } from '../bin/ipc.mjs'

test('Windows control pipes are stable, user-specific and profile-specific', () => {
  let home = 'C:\\Users\\Test User', data = 'C:\\Profiles\\With spaces'
  let pipe = controlSocketPath(data, 'win32', home)
  expect(pipe).toMatch(/^\\\\\.\\pipe\\bmux-control-[a-f0-9]{32}$/)
  expect(controlSocketPath('c:\\profiles\\with SPACES\\', 'win32', home)).toBe(pipe)
  expect(controlSocketPath(data, 'win32', 'C:\\Users\\Other')).not.toBe(pipe)
  expect(controlSocketPath('C:\\Profiles\\Other', 'win32', home)).not.toBe(pipe)
})

test('Unix control socket addresses stay compatible with installed CLIs', () => {
  let data = '/isolated/bmux'
  let expected = `/tmp/bmux-501/${createHash('sha256').update(data).digest('hex').slice(0, 16)}.sock`
  for (let platform of ['darwin', 'linux']) expect(controlSocketPath(data, platform, '/home/test', 501)).toBe(expected)
})

test('native plugin IPC accepts requests and releases its endpoint on close', async () => {
  let endpoint = createPluginSocket(), second = createPluginSocket()
  let server = net.createServer(connection => { connection.on('error', () => undefined); connection.end('ready\n') })
  try {
    expect(second.socketPath).not.toBe(endpoint.socketPath)
    if (process.platform === 'win32') {
      expect(endpoint.socketPath).toMatch(/^\\\\\.\\pipe\\bmux-plugins-/)
      expect(endpoint.directory).toBeUndefined()
    }
    await listenSocket(server, endpoint.socketPath)
    if (process.platform !== 'win32') {
      expect(fs.statSync(endpoint.directory!).mode & 0o777).toBe(0o700)
      expect(fs.statSync(endpoint.socketPath).mode & 0o777).toBe(0o600)
    }
    let response = await new Promise<string>((resolve, reject) => {
      let connection = net.createConnection(endpoint.socketPath), text = ''
      connection.setEncoding('utf8'); connection.on('data', chunk => { text += chunk })
      connection.on('error', reject); connection.on('end', () => resolve(text))
    })
    expect(response).toBe('ready\n')
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await expect(new Promise<void>((resolve, reject) => {
      let connection = net.createConnection(endpoint.socketPath)
      connection.on('error', reject); connection.on('connect', () => { connection.destroy(); resolve() })
    })).rejects.toThrow()
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    for (let item of [endpoint, second]) if (item.directory) fs.rmSync(item.directory, { recursive: true, force: true })
  }
})

test('native control IPC can start again at the same address', async () => {
  let data = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-ipc-test-'))
  let socket = controlSocketPath(data)
  try {
    for (let index = 0; index < 2; index++) {
      prepareControlSocket(socket)
      let server = net.createServer()
      try { await listenSocket(server, socket) }
      finally { if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())) }
      removeSocket(socket)
    }
  } finally { fs.rmSync(data, { recursive: true, force: true }) }
})
