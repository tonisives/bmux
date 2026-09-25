import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runtimeDataDirectory } from '../bin/runtime-paths.mjs'

let directory = runtimeDataDirectory(process.platform, os.homedir(), process.env)
let socket = path.join('/tmp', `bmux-${process.getuid?.() ?? 'user'}`, `${createHash('sha256').update(directory).digest('hex').slice(0, 16)}.sock`)
let connection = net.createConnection(socket)
let response = ''
connection.setTimeout(3000, () => { connection.destroy(); process.exitCode = 1 })
connection.on('error', () => { process.exitCode = 1 })
connection.on('connect', () => connection.write('{"method":"status"}\n'))
connection.on('data', chunk => { response += chunk; if (response.length > 16_777_216) { connection.destroy(); process.exitCode = 1 } })
connection.on('end', () => { try { if (!JSON.parse(response).ok) process.exitCode = 1 } catch { process.exitCode = 1 } })
