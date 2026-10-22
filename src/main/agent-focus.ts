import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentInfo, AgentSettings } from '../shared/agent-info'

export let focusAgent = async (actor: AgentInfo, settings: AgentSettings) => {
  let definition = actor.agentType ? settings.definitions[actor.agentType] : undefined
  if (!definition?.focusCommand) throw new Error('Configure a focus command for this agent type in automation.agents.definitions')
  let env: NodeJS.ProcessEnv = { ...process.env }
  for (let key of Object.keys(env)) if (key.startsWith('BMUX_AGENT_')) delete env[key]
  Object.assign(env, { BMUX_AGENT_ID: actor.agentId ?? '', BMUX_AGENT_TYPE: actor.agentType ?? '', BMUX_AGENT_DATA: JSON.stringify(actor.agentData ?? {}) })
  // Data travels through environment variables, never shell source interpolation.
  for (let [key, field] of Object.entries(definition.fields)) {
    let name = field.type && field.type !== 'text' ? `${field.type.toUpperCase()}_ID` : `FIELD_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`
    env[`BMUX_AGENT_${name}`] = actor.agentData?.[key] ?? ''
  }
  let executable = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : process.env.SHELL ?? '/bin/sh'
  let args = process.platform === 'win32' ? ['/d', '/s', '/c', definition.focusCommand] : ['-lc', definition.focusCommand]
  await promisify(execFile)(executable, args, { env, timeout: 10_000, maxBuffer: 64 * 1024 }).catch(() => { throw new Error('Agent focus command failed') })
  return { focused: true }
}
