import type { AgentInfo } from './agent-info'

export type RemotePane = Omit<AgentInfo, 'agentOrigin'> & { id: string; title: string; lastActivityAt?: number; agentFields?: Record<string, string> }
export type RemoteSession = { canClose?: boolean; canClosePages?: boolean; canPreview?: boolean; id: string; name: string; private?: boolean; lastActivityAt?: number; panes: RemotePane[] }
export type RemoteMachine = { name: string; platform: string; arch: string; version?: string; revision?: string }
export type RemoteHost = { id: string; service: string; machine?: RemoteMachine; permission: 'watch' | 'control'; sessions: RemoteSession[] }
export type RemoteSessionListing = { authenticated: boolean; hosts: RemoteHost[] }
