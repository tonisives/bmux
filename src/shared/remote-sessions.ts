import type { AgentInfo } from './agent-info'
import type { RemoteCapabilities } from './remote-management'

export type RemotePane = Omit<AgentInfo, 'agentOrigin'> & { id: string; title: string; agentFields?: Record<string, string> }
export type RemoteSession = { canClose?: boolean; canPreview?: boolean; id: string; name: string; private?: boolean; lastActivityAt?: number; panes: RemotePane[]; revision?: string; defaultProfileId?: string }
export type RemoteHost = { id: string; service: string; permission: 'watch' | 'control'; sessions: RemoteSession[]; capabilities?: RemoteCapabilities }
export type RemoteSessionListing = { authenticated: boolean; hosts: RemoteHost[] }
