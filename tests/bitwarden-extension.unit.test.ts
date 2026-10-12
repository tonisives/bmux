import { describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bitwardenPasskeyPreflight, patchBitwardenInlineNewItem, patchBitwardenPasskeys, prepareBitwardenPackage } from '../src/main/bitwarden-extension'

let source = 'before;const d=chrome.runtime.getURL("popup/index.html"),h=(yield YO.tabsQuery({url:`${d}*`})).find(e=>{var t;return null===(t=e.url)||void 0===t?void 0:t.includes(`singleActionPopout=${o}`)});try{yield chrome.runtime.sendMessage({command:"reloadAddEditCipherData",data:{cipherId:i,cipherType:r}}),yield YO.updateWindowProperties(h.windowId,{focused:!0})}catch(e){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s})};after'

describe('Bitwarden inline New item compatibility', () => {
  it('opens a new popout before messaging an editor that does not exist', () => {
    let patched = patchBitwardenInlineNewItem(source)
    expect(patched).toContain('if(!h){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s});/* bmux-inline-new-item-existing-popout-check */return}try{yield chrome.runtime.sendMessage')
    expect(patchBitwardenInlineNewItem(patched)).toBe(patched)
  })

  it('fails installation when the pinned Bitwarden bundle no longer matches', () => {
    expect(() => patchBitwardenInlineNewItem('changed upstream bundle')).toThrow('compatibility target was not found')
  })
})

let passkeySource = 'try{return yield i(n,t,e)}finally{null!=t.id&&(yield YO.focusTab(t.id)),null!=t.windowId&&(yield YO.focusWindow(t.windowId))}'
let passkeyFixture = (status = 1) => ({
  request: {} as { mediation?: string }, tab: { id: 8, windowId: 0 }, unlockedStatus: 2,
  authStatus: vi.fn(async () => status), resolveTab: vi.fn(async () => ({ id: 8, windowId: 4 })), openUnlock: vi.fn(async () => undefined),
})

describe('Bitwarden passkey startup', () => {
  it('opens a locked vault in the requesting page window and releases the website request', async () => {
    let fixture = passkeyFixture()
    await expect(bitwardenPasskeyPreflight(fixture)).rejects.toMatchObject({ name: 'NotAllowedError', message: 'Unlock Bitwarden and try passkey sign-in again.' })
    expect(fixture.openUnlock).toHaveBeenCalledWith({ id: 8, windowId: 4 })
  })

  it('opens the login window for a stale hook after sign-out too', async () => {
    let fixture = passkeyFixture(0)
    await expect(bitwardenPasskeyPreflight(fixture)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(fixture.openUnlock).toHaveBeenCalledOnce()
  })

  it('keeps background conditional autofill from opening the unlock window', async () => {
    let fixture = passkeyFixture()
    fixture.request.mediation = 'conditional'
    await expect(bitwardenPasskeyPreflight(fixture)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(fixture.openUnlock).not.toHaveBeenCalled()
  })

  it('keeps unlocked passkey signing available and corrects the native sender window', async () => {
    let fixture = passkeyFixture(2)
    await expect(bitwardenPasskeyPreflight(fixture)).resolves.toEqual({ id: 8, windowId: 4 })
    expect(fixture.openUnlock).not.toHaveBeenCalled()
  })

  it.each(['authStatus', 'resolveTab', 'openUnlock'] as const)('rejects a stalled %s without waiting for the website timeout', async operation => {
    vi.useFakeTimers()
    try {
      let fixture = passkeyFixture()
      fixture[operation].mockImplementation(() => new Promise<never>(() => undefined))
      let assertion = expect(bitwardenPasskeyPreflight(fixture)).rejects.toMatchObject({ name: 'NotAllowedError' })
      await vi.advanceTimersByTimeAsync(5000)
      await assertion
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('reports a failed unlock window and never invokes passkey signing while locked', async () => {
    let fixture = passkeyFixture()
    fixture.openUnlock.mockRejectedValue(new Error('native window failed'))
    await expect(bitwardenPasskeyPreflight(fixture)).rejects.toMatchObject({ name: 'NotAllowedError', message: 'Bitwarden could not open its unlock window. Open the extension and try again.' })
  })

  it('preserves the error name across Bitwarden\'s enumerable worker reply', async () => {
    let response = await bitwardenPasskeyPreflight(passkeyFixture()).catch(error => Object.assign({}, error, { message: error.message }))
    expect(response).toEqual({ name: 'NotAllowedError', message: 'Unlock Bitwarden and try passkey sign-in again.' })
  })

  it('upgrades an existing managed package and leaves an unpacked package unchanged', async () => {
    let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-passkey-package-'))
    try {
      let managed = path.join(directory, 'extension-packages', 'bitwarden-2026.6.1')
      let unpacked = path.join(directory, 'unpacked')
      for (let location of [managed, unpacked]) {
        await fs.mkdir(location, { recursive: true })
        await fs.writeFile(path.join(location, 'manifest.json'), JSON.stringify({ name: '__MSG_extName__', version: '2026.6.1' }))
        await fs.writeFile(path.join(location, 'background.js'), `${source};${passkeySource}`)
        await prepareBitwardenPackage(directory, location)
      }
      let upgraded = await fs.readFile(path.join(managed, 'background.js'), 'utf8')
      expect(upgraded).toContain('bmux-passkey-unlock-preflight')
      await prepareBitwardenPackage(directory, managed)
      expect(await fs.readFile(path.join(managed, 'background.js'), 'utf8')).toBe(upgraded)
      expect(await fs.readFile(path.join(unpacked, 'background.js'), 'utf8')).toBe(`${source};${passkeySource}`)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  it('runs the injected worker code without module globals and keeps the unlock window focused', async () => {
    let patched = patchBitwardenPasskeys(passkeySource)
    expect(patchBitwardenPasskeys(patched)).toBe(patched)
    let fixture = passkeyFixture()
    let sign = vi.fn(), focusTab = vi.fn(), focusWindow = vi.fn()
    let worker = vm.runInNewContext(`(function* (n,t,e,i) { ${patched} })`, {
      DOMException, setTimeout, clearTimeout,
      ad: { Unlocked: 2 }, chrome: { tabs: { get: fixture.resolveTab } },
      aN: { openPopout: fixture.openUnlock }, oN: 'auth_unlockExtension', YO: { focusTab, focusWindow },
    })
    let background = { authService: { getAuthStatus: fixture.authStatus } }
    let run = async () => {
      let iterate = worker.call(background, {}, fixture.tab, {}, sign)
      let step = iterate.next()
      while (!step.done) {
        let value
        try { value = await step.value }
        catch (error) { step = iterate.throw(error); continue }
        step = iterate.next(value)
      }
      return step.value
    }
    await Promise.all([expect(run()).rejects.toMatchObject({ name: 'NotAllowedError' }), expect(run()).rejects.toMatchObject({ name: 'NotAllowedError' })])
    expect(sign).not.toHaveBeenCalled()
    expect(focusTab).not.toHaveBeenCalled()
    expect(focusWindow).not.toHaveBeenCalled()
    expect(fixture.openUnlock).toHaveBeenCalledWith('popup/index.html#/login', { singleActionKey: 'auth_unlockExtension', senderWindowId: 4 })
    expect(fixture.openUnlock).toHaveBeenCalledOnce()
    let originalUnlock = 'openUnlock:tab=>aN.openPopout("popup/index.html#/login",{singleActionKey:oN,senderWindowId:tab.windowId})'
    let earlier = patched.replace(/openUnlock:tab=>\{if\(!this\.bmuxPasskeyUnlock\).*?return this\.bmuxPasskeyUnlock\}/, originalUnlock)
    expect(earlier).not.toBe(patched)
    expect(patchBitwardenPasskeys(earlier)).toBe(patched)
  })

  it('rejects an unknown pinned bundle instead of silently missing the patch', () => {
    expect(() => patchBitwardenPasskeys('changed bundle')).toThrow('passkey compatibility target was not found')
  })
})
