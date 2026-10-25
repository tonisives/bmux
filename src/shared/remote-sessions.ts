import type { AgentInfo } from './agent-info'
import type { InternalWindow } from './types'

export type RemotePane = Omit<AgentInfo, 'agentOrigin'> & { id: string; title: string; lastActivityAt?: number; agentFields?: Record<string, string> }
export type RemoteWindow = Pick<InternalWindow, 'id' | 'number' | 'name' | 'automaticName' | 'pinned' | 'layout' | 'floating'> & { lastActivityAt?: number; panes: RemotePane[] }
export type RemoteSession = { workspace?: 1; windows?: RemoteWindow[]; canClose?: boolean; canPreview?: boolean; id: string; name: string; private?: boolean; lastActivityAt?: number; panes: RemotePane[] }
export type RemoteHost = { id: string; service: string; permission: 'watch' | 'control'; sessions: RemoteSession[] }
export type RemoteSessionListing = { authenticated: boolean; hosts: RemoteHost[] }
