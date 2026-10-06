import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export let controlSocketPath = (dataDirectory, platform = process.platform, home = os.homedir(), uid = process.getuid?.()) => {
  if (platform === 'win32') {
    let identity = `${path.win32.resolve(home).toLowerCase()}\0${path.win32.resolve(dataDirectory).toLowerCase()}`
    return `\\\\.\\pipe\\bmux-control-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
  }
  return path.posix.join('/tmp', `bmux-${uid ?? 'user'}`, `${createHash('sha256').update(dataDirectory).digest('hex').slice(0, 16)}.sock`)
}

export let createPluginSocket = () => {
  if (process.platform === 'win32') return { socketPath: `\\\\.\\pipe\\bmux-plugins-${randomUUID()}`, directory: undefined }
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-plugins-'))
  fs.chmodSync(directory, 0o700)
  return { socketPath: path.join(directory, 'host.sock'), directory }
}

export let prepareControlSocket = socketPath => {
  if (process.platform === 'win32') return
  let directory = path.dirname(socketPath)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (fs.statSync(directory).uid !== process.getuid?.()) throw new Error('Socket directory belongs to another user')
  fs.chmodSync(directory, 0o700)
  removeSocket(socketPath)
}

export let removeSocket = socketPath => {
  if (process.platform === 'win32') return
  try { fs.unlinkSync(socketPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

export let listenSocket = (server, socketPath) => new Promise((resolve, reject) => {
  let failed = error => { server.removeListener('listening', listening); reject(error) }
  let listening = () => {
    server.removeListener('error', failed)
    try {
      if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600)
      resolve()
    } catch (error) { server.close(); reject(error) }
  }
  server.once('error', failed)
  server.once('listening', listening)
  server.listen(socketPath)
})
