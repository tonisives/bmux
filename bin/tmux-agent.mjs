import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let run = async (command, args) => (await promisify(execFile)(command, args, { timeout: 5000, maxBuffer: 1024 * 1024 })).stdout
let canonical = value => { try { return fs.realpathSync(value) } catch { return value } }
let paneName = title => title.split(' | ').at(-2)?.replace(/^[\u2800-\u28ff]\s*/, '').trim()

export let findAgentPane = (panes, processes, pid, thread) => {
  if (thread) {
    let matches = panes.filter(pane => pane.command === 'codex' && paneName(pane.title) === thread.name && canonical(pane.cwd) === canonical(thread.cwd))
    if (matches.length !== 1) throw new Error('Cannot identify a unique tmux pane for this agent thread; keep its terminal session name visible')
    return matches[0]
  }
  let seen = new Set()
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid)
    let pane = panes.find(pane => Number(pane.panePid) === pid)
    if (pane) return pane
    pid = processes.find(process => process.pid === pid)?.parent ?? 0
  }
  throw new Error('Cannot identify the calling tmux pane from its process ancestry')
}

let readThread = async (id, env) => {
  let directory = env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
  let files = fs.readdirSync(directory).filter(file => /^state_\d+\.sqlite$/.test(file)).map(file => path.join(directory, file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  if (!files.length) throw new Error('Cannot find the agent thread database')
  let { DatabaseSync } = await import('node:sqlite')
  let database = new DatabaseSync(files[0], { readOnly: true })
  try {
    let thread = database.prepare('SELECT id, name, cwd FROM threads WHERE id = ? AND archived = 0').get(id)
    if (!thread?.name) throw new Error('Cannot identify the named terminal session for this agent thread')
    let named = database.prepare('SELECT id, cwd FROM threads WHERE name = ? AND archived = 0').all(thread.name).filter(candidate => canonical(candidate.cwd) === canonical(thread.cwd))
    if (named.length !== 1) throw new Error('The agent terminal session name is ambiguous; give this thread a unique name')
    return thread
  } finally { database.close() }
}

let listPanes = async (socket, execute) => {
  let fields = ['session_id', 'window_id', 'pane_id', 'pane_pid', 'pane_current_command', 'pane_title', 'pane_current_path', 'client_tty', 'session_name', 'window_index']
  let output = await execute('tmux', [...(socket ? ['-S', socket] : []), 'list-panes', '-a', '-F', fields.map(field => `#{${field}}`).join('\t')])
  return output.trimEnd().split('\n').filter(Boolean).map(line => {
    let [sessionId, windowId, paneId, panePid, command, title, cwd, clientTty, sessionName, windowIndex] = line.split('\t')
    return { sessionId, windowId, paneId, panePid, command, title, cwd, clientTty, sessionName, windowIndex }
  })
}

export let resolveTmuxAgent = async ({ env = process.env, pid = process.pid, execute = run, threadForId = readThread } = {}) => {
  let socketPath = env.TMUX?.split(',')[0]
  let panes = await listPanes(socketPath, execute)
  let threadId = env.CODEX_THREAD_ID ?? env.CODEX_SESSION_ID
  let thread = threadId ? await threadForId(threadId, env) : undefined
  let processes = []
  if (!thread) {
    let output = await execute('ps', ['-Ao', 'pid=,ppid='])
    processes = output.trim().split('\n').map(line => { let [pid, parent] = line.trim().split(/\s+/).map(Number); return { pid, parent } })
  }
  let pane = findAgentPane(panes, processes, pid, thread)
  let agentData = { sessionId: pane.sessionId, windowId: pane.windowId, paneId: pane.paneId, ...(pane.clientTty ? { clientTty: pane.clientTty } : {}), ...(pane.sessionName ? { sessionName: pane.sessionName } : {}), ...(pane.windowIndex ? { windowIndex: pane.windowIndex } : {}) }
  let agentOrigin = { type: 'tmux', paneId: pane.paneId, panePid: pane.panePid, ...(socketPath ? { socketPath } : {}), ...(threadId ? { threadId } : {}) }
  return { agentId: threadId ?? pane.paneId, agentType: 'tmux', agentData, agentOrigin }
}

export let identifyTmuxAgent = async (command, env = process.env, resolve = resolveTmuxAgent) => {
  let methods = ['navigate', 'wait', 'dom', 'eval', 'click', 'type', 'key', 'screenshot', 'cdp', 'back', 'forward', 'reload', 'hard-reload', 'scroll', 'history.go-to', 'forms.inspect', 'forms.fill', 'plugin.run', 'automation.acquire', 'new-window', 'new-pane', 'split-window', 'tab.create']
  if (!methods.includes(command.method) || command.args?.agentType && command.args.agentType !== 'tmux' || !env.TMUX) return command
  if (!command.args?.agentType && !env.CODEX_THREAD_ID && !env.CODEX_SESSION_ID) return command
  let context = await resolve({ env })
  let args = command.args ?? {}
  for (let key of ['sessionId', 'windowId', 'paneId']) {
    if (args.agentData?.[key] !== undefined && args.agentData[key] !== context.agentData[key]) throw new Error(`Agent terminal ${key} is ${context.agentData[key]}, but supplied ${args.agentData[key]}; run bmux agent context for the actual tmux IDs`)
  }
  return { ...command, args: { ...args, agentId: args.agentId ?? context.agentId, agentType: 'tmux', agentData: { ...args.agentData, ...context.agentData }, agentOrigin: context.agentOrigin } }
}

export let focusTmuxPane = async (data, origin, { env = process.env, execute = run, threadForId = readThread } = {}) => {
  if (origin?.type !== 'tmux' || origin.paneId !== data.paneId) throw new Error('Agent terminal context is unverified; refresh it with bmux agent context')
  let panes = await listPanes(origin.socketPath, execute)
  if (origin.threadId) {
    let thread = await threadForId(origin.threadId, env)
    return findAgentPane(panes, [], 0, thread).paneId
  }
  let pane = panes.find(pane => pane.paneId === origin.paneId && pane.panePid === origin.panePid)
  if (!pane) throw new Error('The agent terminal pane has changed; refresh its context')
  return pane.paneId
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== 'focus-pane') throw new Error('Use bmux agent context to identify the calling terminal')
    let data = JSON.parse(process.env.BMUX_AGENT_DATA ?? '{}'), origin = JSON.parse(process.env.BMUX_AGENT_ORIGIN ?? 'null')
    process.stdout.write(`${await focusTmuxPane(data, origin)}\n`)
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
