import { createHash } from 'node:crypto'
import type { Model } from '../shared/types'
import { connectionProfile, paneConnectionId } from '../shared/profile-connections'

let platforms: Record<string, string> = { 'tiktok.com': 'tiktok', 'instagram.com': 'instagram', 'youtube.com': 'youtube', 'facebook.com': 'facebook', 'x.com': 'x', 'reddit.com': 'reddit', 'linkedin.com': 'linkedin', 'threads.com': 'threads', 'threads.net': 'threads', 'bsky.app': 'bluesky', 'mastodon.social': 'mastodon' }
export let accountFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex')
export let lockedPaneInventory = (model: Model) => model.sessions.filter(session => !session.ephemeral && !session.private).flatMap(session => session.windows.flatMap(window => {
  if (!window.locked) return []
  return window.panes.flatMap(pane => {
    let viewport = window.lockedViewports?.[pane.id]
    if (!viewport) return []
    let hostname: string
    try { hostname = new URL(pane.url).hostname } catch { return [] }
    let platform = Object.entries(platforms).find(([domain]) => hostname === domain || hostname.endsWith('.' + domain))?.[1]
    if (!platform) return []
    let profile = model.profiles.find(profile => profile.id === pane.profileId)
    if (!profile) return []
    let identity = accountPaneIdentity(model, pane.id)!
    let seal = model.accountSeals?.[pane.id]
    return [{ ...(seal ? { seal: { account: seal.account, headersHash: seal.headersHash, sealedAt: seal.sealedAt } } : {}), key: pane.id, persona: profile.name, platform, sessionName: session.name, windowName: window.name,
      identity }]
  })
})).slice(0, 300)

export let accountPaneIdentity = (model: Model, id: string) => {
  for (let session of model.sessions) for (let window of session.windows) {
    let pane = window.panes.find(pane => pane.id === id), viewport = window.lockedViewports?.[id]
    if (!pane || !viewport || !window.locked || session.private || session.ephemeral) continue
    let profile = model.profiles.find(profile => profile.id === pane.profileId)
    if (!profile) return undefined
    let connectionId = paneConnectionId(pane), connection = connectionProfile(model, connectionId), device = pane.device ?? profile.device ?? null
    return { sessionId: session.id, windowId: window.id, paneId: pane.id, profileId: pane.profileId, connectionId, viewport: { ...viewport }, locked: true as const, network: connection.proxy ? 'proxy' : 'direct', settingsHash: accountFingerprint({ proxy: connection.proxy ?? null, device }) }
  }
}
