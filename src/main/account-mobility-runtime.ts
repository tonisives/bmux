import { session as electronSession, WebContentsView } from 'electron'
import type { WebContents } from 'electron'
import type { AccountSeal, Model, ProfileProxy } from '../shared/types'
import { paneConnectionId, connectionProfile } from '../shared/profile-connections'
import { accountFingerprint, accountPaneIdentity } from './locked-pane-inventory'
import { assertAccountSeals, sealAccount } from './account-seals'
import { id, nextPaneId, paneById, walkPanes } from './model'
import { includedProxy } from './account-proxies'
import { encryptAccountTransfer } from './account-mobility'
import type { MobilityCommand } from './account-mobility'
import { exportAccountStorage, importAccountStorage } from './account-storage'
import type { ProxyCredentials } from './profile-proxy'

let addresses: Record<string, string> = { tiktok: 'https://www.tiktok.com/', instagram: 'https://www.instagram.com/', youtube: 'https://www.youtube.com/', x: 'https://x.com/', reddit: 'https://www.reddit.com/', linkedin: 'https://www.linkedin.com/', facebook: 'https://www.facebook.com/', threads: 'https://www.threads.net/', bluesky: 'https://bsky.app/', mastodon: 'https://mastodon.social/' }
type Options = {
  model: Model; save: () => void
  acquire: (session: string, owner: string) => { renew: () => void; release: () => void }
  contents: (pane: string) => Promise<WebContents>; dispose: (pane: string) => void
  retire: (connection: string) => void
  credentials: { get: (connection: string) => ProxyCredentials | undefined; set: (connection: string, credentials?: ProxyCredentials) => void }
  test: (proxy: ProfileProxy, credentials?: ProxyCredentials) => Promise<unknown>
  hostProxy?: ProfileProxy
}
export let applyAccountMobility = (options: Options) => async (command: MobilityCommand, value: unknown, valid: () => boolean): Promise<Record<string, unknown>> => {
  let { model } = options, receipt = model.accountHandoffs?.[command.id + ':' + command.phase]
  if (receipt) { options.save(); if (command.phase === 'export') { options.retire(String(command.identity.connectionId)); options.dispose(String(command.identity.paneId)) }; return receipt }
  let guard = () => { if (!valid()) throw new Error('ACCOUNT_REQUEST_EXPIRED') }
  let remember = (result: Record<string, unknown>) => { model.accountHandoffs = { ...model.accountHandoffs, [command.id + ':' + command.phase]: result }; options.save(); return result }
  if (command.phase === 'activate') {
    let seal = Object.values(model.accountSeals ?? {}).find(seal => seal.account === command.account)
    if (!seal || model.accountRetired?.[seal.identity.connectionId]) throw new Error('ACCOUNT_TRANSFER_MISSING')
    assertAccountSeals(model); guard()
    if (model.accountStaged?.[seal.identity.connectionId] !== command.id) {
      if (model.accountHandoffs?.[command.id + ':activate']) return model.accountHandoffs[command.id + ':activate']
      throw new Error('ACCOUNT_TRANSFER_MISSING')
    }
    delete model.accountStaged[seal.identity.connectionId]
    return remember({ phase: 'activate' })
  }
  if (command.phase === 'export') {
    let identity = command.identity as AccountSeal['identity'], seal = model.accountSeals?.[identity.paneId]
    if (!seal || seal.account !== command.account || accountFingerprint(identity) !== accountFingerprint(accountPaneIdentity(model, identity.paneId)) || model.accountRetired?.[identity.connectionId] || model.accountStaged?.[identity.connectionId]) throw new Error('ACCOUNT_IDENTITY_CHANGED')
    let peers = walkPanes(model).filter(({ pane }) => paneConnectionId(pane) === identity.connectionId)
    if (peers.length !== 1) throw new Error('ACCOUNT_CONNECTION_SHARED')
    let lease = options.acquire(identity.sessionId, 'account-move:' + command.id)
    let contents: WebContents | undefined, retired = false
    try {
      contents = await options.contents(identity.paneId); guard(); lease.renew()
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
      await contents.debugger.sendCommand('Network.enable')
      await contents.debugger.sendCommand('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
      let storage = await contents.executeJavaScriptInIsolatedWorld(998, [{ code: exportAccountStorage }])
      let cookies = await contents.session.cookies.get({}), { pane } = paneById(model, identity.paneId)
      let profile = model.profiles.find(profile => profile.id === pane.profileId)!, connection = connectionProfile(model, identity.connectionId)
      if (!connection.proxy || options.hostProxy && accountFingerprint(options.hostProxy) !== accountFingerprint(connection.proxy)) throw new Error('ACCOUNT_PROXY_NOT_PORTABLE')
      if (!connection.proxy.route && (/^(localhost|127\.|0\.|\[?::1)/i.test(connection.proxy.host) || connection.proxy.host.endsWith('.local'))) throw new Error('ACCOUNT_PROXY_NOT_PORTABLE')
      let capsule = encryptAccountTransfer({ account: command.account, seal, proxy: connection.proxy, credentials: connection.proxy.authenticated ? options.credentials.get(identity.connectionId) : undefined, profile: { name: profile.name, background: profile.background, device: profile.device }, pane: { url: pane.url, title: pane.title, zoom: pane.zoom, device: pane.device }, cookies, storage }, command.operation.targetKey, command.id + ':' + command.account)
      guard(); lease.renew()
      // The ciphertext and retirement marker share one durable model write.
      model.accountRetired = { ...model.accountRetired, [identity.connectionId]: command.id }
      retired = true
      let browser = contents.session
      options.retire(identity.connectionId)
      let result = remember({ phase: 'export', capsule })
      options.dispose(identity.paneId)
      await browser.closeAllConnections()
      // Remove service workers from the retired partition so they cannot issue background requests.
      await browser.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
      return result
    } finally {
      if (!retired && contents && !contents.isDestroyed()) await contents.debugger.sendCommand('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => undefined)
      lease.release()
    }
  }
  type Transfer = { account: string; seal: AccountSeal; proxy: ProfileProxy; credentials?: ProxyCredentials; profile: Model['profiles'][number]; pane: Model['sessions'][number]['windows'][number]['panes'][number]; cookies: Electron.Cookie[]; storage: { origin: string } }
  let transfer = value as Transfer | undefined
  if (command.phase === 'import' && (!transfer || transfer.account !== command.account || transfer.seal.account !== command.account || transfer.seal.headersHash !== command.seal.headersHash || accountFingerprint(transfer.seal.identity) !== accountFingerprint(command.identity))) throw new Error('ACCOUNT_TRANSFER_CHANGED')
  let proxy = transfer?.proxy ?? includedProxy(String(command.operation.request.route))
  if (options.hostProxy && accountFingerprint(options.hostProxy) !== accountFingerprint(proxy)) throw new Error('ACCOUNT_HOST_PROXY_CONFLICT')
  await options.test(proxy, transfer?.credentials); guard()
  let existing = Object.values(model.accountSeals ?? {}).find(seal => seal.account === command.account)
  if (existing) throw new Error('ACCOUNT_ALREADY_PRESENT')
  let profileId = 'profile_' + command.id.replaceAll('-', ''), sessionId = id('session'), windowId = id('win'), paneId = nextPaneId(model)
  if (model.profiles.some(profile => profile.id === profileId)) throw new Error('ACCOUNT_TRANSFER_CONFLICT')
  let browser = electronSession.fromPartition('persist:' + profileId), staging = new WebContentsView({ webPreferences: { session: browser, nodeIntegration: false, contextIsolation: true, sandbox: true } })
  let contents = staging.webContents
  contents.setAudioMuted(true)
  let identity: AccountSeal['identity'], seal: AccountSeal
  try {
    // Only a new, unbound partition may be cleared on a retry after a crash.
    await browser.clearStorageData()
    if (transfer) {
      let origin = new URL(transfer.storage.origin).origin
      if (!['https:', 'http:'].includes(new URL(origin).protocol) || new URL(transfer.pane.url).origin !== origin) throw new Error('ACCOUNT_STORAGE_ORIGIN')
      for (let cookie of transfer.cookies) {
        let { name, value, domain, path, secure, httpOnly, expirationDate, sameSite, hostOnly } = cookie
        if (!domain) throw new Error('ACCOUNT_COOKIE_INVALID')
        await browser.cookies.set({ url: `https://${domain.replace(/^\./, '')}${path || '/'}`, name, value, ...(hostOnly ? {} : { domain }), path, secure, httpOnly, expirationDate, sameSite })
      }
      await browser.cookies.flushStore()
      // Restore origin storage against an offline document before any site request.
      let scheme = new URL(origin).protocol.slice(0, -1)
      browser.protocol.handle(scheme, request => new URL(request.url).origin === origin ? new Response('<!doctype html><title>Account transfer</title>', { headers: { 'Content-Type': 'text/html' } }) : Response.error())
      try { await contents.loadURL(origin); await contents.executeJavaScriptInIsolatedWorld(998, [{ code: importAccountStorage(transfer.storage) }]) }
      finally { browser.protocol.unhandle(scheme) }
    } else await contents.loadURL('about:blank')
    guard()
    let profile = { id: profileId, name: transfer?.profile.name ?? command.operation.persona, background: true, proxy, ...(transfer?.profile.device ? { device: transfer.profile.device } : {}) }
    let pane = { ...(transfer?.pane ?? { url: addresses[command.operation.platform], title: command.operation.label || command.operation.platform, zoom: 1 }), id: paneId, profileId }
    if (!pane.url) throw new Error('ACCOUNT_PLATFORM_INVALID')
    let viewport = transfer?.seal.identity.viewport ?? { width: Number(command.operation.request.width), height: Number(command.operation.request.height) }
    let window = { id: windowId, name: command.operation.label || command.operation.platform, locked: true, lockedViewports: { [paneId]: viewport }, panes: [pane], layout: { kind: 'pane' as const, paneId } }
    let candidate: Model = { ...model, profiles: [...model.profiles, profile], sessions: [...model.sessions, { id: sessionId, name: profile.name + ' · ' + command.operation.platform, defaultProfileId: profileId, windows: [window] }] }
    identity = accountPaneIdentity(candidate, paneId)!
    if (transfer) {
      if (identity.settingsHash !== transfer.seal.identity.settingsHash) throw new Error('ACCOUNT_IDENTITY_CHANGED')
      seal = { ...transfer.seal, identity }
      candidate.accountSeals = { ...candidate.accountSeals, [paneId]: seal }; assertAccountSeals(candidate)
    } else {
      let headers = await contents.executeJavaScriptInIsolatedWorld(998, [{ code: `(async()=>{let hints=navigator.userAgentData;return {userAgent:navigator.userAgent,locale:navigator.language,platform:navigator.platform,...(hints?{userAgentMetadata:{...hints.toJSON(),...await hints.getHighEntropyValues(['architecture','bitness','model','platformVersion','fullVersionList','wow64'])}}:{})}})()` }])
      seal = sealAccount(candidate, command.account, identity, { ...headers, chromeVersion: process.versions.chrome! })
    }
    guard()
    options.credentials.set(profileId, transfer?.credentials)
    model.profiles = candidate.profiles; model.sessions = candidate.sessions; model.accountSeals = candidate.accountSeals
    model.accountStaged = { ...model.accountStaged, [profileId]: command.id }
    return remember({ phase: command.phase, identity, seal: { account: seal.account, headersHash: seal.headersHash, sealedAt: seal.sealedAt } })
  } finally { if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false }) }
}
