import { expect, it } from 'vitest'
import { initialModel, newPane, validateModel } from '../src/main/model'
import { profileDeletionReason, removeProfile } from '../src/shared/profile-management'

it('protects the built-in profile and profiles used by panes or saved layouts', () => {
  let model = initialModel(), profile = model.profiles[1]
  expect(() => removeProfile(model, 'profile_default')).toThrow('default profile')
  let pane = newPane(profile.id)
  model.sessions[0].windows[0].panes.push(pane)
  expect(() => removeProfile(model, profile.id)).toThrow('Close this profile')
  model.sessions[0].windows[0].panes.pop()
  model.layouts.push({ name: 'saved', window: { ...model.sessions[0].windows[0], panes: [pane] } })
  expect(profileDeletionReason(model, profile.id)).toContain('saved layouts')
  expect(() => removeProfile(model, profile.id)).toThrow('saved layouts')
  expect(model.profiles).toContain(profile)
})

it('repairs defaults and closed-session references when an unused profile is deleted', () => {
  let model = initialModel(), profile = model.profiles[1]
  model.sessions[0].defaultProfileId = profile.id
  model.newSessionProfileId = profile.id
  model.closedSessionProfiles = { removed: profile.id, kept: 'profile_default' }
  expect(removeProfile(model, profile.id)).toBe(profile)
  expect(model.profiles).not.toContain(profile)
  expect(model.sessions[0].defaultProfileId).toBe('profile_default')
  expect(model.newSessionProfileId).toBe('profile_default')
  expect(model.closedSessionProfiles).toEqual({ kept: 'profile_default' })
  expect(validateModel(model)).toEqual(model)
  expect(() => removeProfile(model, profile.id)).toThrow('Profile not found')
})
