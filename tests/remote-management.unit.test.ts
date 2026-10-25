import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { initialModel } from '../src/main/model'
import { createRemoteManagement } from '../src/main/remote-management'
import type { RemoteProxy } from '../src/shared/remote-management'
import type { ProxyCredentials } from '../src/main/profile-proxy'

let fixture = (interactiveOnly = false, hostProxy?: RemoteProxy) => {
  let model = initialModel(), saved = new Map<string, ProxyCredentials>()
  let options: Parameters<typeof createRemoteManagement>[0] = {
    model, interactiveOnly, hostProxy,
    credentials: { has: id => saved.has(id), get: id => saved.get(id), available: () => true },
    assertControl: vi.fn(), persist: vi.fn(), changed: vi.fn(), reopen: vi.fn(async () => {}),
    testProxy: vi.fn(async () => ({ ip: '192.0.2.1', checkedAt: Date.now() })),
    saveProxy: vi.fn((profile, proxy, credentials) => {
      profile.connections ??= [{ id: profile.id, proxy: profile.proxy }]
      let id = `connection_${profile.connections.length}`
      profile.connections.push({ id, proxy }); profile.connectionId = id; profile.proxy = proxy
      if (credentials) saved.set(id, credentials)
      return profile
    }),
  }
  return { model, options, management: createRemoteManagement(options), saved }
}

it('creates without changing local selection and durably deduplicates requests after reconnect', async () => {
  let { model, options, management } = fixture(), clients = structuredClone(model.clients)
  let request = { type: 'rpc' as const, request: randomUUID(), method: 'sessions.create' as const, params: { name: 'Research', profileId: 'profile_bot', url: 'https://example.com' } }
  let result = await management.rpc('owner', request)
  expect(model.sessions).toHaveLength(2)
  expect(model.sessions[1]).toMatchObject({ id: (result as { session: string }).session, name: 'Research', defaultProfileId: 'profile_bot', windows: [{ panes: [{ profileId: 'profile_bot', url: 'https://example.com/' }] }] })
  expect(model.clients).toEqual(clients)
  expect(options.persist).toHaveBeenCalledOnce()
  expect(await createRemoteManagement(options).rpc('owner', request)).toEqual(result)
  expect(model.sessions).toHaveLength(2)
  await expect(management.rpc('owner', { ...request, params: { name: 'Changed' } })).rejects.toThrow('REQUEST_REUSED')
  await expect(management.rpc('owner', { ...request, request: randomUUID(), params: { url: 'file:///etc/passwd' } })).rejects.toThrow('INVALID_URL')
  expect(model.sessions).toHaveLength(2)
})

it('requires a current control lease and revision to add a page with the chosen profile', async () => {
  let { model, options, management } = fixture(), session = model.sessions[0], profile = model.profiles[1]
  profile.connectionId = 'connection_bot'; profile.connections = [{ id: profile.id }, { id: 'connection_bot' }]
  let request = { type: 'rpc' as const, request: randomUUID(), method: 'pages.create' as const, params: { session: session.id, generation: 7, expectedRevision: management.sessionRevision(session.id), profileId: profile.id } }
  vi.mocked(options.assertControl).mockImplementationOnce(() => { throw new Error('CONTROL_EXPIRED') })
  await expect(management.rpc('owner', request)).rejects.toThrow('CONTROL_EXPIRED')
  expect(session.windows).toHaveLength(1)
  await expect(management.rpc('owner', { ...request, params: { ...request.params, expectedRevision: 'obsolete' } })).rejects.toThrow('STALE_REVISION')
  let result = await management.rpc('owner', request)
  expect(options.assertControl).toHaveBeenCalledWith(session.id, 'owner', 7)
  expect(session.windows[1].panes[0]).toMatchObject({ profileId: profile.id, connectionId: 'connection_bot', url: 'about:blank' })
  expect(result).toMatchObject({ session: session.id, pane: session.windows[1].panes[0].id, revision: management.sessionRevision(session.id) })
  expect(session.windows[1].panes[0].id).not.toBe(session.windows[0].panes[0].id)
})

it('keeps existing pages on their saved connection and redacts credentials in profile responses', async () => {
  let { model, options, management } = fixture(), profile = model.profiles[0], session = model.sessions[0], pane = session.windows[0].panes[0]
  let proxy: RemoteProxy = { protocol: 'https', host: 'proxy.example', port: 443, authenticated: true }
  let revision = management.profileDTO(profile).revision
  let result = await management.rpc<'profiles.proxy.set'>('owner', { type: 'rpc', request: randomUUID(), method: 'profiles.proxy.set', params: { profileId: profile.id, expectedRevision: revision, proxy, credentials: { action: 'replace', username: 'fixture-user', password: 'fixture-password' } } })
  expect(result.profile.connections.at(-1)).toMatchObject({ credentialsPresent: true, proxy })
  expect(JSON.stringify(result)).not.toContain('fixture-password')
  expect(JSON.stringify(result)).not.toContain('fixture-user')
  expect(pane.connectionId).toBeUndefined()
  await expect(management.rpc('owner', { type: 'rpc', request: randomUUID(), method: 'profiles.proxy.set', params: { profileId: profile.id, expectedRevision: revision, proxy: null, credentials: { action: 'clear' } } })).rejects.toThrow('STALE_REVISION')
  await management.rpc('owner', { type: 'rpc', request: randomUUID(), method: 'pages.reopen', params: { session: session.id, pane: pane.id, generation: 1, expectedRevision: management.sessionRevision(session.id), profileId: profile.id, connectionId: result.connectionId } })
  expect(pane.connectionId).toBe(result.connectionId)
  expect(options.reopen).toHaveBeenCalledWith(pane.id)
})

it('limits included hosts to their one pane and locks enforced proxy routing', async () => {
  let proxy: RemoteProxy = { protocol: 'http', host: 'proxy.example', port: 8080, authenticated: false }
  let { management, model } = fixture(true, proxy)
  expect(management.capabilities).toMatchObject({ management: 1, profiles: 1, verifiedAttention: 1 })
  expect(management.capabilities.sessionCreate).toBeUndefined()
  expect(management.capabilities.pageCreate).toBeUndefined()
  await expect(management.rpc('owner', { type: 'rpc', request: randomUUID(), method: 'sessions.create', params: {} })).rejects.toThrow('INCLUDED_PANE_LIMIT')
  let profile = model.profiles[0]
  await expect(management.rpc('owner', { type: 'rpc', request: randomUUID(), method: 'profiles.proxy.set', params: { profileId: profile.id, expectedRevision: management.profileDTO(profile).revision, proxy: null, credentials: { action: 'clear' } } })).rejects.toThrow('PROXY_LOCKED')
  expect(model.sessions).toHaveLength(1)
})
