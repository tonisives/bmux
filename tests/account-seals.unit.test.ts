import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { initialModel, newPane } from '../src/main/model'
import { readModel, writeModel } from '../src/main/store'
import { assertAccountCDP, assertAccountMutation, assertAccountSeals, sealAccount } from '../src/main/account-seals'
import { lockedPaneInventory } from '../src/main/locked-pane-inventory'

let account = '10000000-0000-4000-8000-000000000001'
let fixture = () => {
  let model = initialModel(), window = model.sessions[0].windows[0], pane = window.panes[0]
  pane.url = 'https://youtube.com/'
  window.locked = true; window.lockedViewports = { [pane.id]: { width: 1440, height: 900 } }
  let identity = lockedPaneInventory(model)[0].identity
  let seal = () => sealAccount(model, account, identity, { userAgent: 'BMUX fixture', chromeVersion: '134.0.0.0' })
  return { model, window, pane, identity, seal }
}

describe('permanent account identities', () => {
  it('persists a seal, retries idempotently and refuses a second account or changed identity', () => {
    let { model, pane, identity, seal } = fixture(), saved = seal()
    expect(seal()).toEqual(saved)
    expect(() => sealAccount(model, '20000000-0000-4000-8000-000000000001', identity, saved)).toThrow('SEALED')
    expect(lockedPaneInventory(model)[0].seal).toMatchObject({ account, headersHash: saved.headersHash })
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-account-seal-'))
    try { writeModel(directory, model); let restored = readModel(directory); assertAccountSeals(restored); expect(restored.accountSeals?.[pane.id]).toEqual(saved) }
    finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
  it('refuses a stale import before changing the pane', () => {
    let { model, window, pane, seal } = fixture()
    window.lockedViewports![pane.id].width++
    expect(seal).toThrow('IDENTITY_CHANGED')
    expect(model.accountSeals).toBeUndefined()
  })
  it.each(['unlock-window', 'unlock-viewport', 'lock-viewport', 'kill-pane', 'kill-window', 'kill-session', 'duplicate-window', 'restore-layout', 'move-window', 'move-pane', 'join-pane', 'break-pane', 'swap-pane', 'pane.profile.set', 'pane.proxy.set', 'profile.device.set', 'profile.device.clear', 'profile.delete'])('rejects %s before any mutation', method => {
    let { model, pane, seal } = fixture(); seal()
    let before = JSON.stringify(model)
    expect(() => assertAccountMutation(model, method, { pane: pane.id })).toThrow('SEALED')
    expect(JSON.stringify(model)).toBe(before)
  })
  it.each(['Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride', 'Network.setUserAgentOverride', 'Network.setExtraHTTPHeaders', 'Network.emulateNetworkConditions', 'Fetch.enable', 'Target.createTarget', 'Browser.setPermission', 'Page.addScriptToEvaluateOnNewDocument'])('rejects identity-changing CDP %s', method => {
    let { model, pane, seal } = fixture(); seal()
    expect(() => assertAccountCDP(model, pane.id, method)).toThrow('SEALED')
  })
  it('allows browsing and observation while detecting settings corruption on restore', () => {
    let { model, pane, seal } = fixture(); seal()
    for (let method of ['navigate', 'reload', 'click', 'type', 'key', 'dom', 'screenshot']) expect(() => assertAccountMutation(model, method, { pane: pane.id })).not.toThrow()
    expect(() => assertAccountCDP(model, pane.id, 'Page.captureScreenshot')).not.toThrow()
    pane.url = 'https://youtube.com/watch?v=fixture'; assertAccountSeals(model)
    pane.connectionId = 'unrelated'; expect(() => assertAccountSeals(model)).toThrow('SEALED')
  })
  it('rejects conflicting devices on a shared cookie partition', () => {
    let { model, window, pane, seal } = fixture(), other = newPane(pane.profileId, 'https://youtube.com', model)
    other.device = { preset: 'pixel-8', platform: 'android', width: 412, height: 915, deviceScaleFactor: 2.625, orientation: 'portrait', locale: 'en-US', timezone: 'Asia/Bangkok' }
    window.panes.push(other)
    expect(seal).toThrow('CONNECTION_DEVICE_CONFLICT')
  })
})
