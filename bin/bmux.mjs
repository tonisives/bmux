#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let argv = process.argv.slice(2)
let help = `bmux — bmux control and browser automation

All responses are JSON. IDs returned by list commands are stable across view transfers.

Profiles: profile list | profile create NAME [--background] | profile rename PROFILE NAME
Import:   import-brave [--source BRAVE_USER_DATA_DIRECTORY]
Sessions: new-session -s NAME [--profile PROFILE] | list-sessions | rename-session -t SESSION -n NAME
Clients:  attach-session -t SESSION | list-clients | detach-client -c CLIENT | activate-client -c CLIENT
          switch-client -c CLIENT -t SESSION | select-window -c CLIENT -t WINDOW
Windows:  new-window -t SESSION [-n NAME] [--profile PROFILE] | list-windows -t SESSION
          rename-window -t WINDOW -n NAME | kill-window -t WINDOW [--confirm]
Panes:    split-window -t PANE [-h|-v] [--profile PROFILE] [--url URL]
          list-panes -t WINDOW | select-pane -c CLIENT -t PANE
          move-pane -t PANE --window WINDOW | kill-pane -t PANE [--confirm]
Layouts:  save-layout -t WINDOW -n NAME | list-layouts
          restore-layout -t WINDOW -n NAME --confirm
Tabs:     tab list [--pane PANE] | tab new --pane PANE [URL] | tab select -t TAB | tab close -t TAB
Browser:  navigate -t TAB URL | dom -t TAB [--html] | eval -t TAB EXPRESSION [--file FILE]
          screenshot -t TAB --output FILE [--viewport]
          click -t TAB --selector CSS | type -t TAB --selector CSS --text TEXT
          key -t TAB Enter | wait -t TAB --selector CSS [--state attached|detached|visible|hidden] [--timeout 15000]
          wait -t TAB --expression JS | wait -t TAB --ms 1000
          cdp -t TAB METHOD [JSON_PARAMS] | back -t TAB | forward -t TAB | reload -t TAB
Tools:    dark on|off|system|inherit -t TAB [--scope site|profile|global]
          adblock on|off|inherit -t TAB [--scope site|profile|global]
          update-filters | reload-scripts
Other:    permission list | permission respond ID [--allow]
          settings prefix LETTER | downloads | status | quit
Plugins:  plugin list | plugin run ID/ACTION [-t TAB] [--parameters JSON]
          plugin runs | plugin cancel RUN_ID | plugin reload
          plugin host METHOD [JSON_ARGS | --stdin] (inside plugin scripts)
Advanced: rpc METHOD JSON_ARGS

CLI browser actions never activate macOS windows. attach-session and activate-client do.
Set BMUX_DATA_DIR for an isolated instance, BMUX_APP for a packaged .app.
The previous BROWMUX_DATA_DIR and BROWMUX_APP names remain accepted.
`
if (!argv.length || argv.includes('--help') || argv[0] === 'help') { process.stdout.write(help); process.exit(0) }
let defaultDataDirectory = path.join(os.homedir(), 'Library', 'Application Support', 'bmux')
let legacyDataDirectory = [path.join(os.homedir(), 'Library', 'Application Support', 'Browmux'), path.join(os.homedir(), 'Library', 'Application Support', 'Bmux')].find(directory => fs.existsSync(directory))
let configuredDataDirectory = process.env.BMUX_DATA_DIR ?? process.env.BROWMUX_DATA_DIR
if (!configuredDataDirectory && !fs.existsSync(defaultDataDirectory) && legacyDataDirectory) fs.renameSync(legacyDataDirectory, defaultDataDirectory)
let dataDirectory = configuredDataDirectory ?? defaultDataDirectory
let socketPath = path.join('/tmp', `bmux-${process.getuid?.() ?? 'user'}`, `${createHash('sha256').update(dataDirectory).digest('hex').slice(0, 16)}.sock`)

let parse = () => {
  let command = argv.shift()
  let subcommand = ['plugin', 'profile', 'tab', 'permission', 'settings'].includes(command) ? argv.shift() : null
  let args = {}
  let positional = []
  let boolean = new Set(['confirm', 'background', 'html', 'allow', 'viewport', 'next'])
  let aliases = { t: 'target', s: 'name', n: 'name', c: 'client', o: 'output' }
  while (argv.length) {
    let item = argv.shift()
    if (item === '-h' || item === '-v') { args.axis = item === '-h' ? 'horizontal' : 'vertical'; continue }
    if (item === '--') { positional.push(...argv); break }
    if (!item.startsWith('-')) { positional.push(item); continue }
    let raw = item.replace(/^-+/, '')
    let equal = raw.indexOf('=')
    let key = equal >= 0 ? raw.slice(0, equal) : raw
    key = aliases[key] ?? key
    let value = equal >= 0 ? raw.slice(equal + 1) : boolean.has(key) ? true : argv.shift()
    if (value === undefined) throw new Error(`Missing value for ${item}`)
    args[key] = value
  }
  if (command === 'dark' || command === 'adblock') {
    let value = positional[0] ?? 'toggle'
    if (command === 'dark' && value === 'on') value = 'dark'
    if (command === 'adblock' && ['on', 'off'].includes(value)) value = value === 'on'
    return { method: 'browser.set', args: { tab: args.target ?? args.tab, setting: command === 'dark' ? 'darkMode' : 'adblock', value, scope: args.scope ?? 'site' } }
  }
  if (command === 'update-filters') return { method: 'browser.update-filters' }
  if (command === 'reload-scripts') return { method: 'browser.reload-scripts' }
  if (command === 'rpc') return { method: positional[0], args: JSON.parse(positional[1] ?? '{}') }
  let method = subcommand ? `${command}.${subcommand === 'new' ? 'create' : subcommand}` : command
  let targetKeys = {
    'rename-session': 'session', 'attach-session': 'session', 'switch-client': 'session', 'new-window': 'session', 'list-windows': 'session',
    'select-window': 'window', 'rename-window': 'window', 'kill-window': 'window', 'list-panes': 'window', 'save-layout': 'window', 'restore-layout': 'window', 'resize-pane': 'window',
    'split-window': 'pane', 'select-pane': 'pane', 'move-pane': 'pane', 'kill-pane': 'pane',
  }
  if (args.target !== undefined) { args[targetKeys[method] ?? 'tab'] = args.target; delete args.target }
  if (method === 'profile.create') args.name = positional[0] ?? args.name
  if (method === 'profile.rename') { args.profile = positional[0]; args.name = positional[1] ?? args.name }
  if (method === 'tab.create' || method === 'navigate') args.url = positional[0] ?? args.url
  if (method === 'eval') args.expression = args.file ? fs.readFileSync(path.resolve(args.file), 'utf8') : positional[0] ?? args.expression
  if (method === 'key') args.key = positional[0] ?? args.key
  if (method === 'cdp') { args.method = positional[0]; args.params = JSON.parse(positional[1] ?? '{}') }
  if (method === 'screenshot') { args.output = args.output ? path.resolve(args.output) : undefined; args.fullPage = args.viewport !== true }
  if (method === 'permission.respond') args.id = positional[0] ?? args.id
  if (method === 'settings.prefix') args.key = positional[0] ?? args.key
  if (method === 'plugin.run') { args.action = positional[0]; args.parameters = JSON.parse(args.parameters ?? '{}') }
  if (method === 'plugin.cancel') args.id = positional[0]
  return { method, args }
}

let request = (command, socket = socketPath, timeout = 90_000) => new Promise((resolve, reject) => {
  let connection = net.createConnection(socket)
  let result = ''
  connection.setEncoding('utf8')
  connection.setTimeout(timeout, () => connection.destroy(new Error('bmux command timed out')))
  connection.on('connect', () => connection.write(`${JSON.stringify(command)}\n`))
  connection.on('data', chunk => { result += chunk })
  connection.on('error', reject)
  connection.on('end', () => { try { resolve(JSON.parse(result)) } catch { reject(new Error('Invalid response from bmux')) } })
})
let start = async () => {
  let installed = path.join(os.homedir(), 'workspace', '_tools', 'bmux.app')
  let packaged = process.env.BMUX_APP ?? process.env.BROWMUX_APP ?? (fs.existsSync(installed) ? installed : undefined)
  let executable
  let args = ['--background']
  if (packaged) executable = packaged.endsWith('.app') ? path.join(packaged, 'Contents', 'MacOS', path.basename(packaged, '.app')) : packaged
  else {
    executable = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    args.unshift(root)
    if (!fs.existsSync(path.join(root, 'out/main/index.js'))) throw new Error('Build bmux first: pnpm build')
  }
  if (!fs.existsSync(executable)) throw new Error('Electron not found. Run pnpm install, or set BMUX_APP to bmux.app')
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  let log = fs.openSync(path.join(dataDirectory, 'server.log'), 'a', 0o600)
  let env = { ...process.env, BMUX_BACKGROUND: '1', BMUX_DATA_DIR: dataDirectory }
  delete env.ELECTRON_RUN_AS_NODE
  let child = spawn(executable, args, { detached: true, stdio: ['ignore', log, log], env })
  child.on('error', () => undefined)
  child.unref()
  fs.closeSync(log)
  for (let index = 0; index < 100; index++) {
    try { await request({ method: 'status' }); return } catch { await new Promise(resolve => setTimeout(resolve, 150)) }
  }
  throw new Error(`bmux did not start. Inspect ${path.join(dataDirectory, 'server.log')}`)
}
try {
  if (argv[0] === 'plugin' && argv[1] === 'host') {
    let socket = process.env.BMUX_PLUGIN_SOCKET, token = process.env.BMUX_PLUGIN_TOKEN, runId = process.env.BMUX_PLUGIN_RUN_ID
    if (!socket || !token || !runId) throw new Error('Plugin host is available only inside an invocation')
    let args = JSON.parse(argv[3] === '--stdin' ? fs.readFileSync(0, 'utf8') : argv[3] ?? '{}')
    let response = await request({ runId, token, method: argv[2], args }, socket, 3_610_000)
    process.stdout.write(JSON.stringify(response) + '\n')
    process.exit(response.ok ? 0 : 1)
  }
  let command = parse()
  let response
  try { response = await request(command) } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
    if (command.method === 'quit') { process.stdout.write(`${JSON.stringify({ ok: true, result: { running: false } })}\n`); process.exit(0) }
    await start()
    response = await request(command)
  }
  process.stdout.write(`${JSON.stringify(response)}\n`)
  if (!response.ok) process.exitCode = 1
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`)
  process.exitCode = 1
}
