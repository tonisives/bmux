import { createHash } from 'node:crypto'
import type { Model } from '../shared/types'
import { connectionProfile, paneConnectionId } from '../shared/profile-connections'

let platforms: Record<string, string> = { 'tiktok.com': 'tiktok', 'instagram.com': 'instagram', 'youtube.com': 'youtube', 'facebook.com': 'facebook', 'x.com': 'x', 'reddit.com': 'reddit', 'linkedin.com': 'linkedin', 'threads.com': 'threads', 'threads.net': 'threads', 'bsky.app': 'bluesky', 'mastodon.social': 'mastodon' }
let fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex')
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
    let connectionId = paneConnectionId(pane), connection = connectionProfile(model, connectionId)
    let device = pane.device ?? profile.device ?? null
    return [{ key: pane.id, persona: profile.name, platform, sessionName: session.name, windowName: window.name,
      identity: { sessionId: session.id, windowId: window.id, paneId: pane.id, profileId: pane.profileId, connectionId, viewport: { ...viewport }, locked: true, network: connection.proxy ? 'proxy' : 'direct', settingsHash: fingerprint({ proxy: connection.proxy ?? null, device }) } }]
  })
})).slice(0, 300)
