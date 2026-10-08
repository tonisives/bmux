import { expect, it } from 'vitest'
import { cloneWindow, initialModel, newPane, validateModel } from '../src/main/model'
import { connectionProfile, paneConnectionId, savedProxyProfiles } from '../src/shared/profile-connections'

it('preserves legacy pane connections while new and duplicated panes use the current default', () => {
  let model = initialModel(), profile = model.profiles[0], window = model.sessions[0].windows[0]
  let proxy = { protocol: 'https' as const, host: 'proxy.example', port: 443, authenticated: true }
  profile.connections = [{ id: profile.id }, { id: 'profile_connection', proxy }]
  profile.connectionId = 'profile_connection'; profile.proxy = proxy
  expect(paneConnectionId(window.panes[0])).toBe(profile.id)
  expect(connectionProfile(model, profile.id).proxy).toBeUndefined()
  expect(newPane(profile.id, 'about:blank', model).connectionId).toBe('profile_connection')
  expect(cloneWindow(window, model).panes[0].connectionId).toBe('profile_connection')
  expect(savedProxyProfiles(model).map(profile => profile.id)).toEqual(['profile_connection'])
  expect(validateModel(JSON.parse(JSON.stringify(model)))).toEqual(model)
})

it('rejects cross-profile or missing pane connections instead of using a different route', () => {
  let model = initialModel(), pane = model.sessions[0].windows[0].panes[0]
  let other = model.profiles[1]
  other.connections = [{ id: other.id }, { id: 'profile_other_connection' }]
  pane.connectionId = 'profile_other_connection'
  expect(() => validateModel(model)).toThrow('Unknown pane connection')
  expect(() => connectionProfile(model, 'profile_missing')).toThrow('Unknown proxy connection')
})
