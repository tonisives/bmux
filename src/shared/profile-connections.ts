import type { Model, Pane, Profile } from './types'

export let paneConnectionId = (pane: Pane) => pane.connectionId ?? pane.profileId
export let defaultConnectionId = (profile: Profile) => profile.connectionId ?? profile.id
export let connectionProfile = (model: Model, connectionId: string): Profile => {
  let owner = model.profiles.find(profile => profile.id === connectionId || profile.connections?.some(connection => connection.id === connectionId))
  if (!owner) throw new Error('Unknown proxy connection')
  let saved = owner.connections?.find(connection => connection.id === connectionId)
  return saved ? { ...owner, id: saved.id, proxy: saved.proxy } : owner
}
export let savedProxyProfiles = (model: Model) => model.profiles.flatMap(profile => profile.connections
  ? profile.connections.filter(connection => connection.proxy).map(connection => ({ ...profile, id: connection.id, proxy: connection.proxy }))
  : profile.proxy ? [profile] : [])
