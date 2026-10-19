import { describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bitwardenPasskeyPreflight, bitwardenTargetingRules, installBitwardenExtension, patchBitwardenInlineNewItem, patchBitwardenLockedInline, patchBitwardenPasskeys, prepareBitwardenPackage } from '../src/main/bitwarden-extension'

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
        await fs.writeFile(path.join(location, 'background.js'), `${source};${passkeySource};case"getUrlAutofillTargetingRules":return yield this.main.domainSettingsService.getTargetingRulesForUrl(null!==(i=t.url)&&void 0!==i?i:null===(r=t.tab)||void 0===r?void 0:r.url)`)
        await fs.mkdir(path.join(location, 'popup'))
        await fs.writeFile(path.join(location, 'popup', 'main.js'), '/* bmux-reconnecting-memory-port-v2 */')
        await prepareBitwardenPackage(directory, location)
      }
      let upgraded = await fs.readFile(path.join(managed, 'background.js'), 'utf8')
      expect(upgraded).toContain('bmux-passkey-unlock-preflight')
      await prepareBitwardenPackage(directory, managed)
      expect(await fs.readFile(path.join(managed, 'background.js'), 'utf8')).toBe(upgraded)
      expect(await fs.readFile(path.join(unpacked, 'background.js'), 'utf8')).toBe(`${source};${passkeySource};case"getUrlAutofillTargetingRules":return yield this.main.domainSettingsService.getTargetingRulesForUrl(null!==(i=t.url)&&void 0!==i?i:null===(r=t.tab)||void 0===r?void 0:r.url)`)
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


describe('Bitwarden 2026.10.0 preview compatibility', () => {
  let release = '2026.10.0'
  let inline = source.replaceAll('YO.', 'PU.').replaceAll('aN.', '$U.').replace('const d=', 'const u=').replace('${d}', '${u}')
  let passkey = passkeySource.replaceAll('YO.', 'PU.')

  it('patches the official preview symbols and keeps both operations idempotent', () => {
    let patched = patchBitwardenInlineNewItem(inline, release)
    expect(patched).toContain('if(!h){yield $U.openPopout')
    expect(patchBitwardenInlineNewItem(patched, release)).toBe(patched)
    let startup = patchBitwardenPasskeys(passkey, release)
    expect(startup).toContain('unlockedStatus:Hu.Unlocked')
    expect(startup).toContain('yield PU.focusTab')
    expect(startup).toContain('singleActionKey:KU')
    expect(startup).toContain('$U.openPopout')
    expect(patchBitwardenPasskeys(startup, release)).toBe(startup)
  })

  it('rejects unrecognised versions and mismatched preview bundles', () => {
    expect(() => patchBitwardenPasskeys(passkey, 'unknown')).toThrow('Unsupported Bitwarden release')
    expect(() => patchBitwardenInlineNewItem(source, release)).toThrow('compatibility target was not found')
  })
})


it('leaves the existing package intact when a preview download has the wrong checksum', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-bitwarden-preview-'))
  let target = path.join(directory, 'extension-packages', 'bitwarden-preview')
  let fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid archive'))
  try {
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify({ version: '2026.6.1' }))
    await fs.writeFile(path.join(target, 'background.js'), 'existing package')
    await expect(installBitwardenExtension(directory, target, '2026.10.0')).rejects.toThrow('checksum did not match')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('browser-v2026.10.0/dist-chrome-2026.10.0.zip'), expect.anything())
    expect(await fs.readFile(path.join(target, 'background.js'), 'utf8')).toBe('existing package')
    expect(await fs.readdir(path.dirname(target))).toEqual(['bitwarden-preview'])
    await expect(installBitwardenExtension(directory, target, 'toString')).rejects.toThrow('Unsupported Bitwarden release')
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    fetch.mockRestore()
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('executes the preview passkey preflight with the preview worker symbols', async () => {
  let fixture = passkeyFixture()
  let patched = patchBitwardenPasskeys(passkeySource.replaceAll('YO.', 'PU.'), '2026.10.0')
  let sign = vi.fn()
  let worker = vm.runInNewContext(`(function* (n,t,e,i) { ${patched} })`, {
    setTimeout, clearTimeout, Hu: { Unlocked: 2 },
    chrome: { tabs: { get: fixture.resolveTab } },
    $U: { openPopout: fixture.openUnlock }, KU: 'auth_unlockExtension', PU: {},
  })
  let iterate = worker.call({ authService: { getAuthStatus: fixture.authStatus } }, {}, fixture.tab, {}, sign)
  let run = async () => {
    let step = iterate.next()
    while (!step.done) {
      try { step = iterate.next(await step.value) }
      catch (error) { step = iterate.throw(error) }
    }
    return step.value
  }
  await expect(run()).rejects.toMatchObject({ name: 'NotAllowedError' })
  expect(sign).not.toHaveBeenCalled()
  expect(fixture.openUnlock).toHaveBeenCalledWith('popup/index.html#/login', { singleActionKey: 'auth_unlockExtension', senderWindowId: 4 })
})

for (let release of ['2026.6.1', '2026.10.0']) describe(`Bitwarden ${release} locked inline targeting`, () => {
  let original = release === '2026.10.0' ? 'case"getUrlAutofillTargetingRules":{const e=yield this.resolveSenderFrameUrl(t);return yield this.main.domainSettingsService.getTargetingRulesForUrl(e)}' : 'case"getUrlAutofillTargetingRules":return yield this.main.domainSettingsService.getTargetingRulesForUrl(null!==(i=t.url)&&void 0!==i?i:null===(r=t.tab)||void 0===r?void 0:r.url)'
  let patched = patchBitwardenLockedInline(original, release)
  it.each([0, 1, 2])('handles auth status %s without waiting for locked feature flags', async status => {
    let lookup = vi.fn(async () => [{ selector: '#username' }])
    let handle = vm.runInNewContext(`(function* (command,t) { switch(command) { ${patched} } })`, { ad: { Unlocked: 2 }, Hu: { Unlocked: 2 }, setTimeout, clearTimeout })
    let iterator = handle.call({ resolveSenderFrameUrl: async (sender: { url: string }) => sender.url, main: { authService: { getAuthStatus: async () => status }, domainSettingsService: { getTargetingRulesForUrl: lookup } } }, 'getUrlAutofillTargetingRules', { url: 'https://example.test/login' })
    let step = iterator.next()
    while (!step.done) step = iterator.next(await step.value)
    if (status === 2) {
      expect(step.value).toEqual([{ selector: '#username' }])
      expect(lookup).toHaveBeenCalledWith('https://example.test/login')
    } else {
      expect(step.value).toBeNull()
      expect(lookup).not.toHaveBeenCalled()
    }
  })
  it('is idempotent and rejects changed upstream code', () => {
    expect(patchBitwardenLockedInline(patched, release)).toBe(patched)
    expect(() => patchBitwardenLockedInline('changed bundle', release)).toThrow('locked inline compatibility target was not found')
  })
})

describe('bounded Bitwarden field targeting', () => {
  it.each(['authStatus', 'lookup'] as const)('falls back to field heuristics when %s stalls while unlocked', async operation => {
    vi.useFakeTimers()
    try {
      let fixture = { authStatus: vi.fn(async () => 2), unlockedStatus: 2, lookup: vi.fn(async (): Promise<unknown> => []) }
      fixture[operation].mockImplementation(() => new Promise<never>(() => undefined))
      let pending = bitwardenTargetingRules(fixture)
      await vi.advanceTimersByTimeAsync(1500)
      await expect(pending).resolves.toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it.each([{ rules: [] }, { rules: [{ selector: '#account' }] }])('preserves an immediate rule response: %j', async ({ rules }) => {
    await expect(bitwardenTargetingRules({ authStatus: async () => 2, unlockedStatus: 2, lookup: async () => rules })).resolves.toEqual(rules)
  })

  it('falls back after a rule lookup error', async () => {
    await expect(bitwardenTargetingRules({ authStatus: async () => 2, unlockedStatus: 2, lookup: async () => { throw new Error('feature flags unavailable') } })).resolves.toBeNull()
  })

  it.each(['2026.6.1', '2026.10.0'])('upgrades the earlier locked-only patch for %s', release => {
    let unlocked = release === '2026.6.1' ? 'ad.Unlocked' : 'Hu.Unlocked'
    let branch = release === '2026.6.1' ? 'return yield this.main.domainSettingsService.getTargetingRulesForUrl(null!==(i=t.url)&&void 0!==i?i:null===(r=t.tab)||void 0===r?void 0:r.url)' : '{const e=yield this.resolveSenderFrameUrl(t);return yield this.main.domainSettingsService.getTargetingRulesForUrl(e)}'
    let earlier = `case"getUrlAutofillTargetingRules":if((yield this.main.authService.getAuthStatus())!==${unlocked})return null;/* bmux-locked-inline-targeting-rules */${branch}`
    let patched = patchBitwardenLockedInline(earlier, release)
    expect(patched).toContain('bmux-bounded-inline-targeting-rules')
    expect(patched).not.toContain('bmux-locked-inline-targeting-rules')
    expect(patchBitwardenLockedInline(patched, release)).toBe(patched)
  })
})
