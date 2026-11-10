import type { AccountSeal, Model } from '../shared/types'
import { paneConnectionId, connectionProfile } from '../shared/profile-connections'
import { accountFingerprint, accountPaneIdentity } from './locked-pane-inventory'

let headerIdentity = (value: Pick<AccountSeal, 'userAgent' | 'locale' | 'chromeVersion' | 'platform' | 'userAgentMetadata'>) => ({ userAgent: value.userAgent, locale: value.locale ?? null, chromeVersion: value.chromeVersion, platform: value.platform ?? null, metadata: value.userAgentMetadata ?? null })
let fail = (): never => { throw new Error('ACCOUNT_IDENTITY_SEALED') }
export let assertAccountSeals = (model: Model) => {
  if (model.accountSeals === undefined) return
  if (!model.accountSeals || typeof model.accountSeals !== 'object' || Array.isArray(model.accountSeals)) fail()
  for (let [id, seal] of Object.entries(model.accountSeals)) {
    let session = model.sessions.find(item => item.id === seal?.identity?.sessionId)
    let window = session?.windows.find(item => item.id === seal.identity.windowId), pane = window?.panes.find(item => item.id === id)
    let profile = model.profiles.find(item => item.id === pane?.profileId)
    if (!pane || !profile || session?.private || session?.ephemeral || !window?.locked || id !== seal.identity.paneId || pane.profileId !== seal.identity.profileId || paneConnectionId(pane) !== seal.identity.connectionId || accountFingerprint(window.lockedViewports?.[id]) !== accountFingerprint(seal.identity.viewport)) fail()
    let device = pane!.device ?? profile!.device ?? null
    if (accountFingerprint({ proxy: connectionProfile(model, paneConnectionId(pane!)).proxy ?? null, device }) !== seal.identity.settingsHash || accountFingerprint(device) !== accountFingerprint(seal.device ?? null)) fail()
    if (typeof seal.account !== 'string' || !/^[a-f0-9-]{36}$/.test(seal.account) || typeof seal.userAgent !== 'string' || !seal.userAgent || seal.userAgent.length > 2048 || /[\r\n]/.test(seal.userAgent) || typeof seal.chromeVersion !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(seal.chromeVersion) || !Number.isFinite(Date.parse(seal.sealedAt)) || seal.headersHash !== accountFingerprint(headerIdentity(seal)) || JSON.stringify(headerIdentity(seal)).length > 8192 || seal.locale !== undefined && (typeof seal.locale !== 'string' || /[\r\n]/.test(seal.locale)) || seal.platform !== undefined && typeof seal.platform !== 'string') fail()
  }
}

export let sealAccount = (model: Model, account: string, expected: AccountSeal['identity'], headers: Pick<AccountSeal, 'userAgent' | 'chromeVersion' | 'locale' | 'platform' | 'userAgentMetadata'>) => {
  assertAccountSeals(model)
  let existing = model.accountSeals?.[expected.paneId]
  if (existing) {
    if (existing.account !== account || accountFingerprint(existing.identity) !== accountFingerprint(expected)) fail()
    return existing
  }
  let identity = accountPaneIdentity(model, expected.paneId)
  if (!identity || accountFingerprint(identity) !== accountFingerprint(expected)) throw new Error('ACCOUNT_IDENTITY_CHANGED')
  let pane = model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(pane => pane.id === expected.paneId)!
  let profile = model.profiles.find(profile => profile.id === pane.profileId)!, device = pane.device ?? profile.device
  // The connection owns the cookie partition and its default HTTP identity.
  let peers = model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).filter(item => paneConnectionId(item) === expected.connectionId)
  if (peers.some(item => accountFingerprint(item.device ?? profile.device ?? null) !== accountFingerprint(device ?? null))) throw new Error('ACCOUNT_CONNECTION_DEVICE_CONFLICT')
  let previous = Object.values(model.accountSeals ?? {}).find(seal => seal.identity.connectionId === expected.connectionId)
  let pinned = previous ? { userAgent: previous.userAgent, chromeVersion: previous.chromeVersion, locale: previous.locale, platform: previous.platform, userAgentMetadata: previous.userAgentMetadata } : headers
  let seal: AccountSeal = { account, identity: structuredClone(expected), ...pinned, ...(device ? { device: structuredClone(device) } : {}), sealedAt: new Date().toISOString(), headersHash: accountFingerprint(headerIdentity(pinned)) }
  let candidate = { ...model, accountSeals: { ...model.accountSeals, [pane.id]: seal } }
  assertAccountSeals(candidate)
  model.accountSeals = candidate.accountSeals
  return seal
}

export let assertAccountMutation = (model: Model, method: string, args: Record<string, unknown>) => {
  let seals = Object.values(model.accountSeals ?? {})
  if (!seals.length) return
  let pane = args.pane ?? args.tab
  let affected = seals.filter(seal => args.target && [seal.identity.paneId, seal.identity.windowId, seal.identity.sessionId].includes(String(args.target)) || (pane ? seal.identity.paneId === pane : args.window ? seal.identity.windowId === args.window : args.session ? seal.identity.sessionId === args.session : args.profile ? seal.identity.profileId === args.profile || seal.identity.connectionId === args.profile : true))
  if (affected.length && ['unlock-window', 'unlock-viewport', 'lock-viewport', 'kill-pane', 'kill-window', 'kill-session', 'duplicate-window', 'restore-layout', 'move-window', 'move-pane', 'join-pane', 'break-pane', 'swap-pane', 'pane.profile.set', 'pane.proxy.set', 'profile.device.set', 'profile.device.clear', 'profile.delete'].includes(method)) fail()
  // A connection's HTTP defaults are shared by every pane in its partition.
  if (['profile.device.set', 'profile.device.clear'].includes(method)) {
    let target = model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(item => item.id === pane)
    if (target && seals.some(seal => seal.identity.connectionId === paneConnectionId(target))) fail()
  }
  if (method === 'cdp' && affected.length) assertAccountCDP(model, String(pane), String(args.method))
}

export let assertAccountCDP = (model: Model, pane: string, method: string) => {
  let target = model.sessions.flatMap(session => session.windows.flatMap(window => window.panes)).find(item => item.id === pane)
  if (!target || !Object.values(model.accountSeals ?? {}).some(seal => seal.identity.connectionId === paneConnectionId(target))) return
  if (/^(Emulation\.|Network\.(set|emulate)|Fetch\.|Browser\.|Target\.|Page\.(addScript|removeScript|setWebLifecycleState))/.test(method)) fail()
}
