import type { Command } from '../shared/types'
import { validateAgentInfo } from '../shared/agent-info'

export let socketAgent = (command: Command, agentId: string | undefined): Command => {
  if (!agentId || command.args?.agentId !== undefined) return command
  validateAgentInfo({ agentId })
  return { ...command, args: { ...command.args, agentId } }
}
