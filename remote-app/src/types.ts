import type { Host, State } from '../../remote/web/client'
export type { Host, State }
export type { RelayAccount, RelayBilling, LiveView } from '../../src/shared/remote-account'

export type LoginSession = { owner: string; accessToken: string; expiresAt: string; refreshToken?: string; refreshExpiresAt?: string }
export type AttentionStatus = 'pending' | 'claimed' | 'verifying' | 'resolved' | 'failed' | 'expired'
export type Attention = { id: string; reason: string; created_at: string; resolved_at?: string | null; status?: AttentionStatus }
export type AttentionTarget = { id: string; reason: string; host: string; generation: string; session: string; pane: string; episode: string; resolved: boolean; online: boolean }
export type Selection = { host: string; generation: string; session: string; pane: string }
export type Quality = 'auto' | 'data-saver'
export type Viewport = { width: number; height: number; generation: number }
export type Viewer = Awaited<ReturnType<typeof import('../../remote/web/client').createViewer>>

export let attentionStatus = (item: Attention): AttentionStatus => item.status ?? (item.resolved_at ? 'resolved' : 'pending')
export let attentionSelection = (target: AttentionTarget, hosts: Host[]): Selection => {
  if (target.resolved) throw new Error('This request is already resolved.')
  if (!target.online) throw new Error('The requested browser is offline.')
  let host = hosts.find(item => item.id === target.host && item.generation === target.generation)
  if (!host) throw new Error('The requested browser is no longer available.')
  let session = host.sessions.find(item => item.id === target.session)
  if (!session?.panes.some(item => item.id === target.pane)) throw new Error('The requested page is no longer available.')
  return { host: target.host, generation: target.generation, session: target.session, pane: target.pane }
}
