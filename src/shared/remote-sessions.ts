import type { AgentInfo } from './agent-info'
import type { InternalWindow } from './types'
import type { RemoteCapabilities } from './remote-management'

export type RemotePane = Omit<AgentInfo, 'agentOrigin'> & { id: string; title: string; lastActivityAt?: number; agentFields?: Record<string, string> }
export type RemoteWindow = Pick<InternalWindow, 'id' | 'number' | 'name' | 'automaticName' | 'pinned' | 'layout' | 'floating'> & { lastActivityAt?: number; panes: RemotePane[] }
export type RemoteSession = { workspace?: 1; windows?: RemoteWindow[]; canClose?: boolean; canClosePages?: boolean; canPreview?: boolean; id: string; name: string; private?: boolean; lastActivityAt?: number; panes: RemotePane[]; revision?: string; defaultProfileId?: string }
export type RemoteMachine = { name: string; platform: string; arch: string; version?: string; revision?: string }
export type RemoteHost = { id: string; service: string; machine?: RemoteMachine; permission: 'watch' | 'control'; owner?: boolean; sessions: RemoteSession[]; capabilities?: RemoteCapabilities }
export type RemoteSessionListing = { authenticated: boolean; hosts: RemoteHost[] }
