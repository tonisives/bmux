import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 2026.7.0 and 2026.8.0 can sync encrypted ciphers but leave the decrypted
// vault empty for affected accounts. Keep the last known-good browser build
// until Bitwarden ships the upstream WASM decryption fix.
let version = '2026.6.1'
let digest = 'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e'
let inlineNewItemPatch = 'bmux-inline-new-item-existing-popout-check'
let inlineNewItemNeedle = 'const d=chrome.runtime.getURL("popup/index.html"),h=(yield YO.tabsQuery({url:`${d}*`})).find(e=>{var t;return null===(t=e.url)||void 0===t?void 0:t.includes(`singleActionPopout=${o}`)});try{yield chrome.runtime.sendMessage({command:"reloadAddEditCipherData",data:{cipherId:i,cipherType:r}}),yield YO.updateWindowProperties(h.windowId,{focused:!0})}catch(e){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s})}'
let passkeyPatch = 'bmux-passkey-unlock-preflight'
let passkeyNeedle = 'try{return yield i(n,t,e)}finally{null!=t.id&&(yield YO.focusTab(t.id)),null!=t.windowId&&(yield YO.focusWindow(t.windowId))}'

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

export let patchBitwardenPasskeys = (source: string) => {
  if (source.includes(passkeyPatch)) return source
  if (!source.includes(passkeyNeedle)) throw new Error('Bitwarden passkey compatibility target was not found')
  let preflight = `t=yield (${bitwardenPasskeyPreflight.toString()})({request:n,tab:t,authStatus:()=>this.authService.getAuthStatus(),unlockedStatus:ad.Unlocked,resolveTab:id=>chrome.tabs.get(id),openUnlock:tab=>aN.openPopout("popup/index.html#/login",{singleActionKey:oN,senderWindowId:tab.windowId})});/* ${passkeyPatch} */`
  return source.replace(passkeyNeedle, `${preflight}${passkeyNeedle}`)
}

export let patchBitwardenInlineNewItem = (source: string) => {
  if (source.includes(inlineNewItemPatch)) return source
  if (!source.includes(inlineNewItemNeedle)) throw new Error('Bitwarden inline New item compatibility target was not found')
  let replacement = 'const d=chrome.runtime.getURL("popup/index.html"),h=(yield YO.tabsQuery({url:`${d}*`})).find(e=>{var t;return null===(t=e.url)||void 0===t?void 0:t.includes(`singleActionPopout=${o}`)});if(!h){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s});/* ' + inlineNewItemPatch + ' */return}try{yield chrome.runtime.sendMessage({command:"reloadAddEditCipherData",data:{cipherId:i,cipherType:r}}),yield YO.updateWindowProperties(h.windowId,{focused:!0})}catch(e){yield aN.openPopout(l,{singleActionKey:o,senderWindowId:s})}'
  return source.replace(inlineNewItemNeedle, replacement)
}

export let patchBitwardenPackage = async (directory: string) => {
  let background = path.join(directory, 'background.js')
  let source = await fs.readFile(background, 'utf8')
  let patched = patchBitwardenPasskeys(patchBitwardenInlineNewItem(source))
  if (patched !== source) await fs.writeFile(background, patched)
}

export let prepareBitwardenPackage = async (directory: string, location: string) => {
  // Only upgrade packages managed by bmux; leave unpacked user extensions alone.
  if (path.dirname(path.resolve(location)) !== path.resolve(directory, 'extension-packages') || !/^bitwarden(?:-|$)/.test(path.basename(location))) return
  let manifest = await fs.readFile(path.join(location, 'manifest.json'), 'utf8').then(JSON.parse)
  if (manifest.version === version && manifest.name === '__MSG_extName__') await patchBitwardenPackage(location)
}

export let installBitwardenExtension = async (directory: string, installedPath?: string) => {
  let root = path.join(directory, 'extension-packages')
  let target = installedPath ? path.resolve(installedPath) : path.join(root, 'bitwarden')
  if (path.dirname(target) !== path.resolve(root) || !/^bitwarden(?:-|$)/.test(path.basename(target))) throw new Error('Existing Bitwarden package path is invalid')
  try {
    let manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'))
    if (manifest.version === version) { await patchBitwardenPackage(target); return target }
  } catch { /* First installation or an incomplete package. */ }
  await fs.mkdir(root, { recursive: true })
  let temporary = await fs.mkdtemp(path.join(root, '.bitwarden-'))
  let backup = `${temporary}-previous`
  let movedPrevious = false
  try {
    let response = await fetch(`https://github.com/bitwarden/clients/releases/download/browser-v${version}/dist-chrome-${version}.zip`, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Bitwarden download failed (${response.status})`)
    let archive = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(archive).digest('hex') !== digest) throw new Error('Bitwarden download checksum did not match')
    let zip = path.join(temporary, 'extension.zip'), unpacked = path.join(temporary, 'unpacked')
    await fs.writeFile(zip, archive, { mode: 0o600 })
    await promisify(execFile)('/usr/bin/unzip', ['-q', zip, '-d', unpacked], { timeout: 30000 })
    await patchBitwardenPackage(unpacked)
    try { await fs.rename(target, backup); movedPrevious = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    try { await fs.rename(unpacked, target) } catch (error) {
      if (movedPrevious) await fs.rename(backup, target)
      throw error
    }
    if (movedPrevious) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
    return target
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}
