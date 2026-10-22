import type { RemoteViewUpdate } from '../shared/remote'
import { ipcMain, session } from 'electron'
import type { WebContents } from 'electron'
import type { RemotePage } from './runtime'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { requestRemoteSessionClose } from './remote-request'
import { remoteIdentity } from './remote-identity'

export type LocalRemoteSession = { id: string; name: string; lastActivityAt?: number; panes: { id: string; title: string }[] }
export type LocalRemoteHost = { id: string; generation: string; key: JsonWebKey; permission: 'watch' | 'control'; service: string; sessions: LocalRemoteSession[] }
export type LocalRemoteListing = { authenticated: boolean; hosts: LocalRemoteHost[] }

export let createLocalRemote = (directory: string) => {
  let identity = remoteIdentity(path.join(directory, 'remote-desktop.pem'))
  let closing = Promise.resolve()
  let origin = new URL(process.env.BMUX_REMOTE_URL ?? 'https://remote.bmux.cc').origin
  if (!origin.startsWith('https://') && !origin.startsWith('http://127.0.0.1:')) throw new Error('Remote service requires HTTPS')
  let viewers = new Map<WebContents, { host: LocalRemoteHost; session: string; token: string; close: () => Promise<unknown>; update: (state: RemoteViewUpdate) => void }>()
  let preferredProfileId: string | undefined, activeToken: string | undefined
  let profiles: () => string[] = () => []
  let useProfiles = (available: () => string[]) => { profiles = available }
  let preferProfile = (profileId: string) => { preferredProfileId = profileId }
  let list = async (): Promise<LocalRemoteListing> => {
    let ids = [...new Set([preferredProfileId, ...profiles()].filter((id): id is string => !!id))]
    let browsers = [...ids.map(id => session.fromPartition(`persist:${id}`)), session.defaultSession]
    for (let browser of browsers) {
      let token = (await browser.cookies.get({ url: origin })).find(item => item.name === 'bmux_session')?.value
      if (!token) continue
      let response = await fetch(`${origin}/api/hosts`, { headers: { Cookie: `bmux_session=${token}` }, signal: AbortSignal.timeout(10000) })
      if (response.status === 401) continue
      if (!response.ok) throw new Error('Remote sessions unavailable')
      activeToken = token
      return { authenticated: true, hosts: await response.json() as LocalRemoteHost[] }
    }
    activeToken = undefined
    return { authenticated: false, hosts: [] }
  }
  let connect = async (publicKey: JsonWebKey, token: string) => {
    if (!token) throw new Error('Sign in to remote')
    let response = await fetch(`${origin}/api/connect`, { method: 'POST', headers: { Cookie: `bmux_session=${token}`, Origin: origin, 'Content-Type': 'application/json', 'X-Bmux-Desktop': '1' }, body: JSON.stringify({ publicKey }), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('Remote connection unavailable')
    return response.json()
  }
  let selection = (contents: WebContents) => {
    let selected = viewers.get(contents)
    let viewerUrl = process.env.ELECTRON_RENDERER_URL ? new URL('remote-client.html', process.env.ELECTRON_RENDERER_URL).href : pathToFileURL(path.join(import.meta.dirname, '../renderer/remote-client.html')).href
    if (!selected || contents.getURL() !== viewerUrl) throw new Error('Untrusted renderer')
    return selected
  }
  ipcMain.handle('remote-client-selection', event => {
    let selected = selection(event.sender)
    return { origin, host: selected.host, session: selected.session }
  })
  ipcMain.handle('remote-client-connect', (event, publicKey: JsonWebKey) => connect(publicKey, selection(event.sender).token))
  ipcMain.handle('remote-client-update', (event, state: RemoteViewUpdate) => selection(event.sender).update(state))
  ipcMain.handle('remote-client-close', event => selection(event.sender).close())
  let open = async (hostId: string | undefined, sessionId: string | undefined, show: (page: RemotePage) => Promise<void>) => {
    let listing = await list()
    if (!listing.authenticated || !activeToken) throw new Error('Sign in to remote')
    if (!hostId || !sessionId) throw new Error('Remote session required')
    let host = listing.hosts.find(item => item.id === hostId && item.sessions.some(item => item.id === sessionId))
    if (!host) throw new Error('Remote session unavailable')
    let token = activeToken
    await show({
      key: `${hostId}:${sessionId}`,
      title: host.sessions.find(item => item.id === sessionId)!.name,
      view: { hostId, sessionId, name: host.sessions.find(item => item.id === sessionId)!.name, service: host.service, canControl: host.permission === 'control', connected: false, controlling: false, occupied: false, panes: [] },
      attach: (contents, close, update) => {
        viewers.set(contents, { host, session: sessionId, token, close, update })
        contents.once('destroyed', () => viewers.delete(contents))
      },
    })
  }
  let closeSession = (hostId: string, sessionId: string) => {
    let result = closing.then(async () => {
      let listing = await list()
      let host = listing.hosts.find(host => host.id === hostId && host.sessions.some(session => session.id === sessionId))
      if (!host || !activeToken) throw new Error('Remote session unavailable')
      if (host.permission !== 'control') throw new Error('Watch only access')
      let token = activeToken
      await requestRemoteSessionClose(origin, host, sessionId, identity, key => connect(key, token))
      for (let [contents, viewer] of viewers) if (viewer.host.id === hostId && viewer.session === sessionId && !contents.isDestroyed()) await viewer.close()
    })
    closing = result.catch(() => undefined)
    return result
  }
  let close = () => { for (let contents of viewers.keys()) if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }); viewers.clear() }
  return { origin, list, open, close, closeSession, useProfiles, preferProfile }
}
