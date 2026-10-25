import { createHash } from 'node:crypto'
import type { Model, Profile } from '../shared/types'
import { newSession, newWindow, paneById } from './model'
import { defaultConnectionId } from '../shared/profile-connections'
import { parseProfileProxy, type ProxyCredentials } from './profile-proxy'
import type { RemoteCapabilities, RemoteProfile, RemoteProxy, RemoteProxyCredentials, RemoteRPCRequest, RemoteManagementResults, RemoteManagementParams } from '../shared/remote-management'

type Options = {
  model: Model
  interactiveOnly: boolean
  hostProxy?: RemoteProxy
  credentials: { has: (id: string) => boolean; get: (id: string) => ProxyCredentials | undefined; available: () => boolean }
  assertControl: (session: string, owner: string, generation: number) => unknown
  saveProxy: (profile: Profile, proxy?: RemoteProxy, credentials?: ProxyCredentials) => Profile
  testProxy: (proxy: RemoteProxy, credentials?: ProxyCredentials) => Promise<{ ip: string; region?: string; checkedAt: number }>
  persist: () => void
  changed: () => void
  reopen: (pane: string) => Promise<void>
}
let hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let text = (value: unknown, maximum = 128): string => { if (typeof value !== 'string' || !value || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new Error('INVALID_REQUEST'); return value }
let pageUrl = (value: unknown) => {
  if (value === undefined || value === 'about:blank') return 'about:blank'
  let url = new URL(text(value, 8192))
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_URL')
  return url.href
}
export let remoteSessionRevision = (model: Model, session: string) => {
  let item = model.sessions.find(item => item.id === session)
  if (!item || item.ephemeral) throw new Error('TARGET_UNAVAILABLE')
  return hash({ id:item.id, name:item.name, profile:item.defaultProfileId, windows:item.windows.map(window => ({ id:window.id, panes:window.panes.map(pane => ({ id:pane.id, profile:pane.profileId, connection:pane.connectionId, url:pane.url })) })) })
}
export let createRemoteManagement = (options: Options) => {
  let { model } = options, queue: Promise<unknown> = Promise.resolve(), unavailable = false
  let capabilities: RemoteCapabilities = { management:1, profiles:1, proxy:1, streamQuality:1, verifiedAttention:1, ...(options.interactiveOnly ? {} : { sessionCreate:1, pageCreate:1 }) }
  let profileDTO = (profile: Profile): RemoteProfile => {
    let connections = (profile.connections ?? [{ id:profile.id, proxy:profile.proxy }]).map(connection => ({ id:connection.id, ...(connection.proxy ? { proxy:{ ...connection.proxy } } : {}), credentialsPresent:options.credentials.has(connection.id) }))
    let value = { id:profile.id, name:profile.name, isDefault:profile.id === 'profile_default', defaultConnectionId:defaultConnectionId(profile), connections, proxyLocked:!!options.hostProxy, credentialStorageAvailable:options.credentials.available() }
    return { ...value, revision:hash(value) }
  }
  let getProfile = (id: unknown) => { let profile = model.profiles.find(item => item.id === text(id)); if (!profile) throw new Error('PROFILE_UNAVAILABLE'); return profile }
  let checkProfile = (id: unknown, revision: unknown) => { let profile = getProfile(id); if (profileDTO(profile).revision !== revision) throw new Error('STALE_REVISION'); return profile }
  let credentials = (profile: Profile, proxy: RemoteProxy, action: RemoteProxyCredentials, connection = defaultConnectionId(profile)) => {
    if (!action || !['keep','replace','clear'].includes(action.action)) throw new Error('INVALID_REQUEST')
    if (!proxy.authenticated) { if (action.action === 'replace') throw new Error('INVALID_REQUEST'); return undefined }
    if (action.action === 'clear') throw new Error('PROXY_CREDENTIALS_REQUIRED')
    let result = action.action === 'replace' ? { username:text(action.username,4096), password:text(action.password,4096) } : options.credentials.get(connection)
    if (!result) throw new Error('PROXY_CREDENTIALS_REQUIRED')
    return result
  }
  let execute = async (owner: string, request: RemoteRPCRequest): Promise<RemoteManagementResults[keyof RemoteManagementResults]> => {
    if (unavailable) throw new Error('MANAGEMENT_UNAVAILABLE')
    if (!request || request.type !== 'rpc' || !/^[a-f0-9-]{36}$/.test(request.request) || !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) throw new Error('INVALID_REQUEST')
    let mutation = ['sessions.create','pages.create','profiles.proxy.set','pages.reopen'].includes(request.method)
    let inputHash = hash([request.method,request.params]), records = model.remoteOperations ?? []
    let existing = records.find(item => item.owner === owner && item.request === request.request)
    if (existing) { if (existing.hash !== inputHash) throw new Error('REQUEST_REUSED'); return structuredClone(existing.result) as RemoteManagementResults[keyof RemoteManagementResults] }
    if (mutation && records.filter(item => item.at > Date.now() - 30 * 86400000).length >= 1000) throw new Error('REQUEST_CAPACITY_REACHED')
    let result: RemoteManagementResults[keyof RemoteManagementResults], reopen: string | undefined
    if (request.method === 'profiles.list') result = { profiles:model.profiles.map(profileDTO) }
    else if (request.method === 'sessions.create') {
      if (options.interactiveOnly) throw new Error('INCLUDED_PANE_LIMIT')
      let params = request.params, profile = getProfile(params.profileId ?? 'profile_default'), url = pageUrl(params.url)
      let name = params.name === undefined ? `session-${request.request.slice(0,8)}` : text(params.name,128)
      if (model.sessions.some(item => item.name === name)) throw new Error('SESSION_NAME_UNAVAILABLE')
      let session = newSession(name,profile.id,false,model), pane = session.windows[0].panes[0]
      pane.url = url; pane.title = url === 'about:blank' ? 'New window' : url
      model.sessions.push(session)
      result = { session:session.id, pane:pane.id, revision:remoteSessionRevision(model,session.id) }
    } else if (request.method === 'pages.create') {
      if (options.interactiveOnly) throw new Error('INCLUDED_PANE_LIMIT')
      let params = request.params, session = model.sessions.find(item => item.id === text(params.session) && !item.ephemeral)
      if (!session) throw new Error('TARGET_UNAVAILABLE')
      options.assertControl(session.id,owner,params.generation)
      if (remoteSessionRevision(model,session.id) !== params.expectedRevision) throw new Error('STALE_REVISION')
      let profile = getProfile(params.profileId ?? session.defaultProfileId), url = pageUrl(params.url), window = newWindow(`window-${session.windows.length+1}`,profile.id,true,model)
      window.panes[0].url = url; window.panes[0].title = url === 'about:blank' ? 'New window' : url
      if (session.device) window.panes[0].device = { ...session.device }
      session.windows.push(window)
      result = { session:session.id, pane:window.panes[0].id, revision:remoteSessionRevision(model,session.id) }
    } else if (request.method === 'profiles.proxy.set') {
      if (options.hostProxy) throw new Error('PROXY_LOCKED')
      let params = request.params, profile = checkProfile(params.profileId,params.expectedRevision), proxy = params.proxy === null ? undefined : parseProfileProxy(params.proxy)
      if (!params.credentials || !['keep','replace','clear'].includes(params.credentials.action)) throw new Error('INVALID_REQUEST')
      let replacement = proxy ? credentials(profile,proxy,params.credentials) : undefined
      if (!proxy && params.credentials.action !== 'clear') throw new Error('INVALID_REQUEST')
      options.saveProxy(profile,proxy,replacement)
      result = { profile:profileDTO(profile), connectionId:defaultConnectionId(profile) }
    } else if (request.method === 'profiles.proxy.test') {
      let params = request.params, profile = checkProfile(params.profileId,params.expectedRevision), connection = params.connectionId ?? defaultConnectionId(profile)
      let saved = (profile.connections ?? [{ id:profile.id, proxy:profile.proxy }]).find(item => item.id === connection)
      if (!saved) throw new Error('PROFILE_UNAVAILABLE')
      let proxy = options.hostProxy ?? (params.draft ? parseProfileProxy(params.draft.proxy) : saved.proxy)
      if (!proxy) throw new Error('PROXY_REQUIRED')
      if (options.hostProxy && params.draft) throw new Error('PROXY_LOCKED')
      let authentication = params.draft ? credentials(profile,proxy,params.draft.credentials,connection) : proxy.authenticated ? options.credentials.get(connection) : undefined
      if (proxy.authenticated && !authentication) throw new Error('PROXY_CREDENTIALS_REQUIRED')
      let test = await options.testProxy(proxy,authentication)
      if (profileDTO(profile).revision !== params.expectedRevision) throw new Error('STALE_REVISION')
      result = { ...test, revision:params.expectedRevision, ...(params.draft ? {} : { connectionId:connection }) }
    } else if (request.method === 'pages.reopen') {
      let params = request.params, target = paneById(model,text(params.pane)), profile = getProfile(params.profileId)
      if (target.session.id !== params.session || target.pane.profileId !== profile.id || target.session.ephemeral) throw new Error('TARGET_UNAVAILABLE')
      options.assertControl(target.session.id,owner,params.generation)
      if (remoteSessionRevision(model,target.session.id) !== params.expectedRevision) throw new Error('STALE_REVISION')
      if (!(profile.connections ?? [{id:profile.id}]).some(item => item.id === params.connectionId)) throw new Error('PROFILE_UNAVAILABLE')
      target.pane.connectionId = params.connectionId; reopen = target.pane.id
      result = { session:target.session.id, pane:target.pane.id, revision:remoteSessionRevision(model,target.session.id) }
    } else throw new Error('UNSUPPORTED_OPERATION')
    if (mutation) {
      model.remoteOperations = [...records.filter(item => item.at > Date.now()-30*86400000), { owner, request:request.request, hash:inputHash, at:Date.now(), result:structuredClone(result) }]
      try { options.persist() } catch { unavailable = true; throw new Error('MANAGEMENT_PERSIST_FAILED') }
      options.changed()
      if (reopen) await options.reopen(reopen)
    }
    return result
  }
  let rpc = <K extends keyof RemoteManagementParams>(owner: string, request: RemoteRPCRequest) => {
    let operation = queue.then(() => execute(owner,request))
    queue = operation.catch(() => undefined)
    return operation as Promise<RemoteManagementResults[K]>
  }
  return { rpc, capabilities, profileDTO, sessionRevision:(session: string) => remoteSessionRevision(model,session) }
}
