export type AccountApi = <T>(path: string, body?: unknown) => Promise<T>
export type RelayAccount = { owner: string; email?: string; name?: string; entitlement?: {status:string;canStream:boolean;streamLimit:number;activeStreams:number} }
export type RelayBilling = { enabled: boolean; relay: { active: boolean; monthlyCents: number; currency: string; maxStreams: number; includedBrowser?: {panes:1;enabled:boolean}; paidUntil?: string; recoveryDeadline?: string; cancelRequested: boolean; status: string } }
export type BoxQuote = { id: string; region: string; regionName: string; memoryGb: number; cores: number; diskGb: number; trafficBytes: number; monthlyCents: number; currency: string }
export type RentedBox = { id: string; name: string; state: string; quote: BoxQuote; paidUntil?: string; recoveryDeadline?: string; deleteAt?: string; cancelRequested: boolean; trafficPaused: boolean; trafficRatio: number; ipv4?: string; service?: string; checkoutUrl?: string; needsAttention?: boolean }
export type RemoteComputer = { enabled: boolean; connected?: boolean; service?: string; name: string }
export type LiveView = { connection: string; host: string; generation: string; pane: string; viewer?: string; startedAt?: string; session?: string }
export type ReferenceRates = { base: 'USD'; source: 'ECB'; date: string; rates: Record<string, number> }
export type IncludedBrowserState = 'not-created' | 'starting' | 'running' | 'sleeping' | 'waking' | 'suspended' | 'error'
export type IncludedBrowser = {
  entitled: boolean
  state: IncludedBrowserState
  revision: number
  operationId?: string
  target?: { host: string; generation: string; session: string; pane: string }
  idleSleepAt?: string
  retentionUntil?: string
  retryAfterMs?: number
  error?: { code: string; message: string }
}
