import type { Host as ViewerHost, State as ViewerState } from '../../remote/web/client'
import type { RemoteNativeCredentials } from '../../src/shared/remote-mobile-auth'
import type { RemoteCapabilities } from '../../src/shared/remote-management'
import type { RemoteAttention } from '../../src/shared/remote-attention'
export type State = Omit<ViewerState, 'sessions'> & { sessions: (Omit<ViewerState['sessions'][number], 'windows'> & { revision?: string; defaultProfileId?: string; windows: { panes: (ViewerState['sessions'][number]['windows'][number]['panes'][number] & { profileId?: string; connectionId?: string })[] }[] })[] }
export type Host = ViewerHost & { capabilities?: RemoteCapabilities }
export type { RelayAccount, RelayBilling, LiveView, IncludedBrowser } from '../../src/shared/remote-account'

export type LoginSession = RemoteNativeCredentials
export type Attention = RemoteAttention
export type AttentionTarget = RemoteAttention
export type Selection = { host: string; generation: string; session: string; pane: string }
export type Viewport = { width: number; height: number; generation: number }
export type Viewer = Awaited<ReturnType<typeof import('../../remote/web/client').createViewer>>

export let attentionStatus = (item: Attention) => item.status
export let attentionSelection = (target: AttentionTarget, hosts: Host[]): Selection => {
  if (target.resolved) throw new Error('This request is already resolved.')
  if (target.status === 'cancelled' || target.status === 'expired') throw new Error('This request is no longer active.')
  if (!target.online) throw new Error('The requested browser is offline.')
  let host = hosts.find(item => item.id === target.host && item.generation === target.generation)
  if (!host) throw new Error('The requested browser is no longer available.')
  let session = host.sessions.find(item => item.id === target.session)
  if (!session?.panes.some(item => item.id === target.pane)) throw new Error('The requested page is no longer available.')
  return { host: target.host, generation: target.generation, session: target.session, pane: target.pane }
}
