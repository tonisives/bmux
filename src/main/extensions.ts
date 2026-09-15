import { BrowserWindow } from 'electron'
import type { BaseWindow, Extension, Session, WebContents } from 'electron'
import type { ChromeExtensionOptions } from 'electron-chrome-extensions'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createExtensionCompatibility } from './extension-compatibility'
import { findExtension } from './extension-lookup'

type Entry = { profile: string; path: string; id?: string; error?: string }

export let createExtensions = (directory: string, options: (profile: string) => Omit<ChromeExtensionOptions, 'license' | 'session'>) => {
  let file = path.join(directory, 'extensions.json')
  let entries: Entry[] = []
  let registryError: string | undefined
  let sessions = new Map<string, Session>()
  let pending = new Map<string, Promise<void>>()
  let popups = new Map<string, BrowserWindow>()
  let compatibility = new Map<string, ReturnType<typeof createExtensionCompatibility>>()
  let tracked = new Map<WebContents, { profile: string; parent: BaseWindow; selected: boolean }>()
  let ensureCompatibility = (profile: string, session: Session) => {
    let host = compatibility.get(profile)
    if (host) return host
    host = createExtensionCompatibility(session, options(profile))
    compatibility.set(profile, host)
    for (let [contents, tab] of tracked) if (tab.profile === profile && !contents.isDestroyed()) host.track(contents, tab.parent, tab.selected)
    return host
  }
  let track = (profile: string, contents: WebContents, parent: BaseWindow, selected = false) => {
    if (!tracked.has(contents)) contents.once('destroyed', () => tracked.delete(contents))
    tracked.set(contents, { profile, parent, selected })
    compatibility.get(profile)?.track(contents, parent, selected)
  }
  let queue: Promise<unknown> = Promise.resolve()
  let ready = fs.readFile(file, 'utf8').then(text => {
    let value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.some(item => typeof item?.profile !== 'string' || typeof item?.path !== 'string' || !path.isAbsolute(item.path))) throw new Error('Invalid extensions.json')
    entries = value.map(item => ({ profile: item.profile, path: item.path }))
  }).catch(error => { if (error.code !== 'ENOENT') registryError = 'Could not read extensions.json; repair or remove it before changing installed extensions' })
  let serial = <T>(operation: () => Promise<T>) => {
    let next = queue.then(operation)
    queue = next.catch(() => undefined)
    return next
  }
  let persist = async () => {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(`${file}.tmp`, JSON.stringify(entries.map(({ profile, path }) => ({ profile, path })), null, 2), { mode: 0o600 })
    await fs.rename(`${file}.tmp`, file)
  }
  let attach = (profile: string, session: Session) => {
    let existing = pending.get(profile)
    if (existing) return existing
    sessions.set(profile, session)
    let loading = ready.then(async () => {
      if (entries.some(entry => entry.profile === profile)) ensureCompatibility(profile, session)
      for (let entry of entries.filter(entry => entry.profile === profile)) {
        try { entry.id = (await session.extensions.loadExtension(entry.path)).id }
        catch (error) { entry.error = error instanceof Error ? error.message : 'Extension could not be loaded' }
      }
    })
    pending.set(profile, loading)
    return loading
  }
  let getSession = async (profile: string) => {
    await ready
    await pending.get(profile)
    let session = sessions.get(profile)
    if (!session) throw new Error('Extension profile is not initialized')
    return session
  }
  let describe = (extension: Extension) => ({ id: extension.id, name: extension.name, version: extension.version, path: extension.path })
  let list = async (profile: string) => {
    let session = await getSession(profile)
    return { extensions: session.extensions.getAllExtensions().map(describe), errors: [...(registryError ? [{ path: file, error: registryError }] : []), ...entries.filter(entry => entry.profile === profile && entry.error).map(({ path, error }) => ({ path, error }))] }
  }
  let load = (profile: string, location: string) => serial(async () => {
    let session = await getSession(profile)
    if (registryError) throw new Error(registryError)
    if (!path.isAbsolute(location)) throw new Error('Use an absolute path to an unpacked extension directory')
    let canonical = await fs.realpath(location)
    let manifest = JSON.parse(await fs.readFile(path.join(canonical, 'manifest.json'), 'utf8'))
    if (![2, 3].includes(manifest.manifest_version)) throw new Error('Expected a Manifest V2 or V3 extension')
    ensureCompatibility(profile, session)
    let previous = entries.find(entry => entry.profile === profile && entry.path === canonical)
    if (previous?.id) {
      let extension = session.extensions.getExtension(previous.id)
      if (extension) return describe(extension)
    }
    let extension = await session.extensions.loadExtension(canonical)
    let entry = { profile, path: canonical, id: extension.id }
    let before = entries.slice()
    entries = entries.filter(item => item !== previous)
    entries.push(entry)
    try { await persist() } catch (error) { entries = before; session.extensions.removeExtension(extension.id); throw error }
    return describe(extension)
  })
  let remove = (profile: string, id: string) => serial(async () => {
    let session = await getSession(profile)
    if (registryError) throw new Error(registryError)
    let named = session.extensions.getAllExtensions().find(extension => extension.name.toLowerCase() === id.toLowerCase())
    let entry = entries.find(entry => entry.profile === profile && (entry.id === id || entry.path === id || entry.id === named?.id))
    if (!entry) throw new Error('Extension is not installed in this profile')
    let before = entries.slice()
    entries = entries.filter(item => item !== entry)
    try { await persist() } catch (error) { entries = before; throw error }
    let popup = popups.get(`${profile}:${entry.id}`)
    if (popup && !popup.isDestroyed()) popup.destroy()
    if (entry.id) session.extensions.removeExtension(entry.id)
    return { removed: id }
  })
  let open = async (profile: string, id: string, activate: boolean) => {
    let session = await getSession(profile)
    let all = session.extensions.getAllExtensions()
    let extension = findExtension(all, id)
    if (!extension) throw new Error('Extension is not installed in this profile')
    let manifest = extension.manifest as { action?: { default_popup?: string }; browser_action?: { default_popup?: string } }
    let popupPath = manifest.action?.default_popup ?? manifest.browser_action?.default_popup
    if (!popupPath) throw new Error('Extension has no popup')
    let origin = `chrome-extension://${extension.id}`
    let url = new URL(popupPath, `${origin}/`)
    if (url.protocol !== 'chrome-extension:' || url.hostname !== extension.id) throw new Error('Invalid extension popup URL')
    let skipBitwardenIntro = extension.name === 'Bitwarden Password Manager' && extension.version === '2026.6.1'
    // Bitwarden 2026.6.1's introductory carousel waits forever when Electron
    // closes its background state-write message port. The login route works,
    // and its auth guard sends returning users to their vault.
    if (skipBitwardenIntro) url.hash = '/login'
    let key = `${profile}:${extension.id}`
    let window = popups.get(key)
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: 420, height: 640, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false, show: false, title: extension.name, webPreferences: { session, nodeIntegration: false, contextIsolation: true, sandbox: true } })
      popups.set(key, window)
      window.on('closed', () => popups.delete(key))
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, target) => {
        let parsed = new URL(target)
        if (parsed.protocol !== 'chrome-extension:' || parsed.hostname !== extension.id) event.preventDefault()
      })
      try {
        await window.loadURL(url.href)
        if (skipBitwardenIntro) {
          await window.webContents.executeJavaScript("chrome.storage.local.set({ global_vaultBrowserIntroCarousel_introCarouselDismissed: true })")
          await window.loadURL(url.href)
        }
      } catch (error) { window.destroy(); throw error }
    }
    if (activate) { window.show(); window.focus() } else window.showInactive()
    return { opened: extension.id }
  }
  let close = () => { for (let popup of popups.values()) if (!popup.isDestroyed()) popup.destroy(); popups.clear() }
  return { attach, list, load, remove, open, close, track }
}
