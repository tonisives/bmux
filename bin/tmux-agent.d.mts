import type { AgentInfo, AgentOrigin } from '../src/shared/agent-info'

export type AgentPane = { sessionId: string; windowId: string; paneId: string; panePid: string; command: string; title: string; cwd: string; clientTty?: string; sessionName?: string; windowIndex?: string }
export type AgentThread = { id: string; name: string; cwd: string }
type Options = { env?: NodeJS.ProcessEnv; pid?: number; execute?: (command: string, args: string[]) => Promise<string>; threadForId?: (id: string, env: NodeJS.ProcessEnv) => Promise<AgentThread> }
type Context = AgentInfo & { agentId: string; agentType: string; agentData: Record<string, string>; agentOrigin: AgentOrigin }
export let findAgentPane: (panes: AgentPane[], processes: { pid: number; parent: number }[], pid: number, thread?: AgentThread) => AgentPane
export let resolveTmuxAgent: (options?: Options) => Promise<Context>
export let identifyTmuxAgent: <T extends { method: string; args?: AgentInfo & Record<string, unknown> }>(command: T, env?: NodeJS.ProcessEnv, resolve?: (options: Options) => Promise<Context>) => Promise<T>
export let focusTmuxPane: (data: Record<string, string>, origin?: AgentOrigin, options?: Options) => Promise<string>
