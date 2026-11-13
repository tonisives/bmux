import { expect, test } from 'vitest'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { controlSocketPath, listenSocket, prepareControlSocket, removeSocket } from '../bin/ipc.mjs'

type Invoke = (args: string[], agentId?: string, environment?: NodeJS.ProcessEnv) => Promise<any>
let withControlServer = async (check: (invoke: Invoke, directory: string) => Promise<void>) => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-cli-agent-'))
  let socket = controlSocketPath(directory)
  let server = net.createServer(connection => {
    let input = ''
    connection.setEncoding('utf8')
    connection.on('data', chunk => {
      input += chunk
      if (input.includes('\n')) connection.end(JSON.stringify({ ok: true, result: JSON.parse(input) }))
    })
  })
  let invoke: Invoke = async (args: string[], agentId?: string, environment: NodeJS.ProcessEnv = {}) => {
    let { stdout } = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args], { env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined, CODEX_THREAD_ID: undefined, CODEX_SESSION_ID: undefined, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: agentId, BMUX_AGENT_NAME: undefined, BMUX_AGENT_PURPOSE: undefined, BMUX_AGENT_CONTEXT: undefined, BMUX_AGENT_TYPE: undefined, BMUX_AGENT_DATA: undefined, ...environment }, timeout: 5000 })
    return JSON.parse(stdout).result
  }
  try {
    prepareControlSocket(socket)
    await listenSocket(server, socket)
    await check(invoke, directory)
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    removeSocket(socket)
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test('browser, creation and RPC commands retain explicit targets', () => withControlServer(async (invoke) => {
  expect(await invoke(['--agent-id', '%42', 'navigate', '-t', '%3', 'http://fixture.test/'])).toEqual({ method: 'navigate', args: { pane: '%3', url: 'http://fixture.test/', agentId: '%42' } })
  expect(await invoke(['dom', '-t', '%3', '--agent-id', '%42', '--agent-name=Research agent', '--agent-purpose', 'Compare browser features'])).toMatchObject({ args: { pane: '%3', agentId: '%42', agentName: 'Research agent', agentPurpose: 'Compare browser features' } })
  expect(await invoke(['dom', '-t', '%3', '--agent-context', 'x'])).toMatchObject({ args: { agentContext: 'x' } })
  expect(await invoke(['dom', '-t', '%3'], undefined, { BMUX_AGENT_CONTEXT: 'tiktok' })).toMatchObject({ args: { agentContext: 'tiktok' } })
  expect(await invoke(['dom', '-t', '%3', '--agent-type', 'tmux', '--agent-data', '{"sessionId":"$1","windowId":"@2","paneId":"%42"}'])).toMatchObject({ args: { agentType: 'tmux', agentData: { sessionId: '$1', windowId: '@2', paneId: '%42' } } })
  expect(await invoke(['lock-viewport', '-t', 'work:3', '--width', '1512', '--height', '900'])).toEqual({ method: 'lock-viewport', args: { window: 'work:3', width: '1512', height: '900' } })
  expect(await invoke(['new-window', '-t', 'work', '--agent-id=worker'])).toEqual({ method: 'new-window', args: { session: 'work', agentId: 'worker' } })
  expect(await invoke(['kill-session', '-t', 'work notes', '--confirm'])).toEqual({ method: 'kill-session', args: { session: 'work notes', confirm: true } })
  expect(await invoke(['kill-session', '--session', '$2'])).toEqual({ method: 'kill-session', args: { session: '$2' } })
  expect(await invoke(['rpc', 'dom', '{"pane":"%3"}', '--agent-id', '%42'])).toEqual({ method: 'dom', args: { pane: '%3', agentId: '%42' } })
}))

test('movement aliases retain their client, target and agent', () => withControlServer(async (invoke) => {
  expect(await invoke(['movew', '-c', 'client', '-t', '2', '--agent-id', '%42'])).toMatchObject({ method: 'command-line', args: { client: 'client', agentId: '%42' } })
  for (let command of ['switchc', 'switch-client']) expect(await invoke([command, '-c', 'client', '-Zt%3', '--agent-id', '%42'])).toEqual({ method: 'command-line', args: { client: 'client', line: `\"${command}\" \"-c\" \"client\" \"-Zt%3\"`, agentId: '%42' } })
}))

test('--no-lock removes inherited agent data and preserves literal flags', () => withControlServer(async (invoke) => {
  expect(await invoke(['--no-lock', 'eval', '-t', '%3', 'document.title'], '%42', { BMUX_AGENT_DATA: 'invalid JSON', TMUX: '/missing/tmux', CODEX_THREAD_ID: 'inherited-thread' })).toEqual({ method: 'eval', args: { pane: '%3', expression: 'document.title' }, inputSource: 'human' })
  expect(await invoke(['rpc', 'type', '{"pane":"%3","text":"hello","agentId":"raw-agent","_automationLease":"stale"}', '--no-lock'], '%42')).toEqual({ method: 'type', args: { pane: '%3', text: 'hello' }, inputSource: 'human' })
  expect(await invoke(['type', '-t', '%3', '--text', '--no-lock'])).toEqual({ method: 'type', args: { pane: '%3', text: '--no-lock' } })
  expect(await invoke(['eval', '-t', '%3', '--', '--no-lock'])).toEqual({ method: 'eval', args: { pane: '%3', expression: '--no-lock' } })
}))

test('explicit and RPC identifiers override inherited identifiers', () => withControlServer(async (invoke) => {
  expect(await invoke(['dom', '-t', '%3'], '%42')).toEqual({ method: 'dom', args: { pane: '%3', agentId: '%42' } })
  expect(await invoke(['dom', '-t', '%3', '--agent-id', 'explicit'], '%42')).toMatchObject({ args: { agentId: 'explicit' } })
  expect(await invoke(['eval', '-t', '%3', '--', '--agent-id'])).toEqual({ method: 'eval', args: { pane: '%3', expression: '--agent-id' } })
  expect(await invoke(['type', '-t', '%3', '--selector', '#input', '--text', '--agent-id'])).toEqual({ method: 'type', args: { pane: '%3', selector: '#input', text: '--agent-id' } })
  expect(await invoke(['rpc', 'dom', '{"pane":"%3","agentId":"rpc-agent"}'], '%42')).toMatchObject({ args: { agentId: 'rpc-agent' } })
}))

test('incomplete and multiline agent identifiers are rejected', () => withControlServer(async (invoke) => {
  for (let args of [['dom', '-t', '%3', '--agent-id'], ['dom', '-t', '%3', '--agent-id='], ['dom', '-t', '%3', '--agent-id', 'bad\nidentifier']]) await expect(invoke(args)).rejects.toThrow()
}))

test.skipIf(process.platform === 'win32')('recorded agent terminal context follows its original pane', () => withControlServer(async (invoke, directory) => {
  let database = new DatabaseSync(path.join(directory, 'state_5.sqlite'))
  database.exec('CREATE TABLE threads (id TEXT, name TEXT, cwd TEXT, archived INTEGER)')
  database.prepare('INSERT INTO threads VALUES (?, ?, ?, 0)').run('publishing-thread', 'Publishing videos', path.join(directory, 'movies'))
  database.close()
  let commands = path.join(directory, 'commands')
  await fs.mkdir(commands)
  let panes = `$5\t@52\t%70\t64428\tcodex\tPublishing videos | movies\t${directory}\t/dev/ttys000\tpublishing\t7\n$5\t@59\t%76\t54617\tcodex\tHacking | deployments\t/k3s\t/dev/ttys000\tpublishing\t11\n`
  await fs.writeFile(path.join(commands, 'tmux'), `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(panes)})\n`, { mode: 0o755 })
  let env = { TMUX: '/tmp/fixture-tmux,123,5', TMUX_PANE: '%76', CODEX_THREAD_ID: 'publishing-thread', CODEX_HOME: directory, PATH: `${commands}${path.delimiter}${process.env.PATH}` }
  let actual = await invoke(['dom', '-t', '%31'], undefined, env)
  expect(actual).toMatchObject({ method: 'dom', args: { pane: '%31', agentId: 'publishing-thread', agentType: 'tmux', agentData: { sessionId: '$5', sessionName: 'publishing', windowId: '@52', windowIndex: '7', paneId: '%70' }, agentOrigin: { paneId: '%70', panePid: '64428', threadId: 'publishing-thread' } } })
  let context = await invoke(['agent', 'context'], undefined, env)
  expect(context.agentData.paneId).toBe('%70')
  await expect(invoke(['dom', '-t', '%31', '--agent-type', 'tmux', '--agent-data', '{"paneId":"%76"}'], undefined, env)).rejects.toThrow('The recorded agent terminal pane has changed')
}))
