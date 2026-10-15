import type { Model } from './types'

export let profileDeletionReason = (model: Model, profileId: string) => {
  if (profileId === 'profile_default') return 'The default profile cannot be deleted.'
  if (model.sessions.some(session => session.windows.some(window => window.panes.some(pane => pane.profileId === profileId)))) return 'Close this profile’s panes before deleting it.'
  if (model.layouts.some(layout => layout.window.panes.some(pane => pane.profileId === profileId))) return 'Remove saved layouts using this profile before deleting it.'
  return undefined
}

export let removeProfile = (model: Model, profileId: string) => {
  let reason = profileDeletionReason(model, profileId)
  if (reason) throw new Error(reason)
  let profile = model.profiles.find(profile => profile.id === profileId)
  if (!profile) throw new Error('Profile not found')
  model.profiles = model.profiles.filter(profile => profile.id !== profileId)
  for (let session of model.sessions) if (session.defaultProfileId === profileId) session.defaultProfileId = 'profile_default'
  if (model.newSessionProfileId === profileId) model.newSessionProfileId = 'profile_default'
  if (model.closedSessionProfiles) model.closedSessionProfiles = Object.fromEntries(Object.entries(model.closedSessionProfiles).filter(([, id]) => id !== profileId))
  return profile
}
