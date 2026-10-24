export type RemoteCapabilities = {
  management?: 1
  sessionCreate?: 1
  pageCreate?: 1
  profiles?: 1
  proxy?: 1
  streamQuality?: 1
  verifiedAttention?: 1
}

export type RemoteProxy = { protocol: 'http' | 'https' | 'socks5'; host: string; port: number; authenticated: boolean }
export type RemoteProxyCredentials = { action: 'keep' | 'clear' } | { action: 'replace'; username: string; password: string }
export type RemoteProfile = {
  id: string
  name: string
  isDefault: boolean
  revision: string
  defaultConnectionId: string
  proxyLocked: boolean
  credentialStorageAvailable: boolean
  connections: { id: string; proxy?: RemoteProxy; credentialsPresent: boolean }[]
}
export type RemoteTarget = { session: string; pane: string; revision: string }
export type RemoteManagementParams = {
  'profiles.list': Record<string, never>
  'sessions.create': { profileId?: string; name?: string; url?: string }
  'pages.create': { session: string; generation: number; expectedRevision: string; profileId?: string; url?: string }
  'profiles.proxy.set': { profileId: string; expectedRevision: string; proxy: RemoteProxy | null; credentials: RemoteProxyCredentials }
  'profiles.proxy.test': { profileId: string; connectionId?: string; expectedRevision: string; draft?: { proxy: RemoteProxy; credentials: RemoteProxyCredentials } }
  'pages.reopen': { session: string; pane: string; generation: number; expectedRevision: string; profileId: string; connectionId: string }
}
export type RemoteManagementResults = {
  'profiles.list': { profiles: RemoteProfile[] }
  'sessions.create': RemoteTarget
  'pages.create': RemoteTarget
  'profiles.proxy.set': { profile: RemoteProfile; connectionId: string }
  'profiles.proxy.test': { ip: string; region?: string; checkedAt: number; revision: string; connectionId?: string }
  'pages.reopen': RemoteTarget
}
export type RemoteRPCRequest = { [K in keyof RemoteManagementParams]: { type: 'rpc'; request: string; method: K; params: RemoteManagementParams[K] } }[keyof RemoteManagementParams]
export type RemoteRPCResult<K extends keyof RemoteManagementResults = keyof RemoteManagementResults> = { type: 'result'; request: string; result: RemoteManagementResults[K] }
export type RemoteOperationError = { type: 'error'; request?: string; code: string; error: string; retryable?: boolean }

export type RemoteQualityMode = 'auto' | 'data-saver' | 'quality'
export type RemoteNetwork = 'cellular' | 'wifi' | 'unknown'
export type RemoteQualityRequest = { type: 'quality'; request: string; mode: RemoteQualityMode; network: RemoteNetwork }
export type RemoteStreamQuality = { mode: RemoteQualityMode; network: RemoteNetwork; effective: 'data-saver' | 'quality'; maxFps: number; maxWidth: number; maxHeight: number; maxBitrate: number }
export let remoteStreamQuality = (mode: RemoteQualityMode = 'auto', network: RemoteNetwork = 'unknown'): RemoteStreamQuality => {
  let effective = mode === 'auto' ? network === 'wifi' ? 'quality' : 'data-saver' : mode
  return { mode, network, effective, ...(effective === 'data-saver' ? { maxFps: 5, maxWidth: 960, maxHeight: 540, maxBitrate: 400_000 } : { maxFps: 10, maxWidth: 1920, maxHeight: 1080, maxBitrate: 2_500_000 }) }
}
