export type RemotePreviewSettings = { updates: 'missing' | 'open' | 'manual'; saveLocally: boolean }
export type RemotePreviewRequest = 'cache' | 'missing' | 'refresh'
export let DEFAULT_REMOTE_PREVIEWS: RemotePreviewSettings = { updates: 'missing', saveLocally: true }
export let parseRemotePreviews = (value: unknown): RemotePreviewSettings => {
  if (value === undefined) return { ...DEFAULT_REMOTE_PREVIEWS }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('remotePreviews must be a mapping')
  let raw = value as Record<string, unknown>
  if (Object.keys(raw).some(key => !['updates', 'saveLocally'].includes(key))) throw new Error('Unknown remote preview setting')
  if (raw.updates !== undefined && (typeof raw.updates !== 'string' || !['missing', 'open', 'manual'].includes(raw.updates))) throw new Error('Invalid remote preview update mode')
  if (raw.saveLocally !== undefined && typeof raw.saveLocally !== 'boolean') throw new Error('remotePreviews.saveLocally must be true or false')
  return { updates: raw.updates as RemotePreviewSettings['updates'] ?? 'missing', saveLocally: raw.saveLocally as boolean ?? true }
}
