import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 2026.7.0 and 2026.8.0 can sync encrypted ciphers but leave the decrypted
// vault empty for affected accounts. Keep the last known-good browser build
// until Bitwarden ships the upstream WASM decryption fix.
let version = '2026.6.1'
let releases: Record<string, { digest: string }> = {
  '2026.6.1': { digest: 'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e' },
  '2026.10.0': { digest: '7b9ec650b87dd8975e87a0e0bdd0c1f1a0fcf5b0a8da5ae759ec14cdffaad35d' },
}
let inlineNewItemPatch = 'bmux-inline-new-item-existing-popout-check'
let inlineNewItemNeedle = 'const d=chrome.runtime.getURL("popup/index.html"),h=(yield YO.tabsQuery({url:`${d}*`})).find(e=>{var t;return null===(t=e.url)||void 0===t?void 0:t.includes(`singleActionPopout=${o}`)});try{yield chrome.runtime.sendMessage({command:"reloadAddEditCipherData",data:{cipherId:i,cipherType:r}}),yield YO.updateWindowProperties(h.windowId,{focused:!0})}catch(e){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s})}'
let passkeyPatch = 'bmux-passkey-unlock-preflight'
let passkeyNeedle = 'try{return yield i(n,t,e)}finally{null!=t.id&&(yield YO.focusTab(t.id)),null!=t.windowId&&(yield YO.focusWindow(t.windowId))}'
let unlockNeedle = 'openUnlock:tab=>aN.openPopout("popup/index.html#/login",{singleActionKey:oN,senderWindowId:tab.windowId})'
let unlockSource = 'openUnlock:tab=>{if(!this.bmuxPasskeyUnlock)this.bmuxPasskeyUnlock=aN.openPopout("popup/index.html#/login",{singleActionKey:oN,senderWindowId:tab.windowId}).finally(()=>{this.bmuxPasskeyUnlock=void 0});return this.bmuxPasskeyUnlock}'

// These symbols are tied to checksum-pinned official bundles, not arbitrary builds.
let targets = (release: string) => {
  if (!Object.hasOwn(releases, release)) throw new Error('Unsupported Bitwarden release')
  let current = release === '2026.10.0'
  let adapt = (source: string) => current ? source.replaceAll('YO.', 'PU.').replaceAll('aN.', '$U.').replaceAll('oN', 'KU') : source
  return {
    inline: current ? adapt(inlineNewItemNeedle).replace('const d=', 'const u=').replace('${d}', '${u}') : inlineNewItemNeedle,
    passkey: adapt(passkeyNeedle), unlock: adapt(unlockNeedle), sharedUnlock: adapt(unlockSource),
    unlocked: current ? 'Hu.Unlocked' : 'ad.Unlocked', popup: current ? '$U' : 'aN',
  }
}

// Serialized into the pinned extension's worker. Keep this function self-contained.
export let bitwardenPasskeyPreflight = async ({ request, tab, authStatus, unlockedStatus, resolveTab, openUnlock }: {
  request: { mediation?: string }
  tab: { id: number; windowId: number }
  authStatus: () => Promise<number>
  unlockedStatus: number
  resolveTab: (id: number) => Promise<{ id: number; windowId: number }>
  openUnlock: (tab: { id: number; windowId: number }) => Promise<unknown>
}) => {
  // Bitwarden's worker copies enumerable error fields into its reply. An own
  // name survives that bridge and becomes a DOMException in the page script.
  let denied = (message: string) => Object.assign(new Error(message), { name: 'NotAllowedError' })
  let bounded = async <T,>(operation: () => Promise<T>, message: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(denied(message)), 5000)
      })])
    } catch { throw denied(message) }
    finally { clearTimeout(timer) }
  }
  let status = await bounded(authStatus, 'Bitwarden did not respond. Open the extension and try again.')
  // Electron's native message sender reports windowId 0 for WebContentsViews.
  // Resolve the requesting page through bmux's extension tab registry instead.
  let current = await bounded(() => resolveTab(tab.id), 'Bitwarden could not find the requesting page. Reload it and try again.')
  if (!current || current.id !== tab.id || !(current.windowId > 0)) throw denied('Bitwarden could not find the requesting page. Reload it and try again.')
  if (status === unlockedStatus) return { ...tab, ...current }
  // Conditional autofill runs without a click and must not open a window.
  if (request.mediation !== 'conditional') {
    await bounded(() => openUnlock(current), 'Bitwarden could not open its unlock window. Open the extension and try again.')
  }
  throw denied('Unlock Bitwarden and try passkey sign-in again.')
}

export let patchBitwardenPasskeys = (source: string, release = version) => {
  let target = targets(release)
  if (source.includes(passkeyPatch)) return source.replace(target.unlock, target.sharedUnlock)
  if (!source.includes(target.passkey)) throw new Error('Bitwarden passkey compatibility target was not found')
  // Amazon can start overlapping requests from its account menu and sign-in
  // button. Share window creation until its tab is visible to extension queries.
  let preflight = `t=yield (${bitwardenPasskeyPreflight.toString()})({request:n,tab:t,authStatus:()=>this.authService.getAuthStatus(),unlockedStatus:${target.unlocked},resolveTab:id=>chrome.tabs.get(id),${target.sharedUnlock}});/* ${passkeyPatch} */`
  return source.replace(target.passkey, `${preflight}${target.passkey}`)
}

export let patchBitwardenInlineNewItem = (source: string, release = version) => {
  let target = targets(release)
  if (source.includes(inlineNewItemPatch)) return source
  if (!source.includes(target.inline)) throw new Error('Bitwarden inline New item compatibility target was not found')
  let replacement = target.inline.replace(');try{', `);if(!h){yield ${target.popup}.openPopout(l,{singleActionKey:o,senderWindowId:s});/* ${inlineNewItemPatch} */return}try{`)
  return source.replace(target.inline, replacement)
}

// Serialized into the official worker. Optional account feature flags can stop
// emitting even while unlocked; keep field collection available in that case.
export let bitwardenTargetingRules = async ({ authStatus, unlockedStatus, lookup }: {
  authStatus: () => Promise<number>
  unlockedStatus: number
  lookup: () => Promise<unknown>
}) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => (await authStatus()) === unlockedStatus ? await lookup() : null)(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500) }),
    ])
  } catch { return null }
  finally { clearTimeout(timer) }
}

export let patchBitwardenLockedInline = (source: string, release = version) => {
  let target = targets(release)
  let marker = 'bmux-bounded-inline-targeting-rules'
  if (source.includes(marker)) return source
  let prefix = 'case"getUrlAutofillTargetingRules":'
  // Upgrade managed packages that already carry the locked-vault-only fix.
  let earlier = `${prefix}if((yield this.main.authService.getAuthStatus())!==${target.unlocked})return null;/* bmux-locked-inline-targeting-rules */`
  source = source.replace(earlier, prefix)
  let current = release === '2026.10.0'
  let needle = prefix + (current ? '{const e=yield this.resolveSenderFrameUrl(t);return yield this.main.domainSettingsService.getTargetingRulesForUrl(e)}' : 'return yield this.main.domainSettingsService.getTargetingRulesForUrl(t.url)')
  if (!source.includes(needle)) throw new Error('Bitwarden locked inline compatibility target was not found')
  let lookup = current ? 'async()=>this.main.domainSettingsService.getTargetingRulesForUrl(await this.resolveSenderFrameUrl(t))' : '()=>this.main.domainSettingsService.getTargetingRulesForUrl(t.url)'
  return source.replace(needle, `${prefix}return yield (${bitwardenTargetingRules.toString()})({authStatus:()=>this.main.authService.getAuthStatus(),unlockedStatus:${target.unlocked},lookup:${lookup}});/* ${marker} */`)
}

export let patchBitwardenPackage = async (directory: string, release = version) => {
  let background = path.join(directory, 'background.js')
  let source = await fs.readFile(background, 'utf8')
  let patched = patchBitwardenLockedInline(patchBitwardenPasskeys(patchBitwardenInlineNewItem(source, release), release), release)
  if (patched !== source) await fs.writeFile(background, patched)
  if (release === '2026.10.0') {
    // The intro guard runs before the login route. Dismiss it through the
    // extension's own storage API before loading the real popup, on old bmux too.
    let file = path.join(directory, 'manifest.json')
    let manifest = JSON.parse(await fs.readFile(file, 'utf8'))
    if (['popup/index.html', 'popup/index.html#/login', 'bmux-preview-login.html'].includes(manifest.action?.default_popup)) {
      await fs.writeFile(path.join(directory, 'bmux-preview-login.html'), '<!doctype html><title>Bitwarden preview</title><p>Opening Bitwarden</p><script src="bmux-preview-login.js"></script>')
      await fs.writeFile(path.join(directory, 'bmux-preview-login.js'), 'chrome.storage.local.set({global_vaultBrowserIntroCarousel_introCarouselDismissed:true},()=>{if(chrome.runtime.lastError){document.body.textContent="Could not initialize Bitwarden preview";return}location.replace(chrome.runtime.getURL("popup/index.html#/login"))})')
      manifest.action.default_popup = 'bmux-preview-login.html'
      await fs.writeFile(file, JSON.stringify(manifest, null, 2))
    }
  }
}

export let prepareBitwardenPackage = async (directory: string, location: string) => {
  // Only upgrade packages managed by bmux; leave unpacked user extensions alone.
  if (path.dirname(path.resolve(location)) !== path.resolve(directory, 'extension-packages') || !/^bitwarden(?:-|$)/.test(path.basename(location))) return
  let manifest = await fs.readFile(path.join(location, 'manifest.json'), 'utf8').then(JSON.parse)
  if (Object.hasOwn(releases, manifest.version) && manifest.name === '__MSG_extName__') await patchBitwardenPackage(location, manifest.version)
}

export let installBitwardenExtension = async (directory: string, installedPath?: string, release = version) => {
  let selected = Object.hasOwn(releases, release) ? releases[release] : undefined
  if (!selected) throw new Error('Unsupported Bitwarden release')
  let root = path.join(directory, 'extension-packages')
  let target = installedPath ? path.resolve(installedPath) : path.join(root, 'bitwarden')
  if (path.dirname(target) !== path.resolve(root) || !/^bitwarden(?:-|$)/.test(path.basename(target))) throw new Error('Existing Bitwarden package path is invalid')
  try {
    let manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'))
    if (manifest.version === release) { await patchBitwardenPackage(target, release); return target }
  } catch { /* First installation or an incomplete package. */ }
  await fs.mkdir(root, { recursive: true })
  let temporary = await fs.mkdtemp(path.join(root, '.bitwarden-'))
  let backup = `${temporary}-previous`
  let movedPrevious = false
  try {
    let response = await fetch(`https://github.com/bitwarden/clients/releases/download/browser-v${release}/dist-chrome-${release}.zip`, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Bitwarden download failed (${response.status})`)
    let archive = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(archive).digest('hex') !== selected.digest) throw new Error('Bitwarden download checksum did not match')
    let zip = path.join(temporary, 'extension.zip'), unpacked = path.join(temporary, 'unpacked')
    await fs.writeFile(zip, archive, { mode: 0o600 })
    await promisify(execFile)('/usr/bin/unzip', ['-q', zip, '-d', unpacked], { timeout: 30000 })
    await patchBitwardenPackage(unpacked, release)
    try { await fs.rename(target, backup); movedPrevious = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    try { await fs.rename(unpacked, target) } catch (error) {
      if (movedPrevious) await fs.rename(backup, target)
      throw error
    }
    if (movedPrevious) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
    return target
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}
