export type AccountApi = <T>(path: string, body?: unknown) => Promise<T>
export type RelayAccount = { owner: string; email?: string; name?: string }
export type RelayBilling = { enabled: boolean; relay: { active: boolean; monthlyCents: number; currency: string; maxStreams: number; paidUntil?: string; recoveryDeadline?: string; cancelRequested: boolean; status: string } }
export type BoxQuote = { id: string; region: string; regionName: string; memoryGb: number; cores: number; diskGb: number; trafficBytes: number; monthlyCents: number; currency: string }
export type RentedBox = { id: string; name: string; state: string; quote: BoxQuote; paidUntil?: string; recoveryDeadline?: string; deleteAt?: string; cancelRequested: boolean; trafficPaused: boolean; trafficRatio: number; ipv4?: string }
export type LiveView = { connection: string; host: string; generation: string; pane: string }
