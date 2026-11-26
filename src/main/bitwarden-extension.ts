import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { patchBitwardenMemoryPort } from './bitwarden-memory-port'

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
let passkeyFocusPatch = 'bmux-passkey-reply-before-focus'
let passkeyNeedle = 'try{return yield i(n,t,e)}finally{null!=t.id&&(yield YO.focusTab(t.id)),null!=t.windowId&&(yield YO.focusWindow(t.windowId))}'
let unlockNeedle = 'openUnlock:tab=>aN.openPopout("popup/index.html#/login",{singleActionKey:oN,senderWindowId:tab.windowId})'
let unlockSource = 'openUnlock:tab=>{if(!this.bmuxPasskeyUnlock)this.bmuxPasskeyUnlock=aN.openPopout("popup/index.html#/login",{singleActionKey:oN,senderWindowId:tab.windowId}).finally(()=>{this.bmuxPasskeyUnlock=void 0});return this.bmuxPasskeyUnlock}'
let vaultSyncPatch = 'bmux-vault-refresh'
let vaultSyncCommand = 'bmuxRefreshVault'
let popupBundleTag = '<script defer="defer" src="../popup/main.js"></script>'
let passkeySavePatch = 'bmux-confirm-passkey-save'

// These symbols are tied to checksum-pinned official bundles, not arbitrary builds.
let targets = (release: string) => {
  if (!Object.hasOwn(releases, release)) throw new Error('Unsupported Bitwarden release')
  let current = release === '2026.10.0'
  let adapt = (source: string) => current ? source.replaceAll('YO.', 'PU.').replaceAll('aN.', '$U.').replaceAll('oN', 'KU') : source
  return {
    inline: current ? adapt(inlineNewItemNeedle).replace('const d=', 'const u=').replace('${d}', '${u}') : inlineNewItemNeedle,
    passkey: adapt(passkeyNeedle), unlock: adapt(unlockNeedle), sharedUnlock: adapt(unlockSource),
    focus: adapt('async tab=>{await YO.focusTab(tab.id);await YO.focusWindow(tab.windowId)}'),
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
  if (!source.includes(passkeyPatch)) {
    // Amazon can start overlapping requests from its account menu and sign-in
    // button. Share window creation until its tab is visible to extension queries.
    let preflight = `t=yield (${bitwardenPasskeyPreflight.toString()})({request:n,tab:t,authStatus:()=>this.authService.getAuthStatus(),unlockedStatus:${target.unlocked},resolveTab:id=>chrome.tabs.get(id),${target.sharedUnlock}});/* ${passkeyPatch} */`
    source = source.replace(target.passkey, `${preflight}${target.passkey}`)
  }
  source = source.replace(target.unlock, target.sharedUnlock)
  if (source.includes(passkeyFocusPatch)) return source
  if (!source.includes(target.passkey)) throw new Error('Bitwarden passkey compatibility target was not found')
  // Return the credential even if the original window closed or moved while
  // Bitwarden was open. Silent conditional requests do not change focus.
  let finish = `try{return yield i(n,t,e)}finally{if(n.mediation!=="conditional")setTimeout(()=>{void chrome.tabs.get(t.id).then(tab=>{if(tab?.windowId>0)return (${target.focus})(tab)}).catch(()=>{})},0)}/* ${passkeyFocusPatch} */`
  return source.replace(target.passkey, finish)
}

export let patchBitwardenConditionalAutofill = (source: string) => {
  let marker = 'bmux-conditional-passkeys-no-native-probe'
  if (source.includes(marker)) return source
  let race = /const response = yield Promise\.race\(\[\s*bitwardenResponse\(internalAbortControllers\[0\]\),\s*browserResponse\(internalAbortControllers\[1\]\),?\s*\]\);/
  if (!race.test(source)) throw new Error('Bitwarden conditional autofill compatibility target was not found')
  // Electron's native conditional path can request a USB touch on page load.
  // Keep silent autofill in Bitwarden; explicit native fallback stays available.
  return source.replace(race, `const response = yield bitwardenResponse(internalAbortControllers[0]);/* ${marker} */`)
}

// Serialized into the worker. Bitwarden checks the server's revision before
// downloading the vault. Share automatic calls from startup, alarms and popup.
export let bitwardenRefreshVault = async function (this: {
  bmuxVaultRefresh?: Promise<unknown>
  authService: { getAuthStatus: () => Promise<number> }
  syncService: { getLastSync: () => Promise<Date | null>; fullSync: (force: boolean) => Promise<unknown>; syncInProgress: boolean }
}, unlockedStatus: number, force: boolean, minAge: number) {
  if (this.bmuxVaultRefresh) return this.bmuxVaultRefresh
  let refresh = async () => {
    if (this.syncService.syncInProgress) return
    if (!force) {
      let lastSync = await this.syncService.getLastSync()
      if (lastSync && Date.now() - lastSync.getTime() < minAge) return
      if (await this.authService.getAuthStatus() !== unlockedStatus || this.syncService.syncInProgress) return
    }
    return this.syncService.fullSync(force)
  }
  this.bmuxVaultRefresh = refresh()
  try { return await this.bmuxVaultRefresh }
  finally { this.bmuxVaultRefresh = undefined }
}

export let patchBitwardenVaultSync = (source: string, release = version) => {
  let target = targets(release)
  if (source.includes(vaultSyncPatch)) return source
  let register = 'this.backgroundSyncService.register(()=>this.fullSync())'
  let sync = 'function*(e=!1){const t=yield this.syncService.getLastSync();let i=21600001;null!=t&&(i=(new Date).getTime()-t.getTime()),(e||i>=216e5)&&(yield this.syncService.fullSync(e))'
  if (!source.includes(register) || !source.includes(sync)) throw new Error('Bitwarden vault sync compatibility target was not found')
  let listener = `chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message?.command!==${JSON.stringify(vaultSyncCommand)}||sender.url?.split("#")[0]!==chrome.runtime.getURL("popup/index.html"))return;this.fullSync(false,30000).then(()=>respond(),()=>respond());return true})`
  return source.replace(register, `${register},${listener}`).replace(sync, `function*(e=!1,minAge=300000){return yield (${bitwardenRefreshVault.toString()}).call(this,${target.unlocked},e,minAge);/* ${vaultSyncPatch} */`)
}

export let patchBitwardenPasskeySave = (source: string) => {
  if (source.includes(passkeySavePatch)) return source
  let save = /yield this\.cipherService\.updateWithServer\((\w+),t\),(\w+)=(\w+)\.credentialId\}catch\(e\)\{throw (.{0,200}?\[Fido2Authenticator\] Aborting because of unknown error when creating credential:)/
  let errorReply = 'Promise.resolve(n).then(e=>i(e),e=>i({error:Object.assign(Object.assign({},e),{message:e.message})})).catch(this.logService.error)'
  if (!save.test(source) || !source.includes(errorReply)) throw new Error('Bitwarden passkey save compatibility target was not found')
  return source.replace(save, 'const saved=yield this.cipherService.updateWithServer($1,t);$2=$3.credentialId;if(!saved?.login?.fido2Credentials?.some(passkey=>passkey.credentialId===$2))throw new Error("Bitwarden did not store the passkey.");/* bmux-confirm-passkey-save */}catch(e){throw $4')
    .replace(errorReply, errorReply.replace('{message:e.message}', '{name:e.name,message:e.message}'))
}

let filterPasskeyItems = (source: string) => {
  let marker = 'bmux-editable-passkey-items'
  if (source.includes(marker)) return source
  let items = /(\.filter\(e=>e\.type===[\w$]+\.Login&&!e\.isDeleted)(\),this\.displayedCiphers=this\.ciphers\.filter\(n=>n\.login\.matchesUri\(t,i\)&&[\w$]+\.cipherHasNoOtherPasskeys)/
  if (!items.test(source)) throw new Error('Bitwarden passkey item picker compatibility target was not found')
  return source.replace(items, `$1&&e.edit&&e.viewPassword!==false/* ${marker} */$2`)
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
  let needle = prefix + (current ? '{const e=yield this.resolveSenderFrameUrl(t);return yield this.main.domainSettingsService.getTargetingRulesForUrl(e)}' : 'return yield this.main.domainSettingsService.getTargetingRulesForUrl(null!==(i=t.url)&&void 0!==i?i:null===(r=t.tab)||void 0===r?void 0:r.url)')
  if (!source.includes(needle)) throw new Error('Bitwarden locked inline compatibility target was not found')
  let lookup = current ? 'async()=>this.main.domainSettingsService.getTargetingRulesForUrl(await this.resolveSenderFrameUrl(t))' : '()=>this.main.domainSettingsService.getTargetingRulesForUrl(t.url??t.tab?.url)'
  return source.replace(needle, `${prefix}return yield (${bitwardenTargetingRules.toString()})({authStatus:()=>this.main.authService.getAuthStatus(),unlockedStatus:${target.unlocked},lookup:${lookup}});/* ${marker} */`)
}

// Serialized into the pinned worker. Build display data against a snapshot so
// older asynchronous work cannot overwrite the current menu's labels or count.
export let bitwardenPublishSuggestions = async function (this: {
  bmuxSuggestionRevision?: number
  inlineMenuListPort: unknown
  getInlineMenuCipherData: () => Promise<unknown>
  checkFocusedFieldHasValue: (tab: unknown) => Promise<boolean>
  shouldShowInlineMenuAccountCreation: () => boolean
  showPasskeysLabelsWithinInlineMenu: boolean
  currentInlineMenuCiphersCount: number
  postMessageToPort: (port: unknown, message: unknown) => void
}, tab: unknown, revision = this.bmuxSuggestionRevision) {
  let snapshot = Object.create(this), port = this.inlineMenuListPort
  let ciphers = await snapshot.getInlineMenuCipherData()
  let focusedFieldHasValue = await this.checkFocusedFieldHasValue(tab)
  if (revision !== this.bmuxSuggestionRevision || port !== this.inlineMenuListPort) return
  this.showPasskeysLabelsWithinInlineMenu = snapshot.showPasskeysLabelsWithinInlineMenu
  this.currentInlineMenuCiphersCount = snapshot.currentInlineMenuCiphersCount
  this.postMessageToPort(port, {
    command: 'updateAutofillInlineMenuListCiphers', ciphers,
    showInlineMenuAccountCreation: this.shouldShowInlineMenuAccountCreation(),
    showPasskeysLabels: this.showPasskeysLabelsWithinInlineMenu, focusedFieldHasValue,
  })
}

export let patchBitwardenSuggestions = (source: string, release = version) => {
  targets(release)
  let marker = 'bmux-recovering-suggestion-updates'
  if (source.includes(marker)) return source
  let current = release === '2026.10.0', async = current ? 'CR' : 'qN', tabs = current ? 'PU' : 'YO'
  let replacements: [string, string][] = [
    ['e=>this.handleOverlayCiphersUpdate(e)', 'e=>this.handleOverlayCiphersUpdate(e).catch(error=>{this.logService.error(error)})'],
    ['this.inlineMenuCiphers=new Map,this.updateOverlayCiphers$.next({updateAllCipherTypes:e,refocusField:t})', 'this.bmuxSuggestionRevision=(this.bmuxSuggestionRevision||0)+1,this.inlineMenuCiphers=new Map,this.updateOverlayCiphers$.next({updateAllCipherTypes:e,refocusField:t,bmuxRevision:this.bmuxSuggestionRevision})'],
    ['function*({updateAllCipherTypes:e,refocusField:t}){var i;const r=yield '+tabs+'.getTabFromCurrentWindowId();', 'function*({updateAllCipherTypes:e,refocusField:t,bmuxRevision}){var i;const r=yield '+tabs+'.getTabFromCurrentWindowId();if(bmuxRevision!==this.bmuxSuggestionRevision)return;'],
    ['const e=yield '+tabs+'.getTab(this.focusedFieldData.tabId);e&&this.closeInlineMenu', 'const e=yield '+tabs+'.getTab(this.focusedFieldData.tabId);if(bmuxRevision!==this.bmuxSuggestionRevision)return;e&&this.closeInlineMenu'],
    ['const s=yield this.getCipherViews(r,e);for(let e=0;e<s.length;e++)', 'const bmuxLookup=Object.create(this);bmuxLookup.cardAndIdentityCiphers=this.cardAndIdentityCiphers?new Set(this.cardAndIdentityCiphers):null;const s=yield bmuxLookup.getCipherViews(r,e);if(bmuxRevision!==this.bmuxSuggestionRevision)return;this.cardAndIdentityCiphers=bmuxLookup.cardAndIdentityCiphers;for(let e=0;e<s.length;e++)'],
    ['yield this.updateInlineMenuListCiphers(r),t&&', 'yield this.updateInlineMenuListCiphers(r,bmuxRevision),t&&bmuxRevision===this.bmuxSuggestionRevision&&'],
    ['updateInlineMenuListCiphers(e){return '+async+'(this,void 0,void 0,function*(){const t=yield this.getInlineMenuCipherData();this.postMessageToPort(this.inlineMenuListPort,{command:"updateAutofillInlineMenuListCiphers",ciphers:t,showInlineMenuAccountCreation:this.shouldShowInlineMenuAccountCreation(),showPasskeysLabels:this.showPasskeysLabelsWithinInlineMenu,focusedFieldHasValue:yield this.checkFocusedFieldHasValue(e)})})}', `updateInlineMenuListCiphers(e,t=this.bmuxSuggestionRevision){return (${bitwardenPublishSuggestions.toString()}).call(this,e,t)}`],
  ]
  for (let [needle, replacement] of replacements) {
    if (source.split(needle).length !== 2) throw new Error('Bitwarden suggestion compatibility target was not found')
    source = source.replace(needle, replacement)
  }
  return source + `\n/* ${marker} */`
}

export let patchBitwardenPackage = async (directory: string, release = version) => {
  let fido = path.join(directory, 'content', 'fido2-page-script.js')
  let fidoSource = await fs.readFile(fido, 'utf8')
  let fidoPatched = patchBitwardenConditionalAutofill(fidoSource)
  if (fidoPatched !== fidoSource) await fs.writeFile(fido, fidoPatched)
  let background = path.join(directory, 'background.js')
  let source = await fs.readFile(background, 'utf8')
  let patched = patchBitwardenInlineNewItem(source, release)
  patched = patchBitwardenPasskeys(patched, release)
  patched = patchBitwardenLockedInline(patched, release)
  patched = patchBitwardenSuggestions(patched, release)
  patched = patchBitwardenVaultSync(patched, release)
  patched = patchBitwardenPasskeySave(patched)
  if (patched !== source) await fs.writeFile(background, patched)
  let popupHtml = path.join(directory, 'popup', 'index.html')
  let html = await fs.readFile(popupHtml, 'utf8')
  if (!html.includes(`${vaultSyncPatch}.js`)) {
    if (!html.includes(popupBundleTag)) throw new Error('Bitwarden vault popup compatibility target was not found')
    let refreshScript = `if (!new URL(location.href).searchParams.has("uilocation")) void chrome.runtime.sendMessage({command:${JSON.stringify(vaultSyncCommand)}}).catch(() => {})\n`
    await fs.writeFile(path.join(directory, 'popup', `${vaultSyncPatch}.js`), refreshScript)
    await fs.writeFile(popupHtml, html.replace(popupBundleTag, `${popupBundleTag}<script defer src="${vaultSyncPatch}.js"></script>`))
  }
  let popup = path.join(directory, 'popup', 'main.js')
  let popupSource = await fs.readFile(popup, 'utf8')
  let popupPatched = filterPasskeyItems(patchBitwardenMemoryPort(popupSource, release))
  if (popupPatched !== popupSource) await fs.writeFile(popup, popupPatched)
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
