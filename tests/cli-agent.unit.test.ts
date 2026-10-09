import { expect, test } from 'vitest'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { controlSocketPath, listenSocket, prepareControlSocket, removeSocket } from '../bin/ipc.mjs'

test('agent identifiers reach browser, creation, RPC and movement commands without changing their targets', async () => {
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
  let invoke = async (args: string[], agentId?: string) => {
    let { stdout } = await promisify(execFile)(process.execPath, ['bin/bmux.mjs', ...args], { env: { ...process.env, BMUX_DATA_DIR: directory, BMUX_AGENT_ID: agentId }, timeout: 5000 })
    return JSON.parse(stdout).result
  }
  try {
    prepareControlSocket(socket)
    await listenSocket(server, socket)
    expect(await invoke(['--agent-id', '%42', 'navigate', '-t', '%3', 'http://fixture.test/'])).toEqual({ method: 'navigate', args: { pane: '%3', url: 'http://fixture.test/', agentId: '%42' } })
    expect(await invoke(['new-window', '-t', 'work', '--agent-id=worker'])).toEqual({ method: 'new-window', args: { session: 'work', agentId: 'worker' } })
    expect(await invoke(['rpc', 'dom', '{"pane":"%3"}', '--agent-id', '%42'])).toEqual({ method: 'dom', args: { pane: '%3', agentId: '%42' } })
    expect(await invoke(['movew', '-c', 'client', '-t', '2', '--agent-id', '%42'])).toMatchObject({ method: 'command-line', args: { client: 'client', agentId: '%42' } })
    expect(await invoke(['dom', '-t', '%3'], '%42')).toEqual({ method: 'dom', args: { pane: '%3', agentId: '%42' } })
    expect(await invoke(['dom', '-t', '%3', '--agent-id', 'explicit'], '%42')).toMatchObject({ args: { agentId: 'explicit' } })
    expect(await invoke(['eval', '-t', '%3', '--', '--agent-id'])).toEqual({ method: 'eval', args: { pane: '%3', expression: '--agent-id' } })
    expect(await invoke(['type', '-t', '%3', '--selector', '#input', '--text', '--agent-id'])).toEqual({ method: 'type', args: { pane: '%3', selector: '#input', text: '--agent-id' } })
    expect(await invoke(['rpc', 'dom', '{"pane":"%3","agentId":"rpc-agent"}'], '%42')).toMatchObject({ args: { agentId: 'rpc-agent' } })
    for (let args of [['dom', '-t', '%3', '--agent-id'], ['dom', '-t', '%3', '--agent-id='], ['dom', '-t', '%3', '--agent-id', 'bad\nidentifier']]) await expect(invoke(args)).rejects.toThrow()
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    removeSocket(socket)
    await fs.rm(directory, { recursive: true, force: true })
  }
})
