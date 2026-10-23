import type { AgentInfo } from './agent-info'

export type RemotePane = Omit<AgentInfo, 'agentOrigin'> & { id: string; title: string; agentFields?: Record<string, string> }
export type RemoteSession = { canClose?: boolean; id: string; name: string; private?: boolean; lastActivityAt?: number; panes: RemotePane[] }
export type RemoteHost = { id: string; service: string; permission: 'watch' | 'control'; sessions: RemoteSession[] }
export type RemoteSessionListing = { authenticated: boolean; hosts: RemoteHost[] }
