import { app, ipcMain, Menu } from 'electron'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRuntime } from './runtime'
import type { Command } from '../shared/types'

let defaultDataDirectory = path.join(os.homedir(), 'Library', 'Application Support', 'bmux')
let legacyDataDirectory = [path.join(os.homedir(), 'Library', 'Application Support', 'Browmux'), path.join(os.homedir(), 'Library', 'Application Support', 'Bmux')].find(directory => fs.existsSync(directory))
let configuredDataDirectory = process.env.BMUX_DATA_DIR ?? process.env.BROWMUX_DATA_DIR
if (!configuredDataDirectory && !fs.existsSync(defaultDataDirectory) && legacyDataDirectory) fs.renameSync(legacyDataDirectory, defaultDataDirectory)
let dataDirectory = configuredDataDirectory ?? defaultDataDirectory
let background = process.env.BMUX_BACKGROUND === '1' || process.env.BROWMUX_BACKGROUND === '1' || process.argv.includes('--background')
app.setName('bmux')
app.setPath('userData', dataDirectory)
fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
let socketDirectory = path.join('/tmp', `bmux-${process.getuid?.() ?? 'user'}`)
let socketPath = path.join(socketDirectory, `${createHash('sha256').update(dataDirectory).digest('hex').slice(0, 16)}.sock`)
let runtime: ReturnType<typeof createRuntime> | undefined
let server: net.Server | undefined

let readyForLinks = false
let pendingLinks: string[] = []
let linkQueue = Promise.resolve()
let receiveLink = (url: string) => {
  try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return } catch { return }
  if (!readyForLinks) { pendingLinks.push(url); return }
  linkQueue = linkQueue.then(async () => {
    let browser = runtime!
    let client = browser.model.clients.find(item => item.id === browser.state().focusedClientId) ?? browser.model.clients[0]
    if (!client) client = await browser.createClient(browser.model.sessions[0].id)
    await browser.execute({ method: 'tab.create', args: { pane: client.paneId, client: client.id, url } })
    await browser.execute({ method: 'activate-client', args: { client: client.id } })
  }).catch(() => { console.error('Could not open external browser link') })
}
app.on('open-url', (event, url) => { event.preventDefault(); receiveLink(url) })

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    let links = argv.filter(value => /^https?:\/\//i.test(value))
    if (links.length) { links.forEach(receiveLink); return }
    if (!argv.includes('--background') && runtime) void runtime.createClient(runtime.model.sessions[0].id)
  })
  app.on('window-all-closed', () => { /* Clients detach; the server owns browser lifetime. */ })
  app.on('activate', () => { if (runtime && !runtime.model.clients.length) void runtime.createClient(runtime.model.sessions[0].id) })
  app.on('before-quit', () => {
    runtime?.shutdown()
    server?.close()
    try { fs.unlinkSync(socketPath) } catch { /* Already removed. */ }
  })
  void app.whenReady().then(async () => {
    if (background) app.dock?.hide()
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'bmux', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'New Client', accelerator: 'CmdOrCtrl+Shift+N', click: () => { if (runtime) void runtime.createClient(runtime.model.sessions[0].id) } }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]))
    runtime = createRuntime(dataDirectory)
    ipcMain.handle('state', event => {
      let clientId = runtime!.sourceClient(event.sender.id)
      if (!clientId) throw new Error('Untrusted renderer')
      return runtime!.state(clientId)
    })
    ipcMain.handle('command', (event, command: Command) => {
      let clientId = runtime!.sourceClient(event.sender.id)
      if (!clientId) throw new Error('Untrusted renderer')
      return runtime!.execute(command, clientId)
    })
    ipcMain.on('bounds', (event, bounds) => runtime!.setBounds(event.sender.id, bounds))
    await runtime.start(background)
    readyForLinks = true
    pendingLinks.splice(0).forEach(receiveLink)
    fs.mkdirSync(socketDirectory, { recursive: true, mode: 0o700 })
    if (fs.statSync(socketDirectory).uid !== process.getuid?.()) throw new Error('Socket directory belongs to another user')
    fs.chmodSync(socketDirectory, 0o700)
    try { fs.unlinkSync(socketPath) } catch { /* First launch. */ }
    server = net.createServer(connection => {
      let buffer = ''
      connection.setEncoding('utf8')
      connection.on('error', () => undefined)
      connection.on('data', chunk => {
        buffer += chunk
        if (buffer.length > 1_048_576) { connection.end(`${JSON.stringify({ ok: false, error: 'Request exceeds 1MB' })}\n`); return }
        let newline = buffer.indexOf('\n')
        if (newline < 0) return
        let request = buffer.slice(0, newline)
        buffer = ''
        void (async () => {
          try {
            let command = JSON.parse(request) as Command
            if (!command || typeof command.method !== 'string' || (command.args !== undefined && (typeof command.args !== 'object' || command.args === null || Array.isArray(command.args)))) throw new Error('Invalid request')
            let result = await runtime!.execute(command)
            connection.end(`${JSON.stringify({ ok: true, result })}\n`)
          } catch (error) {
            connection.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
          }
        })()
      })
    })
    server.listen(socketPath, () => { fs.chmodSync(socketPath, 0o600) })
    server.on('error', error => { console.error(`bmux control socket: ${error.message}`); app.quit() })
  }).catch(error => { console.error(`bmux startup failed: ${error instanceof Error ? error.message : String(error)}`); app.exit(1) })
}
