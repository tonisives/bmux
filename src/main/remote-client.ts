import type { RemoteViewUpdate } from '../shared/remote'
import { ipcMain, session } from 'electron'
import type { WebContents } from 'electron'
import type { RemotePage } from './runtime'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { requestRemoteSessionClose, requestRemotePageClose, requestRemoteSessionPreviews } from './remote-request'
import { remoteIdentity } from './remote-identity'
import { createRemotePreviews } from './remote-previews'
import type { Snapshot } from '../shared/types'
import type { RemoteSession, RemoteMachine } from '../shared/remote-sessions'
import { DEFAULT_REMOTE_PREVIEWS } from '../shared/remote-preview-settings'
import type { RemotePreviewSettings, RemotePreviewRequest } from '../shared/remote-preview-settings'

export type LocalRemoteSession = RemoteSession
export type LocalRemoteHost = { id: string; generation: string; key: JsonWebKey; permission: 'watch' | 'control'; service: string; machine?: RemoteMachine; sessions: LocalRemoteSession[] }
export type LocalRemoteListing = { authenticated: boolean; hosts: LocalRemoteHost[] }

export let createLocalRemote = (directory: string, previewSettings: () => RemotePreviewSettings = () => DEFAULT_REMOTE_PREVIEWS) => {
  let identity = remoteIdentity(path.join(directory, 'remote-desktop.pem'))
  let previewIdentity = remoteIdentity(path.join(directory, 'remote-preview-device.pem'))
  let closing = Promise.resolve()
  let fetching = Promise.resolve(), pendingPreviews = new Map<string, Promise<Record<string, Snapshot>>>()
  let previews = createRemotePreviews(path.join(directory, 'remote'), () => previewSettings().saveLocally)
  let origin = new URL(process.env.BMUX_REMOTE_URL ?? 'https://remote.bmux.cc').origin
  if (!origin.startsWith('https://') && !origin.startsWith('http://127.0.0.1:')) throw new Error('Remote service requires HTTPS')
  let viewers = new Map<WebContents, { host: LocalRemoteHost; session: string; pane?: string; token: string; close: () => Promise<unknown>; update: (state: RemoteViewUpdate) => void }>()
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
      let hosts = await response.json() as LocalRemoteHost[]
      await previews.reconcile(hosts)
      return { authenticated: true, hosts }
    }
    activeToken = undefined
    await previews.reconcile([])
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
    return { origin, host: selected.host, session: selected.session, pane: selected.pane }
  })
  ipcMain.handle('remote-client-connect', (event, publicKey: JsonWebKey) => connect(publicKey, selection(event.sender).token))
  ipcMain.handle('remote-client-update', (event, state: RemoteViewUpdate) => selection(event.sender).update(state))
  ipcMain.handle('remote-client-preview', async (event, pane: string, image: string) => {
    let selected = selection(event.sender)
    await list()
    return previews.set(selected.host, selected.session, pane, image)
  })
  ipcMain.handle('remote-client-close', event => selection(event.sender).close())
  let open = async (hostId: string | undefined, sessionId: string | undefined, show: (page: RemotePage) => Promise<void>, paneId?: string) => {
    let listing = await list()
    if (!listing.authenticated || !activeToken) throw new Error('Sign in to remote')
    if (!hostId || !sessionId) throw new Error('Remote session required')
    let host = listing.hosts.find(item => item.id === hostId && item.sessions.some(item => item.id === sessionId))
    if (!host) throw new Error('Remote session unavailable')
    let selected = host.sessions.find(item => item.id === sessionId)!
    if (paneId && !selected.panes.some(pane => pane.id === paneId)) throw new Error('Remote pane unavailable')
    let token = activeToken
    await show({
      key: `${hostId}:${sessionId}`,
      title: host.sessions.find(item => item.id === sessionId)!.name,
      view: { hostId, sessionId, name: host.sessions.find(item => item.id === sessionId)!.name, service: host.service, canControl: host.permission === 'control', connected: false, controlling: false, occupied: false, pane: paneId, panes: selected.panes.map(pane => ({ ...pane, url: '' })) },
      attach: (contents, close, update) => {
        viewers.set(contents, { host, session: sessionId, pane: paneId, token, close, update })
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
      await requestRemoteSessionClose(origin, { ...host, canClose: host.sessions.find(session => session.id === sessionId)?.canClose }, sessionId, identity, key => connect(key, token))
      for (let [contents, viewer] of viewers) if (viewer.host.id === hostId && viewer.session === sessionId && !contents.isDestroyed()) await viewer.close()
    })
    closing = result.catch(() => undefined)
    return result
  }
  let close = () => { for (let contents of viewers.keys()) if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }); viewers.clear() }
  let closePage = (hostId: string, sessionId: string, paneId: string) => {
    let result = closing.then(async () => {
      let listing = await list(), host = listing.hosts.find(host => host.id === hostId)
      let session = host?.sessions.find(session => session.id === sessionId && session.panes.some(pane => pane.id === paneId))
      if (!host || !session || !activeToken) throw new Error('Remote page unavailable')
      if (host.permission !== 'control') throw new Error('Watch only access')
      let token = activeToken
      await requestRemotePageClose(origin, { ...host, canClosePages: session.canClosePages }, sessionId, paneId, identity, key => connect(key, token))
      let remaining = (await list()).hosts.find(host => host.id === hostId)?.sessions.some(session => session.id === sessionId)
      if (!remaining) for (let [contents, viewer] of viewers) if (viewer.host.id === hostId && viewer.session === sessionId && !contents.isDestroyed()) await viewer.close()
    })
    closing = result.catch(() => undefined)
    return result
  }
  let account = async (endpoint: string, body?: unknown): Promise<unknown> => {
    if (!/^\/api\/(me|streams(?:\/disconnect)?|billing\/(status|rates|checkout|portal|cancel)|rentals(?:\/(catalog|checkout|[a-f0-9-]{36}(?:\/(cancel|delete))?))?|services(?:\/revoke)?)$/.test(endpoint)) throw new Error('Invalid account endpoint')
    if (!activeToken) await list()
    if (!activeToken) throw new Error('Sign in to remote')
    let response = await fetch(`${origin}${endpoint}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: `bmux_session=${activeToken}`, Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) })
    if (response.status === 401) { activeToken = undefined; throw new Error('Sign in to remote') }
    let result = await response.json() as { error?: string }
    if (!response.ok) throw new Error(result.error || 'Account request unavailable')
    return result
  }
  let sessionPreviews = (hostId: string, sessionId: string, request: RemotePreviewRequest = 'missing') => {
    if (request === 'cache') return previews.get(hostId, sessionId)
    let key = JSON.stringify([hostId, sessionId, request]), pending = pendingPreviews.get(key)
    if (pending) return pending
    let result = fetching.catch(() => undefined).then(async () => {
      let listing = await list()
      let host = listing.hosts.find(host => host.id === hostId), selected = host?.sessions.find(session => session.id === sessionId)
      let cached = await previews.get(hostId, sessionId), token = activeToken
      if (!host || !selected?.canPreview || !token || request === 'missing' && selected.panes.every(pane => cached[pane.id])) return cached
      try {
        let snapshots = await requestRemoteSessionPreviews(origin, host, sessionId, selected.panes.map(pane => pane.id), previewIdentity, key => connect(key, token))
        await list()
        for (let [pane, snapshot] of Object.entries(snapshots)) await previews.set(host, sessionId, pane, snapshot.image, snapshot.capturedAt)
      } catch { /* Keep saved previews when the host is unavailable. */ }
      return previews.get(hostId, sessionId)
    }).finally(() => { if (pendingPreviews.get(key) === result) pendingPreviews.delete(key) })
    pendingPreviews.set(key, result); fetching = result.then(() => undefined, () => undefined)
    return result
  }

  return { origin, list, open, close, closeSession, closePage, sessionPreviews, account, flush: previews.flush, refreshPreviewSettings: previews.configure, useProfiles, preferProfile }
}
