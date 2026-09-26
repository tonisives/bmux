import { BrowserWindow } from 'electron'
import type { BaseWindow, Extension, Session, WebContents } from 'electron'
import type { ChromeExtensionOptions } from 'electron-chrome-extensions'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createExtensionCompatibility } from './extension-compatibility'
import { findExtension } from './extension-lookup'
import { extensionDetails } from '../shared/extension-details'

type Entry = { profile: string; path: string; id?: string; name?: string; version?: string; enabled?: boolean; error?: string }
type Manifest = { action?: { default_popup?: string }; browser_action?: { default_popup?: string }; options_ui?: { page?: string }; options_page?: string }
type ActiveTab = { contents: WebContents; parent: BaseWindow }

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
    if (!Array.isArray(value) || value.some(item => typeof item?.profile !== 'string' || typeof item?.path !== 'string' || !path.isAbsolute(item.path) || (item.enabled !== undefined && typeof item.enabled !== 'boolean') || ['id', 'name', 'version'].some(key => item[key] !== undefined && typeof item[key] !== 'string'))) throw new Error('Invalid extensions.json')
    entries = value.map(item => ({ profile: item.profile, path: item.path, id: item.id, name: item.name, version: item.version, enabled: item.enabled !== false }))
  }).catch(error => { if (error.code !== 'ENOENT') registryError = 'Could not read extensions.json; repair or remove it before changing installed extensions' })
  let serial = <T>(operation: () => Promise<T>) => {
    let next = queue.then(operation)
    queue = next.catch(() => undefined)
    return next
  }
  let persist = async () => {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(`${file}.tmp`, JSON.stringify(entries.map(({ profile, path, id, name, version, enabled }) => ({ profile, path, id, name, version, enabled: enabled !== false })), null, 2), { mode: 0o600 })
    await fs.rename(`${file}.tmp`, file)
  }
  let attach = (profile: string, session: Session) => {
    let existing = pending.get(profile)
    if (existing) return existing
    sessions.set(profile, session)
    let loading = ready.then(async () => {
      if (entries.some(entry => entry.profile === profile && entry.enabled !== false)) ensureCompatibility(profile, session)
      for (let entry of entries.filter(entry => entry.profile === profile && entry.enabled !== false)) {
        try {
          let extension = await session.extensions.loadExtension(entry.path)
          Object.assign(entry, { id: extension.id, name: extension.name, version: extension.version })
        }
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
  let describe = (extension: Extension) => {
    let manifest = extension.manifest as Manifest
    return { ...extensionDetails(manifest), id: extension.id, name: extension.name, version: extension.version, path: extension.path, enabled: true, hasPopup: !!(manifest.action?.default_popup ?? manifest.browser_action?.default_popup), hasOptions: !!(manifest.options_ui?.page ?? manifest.options_page) }
  }
  let list = async (profile: string) => {
    let session = await getSession(profile)
    let extensions = await Promise.all(entries.filter(entry => entry.profile === profile).map(async entry => {
      let loaded = entry.id ? session.extensions.getExtension(entry.id) : undefined
      if (loaded) return describe(loaded)
      let manifest = await fs.readFile(path.join(entry.path, 'manifest.json'), 'utf8').then(text => JSON.parse(text)).catch(() => null)
      if (typeof manifest?.description === 'string' && manifest.default_locale) {
        let message = /^__MSG_(.+)__$/.exec(manifest.description)
        if (message) {
          let messages = await fs.readFile(path.join(entry.path, '_locales', manifest.default_locale, 'messages.json'), 'utf8').then(text => JSON.parse(text)).catch(() => ({}))
          let localized = Object.entries(messages).find(([key]) => key.toLowerCase() === message[1].toLowerCase())?.[1] as { message?: string } | undefined
          manifest.description = localized?.message ?? ''
        }
      }
      return { ...extensionDetails(manifest), id: entry.id ?? entry.path, name: entry.name ?? manifest?.name ?? path.basename(entry.path), version: entry.version ?? manifest?.version ?? '', path: entry.path, enabled: entry.enabled !== false, hasPopup: false, hasOptions: false, error: entry.error }
    }))
    let paths = new Set(entries.filter(entry => entry.profile === profile).map(entry => entry.path))
    let available = await Promise.all([...new Set(entries.filter(entry => entry.profile !== profile && !paths.has(entry.path)).map(entry => entry.path))].map(async location => {
      let loaded = [...sessions.values()].flatMap(item => item.extensions.getAllExtensions()).find(extension => extension.path === location)
      if (loaded) return { name: loaded.name, version: loaded.version, path: location }
      try {
        let manifest = JSON.parse(await fs.readFile(path.join(location, 'manifest.json'), 'utf8')) as { name?: string; version?: string; default_locale?: string }
        let name = manifest.name ?? path.basename(location)
        let message = /^__MSG_(.+)__$/.exec(name)
        if (message && manifest.default_locale) {
          let messages = JSON.parse(await fs.readFile(path.join(location, '_locales', manifest.default_locale, 'messages.json'), 'utf8')) as Record<string, { message: string }>
          name = Object.entries(messages).find(([key]) => key.toLowerCase() === message[1].toLowerCase())?.[1].message ?? name
        }
        return { name, version: manifest.version ?? '', path: location }
      } catch { return null }
    }))
    return { extensions, available: available.filter(item => item !== null).sort((a, b) => a.name.localeCompare(b.name)), errors: [...(registryError ? [{ path: file, error: registryError }] : []), ...entries.filter(entry => entry.profile === profile && entry.error).map(({ path, error }) => ({ path, error }))] }
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
    let entry: Entry = { profile, path: canonical, id: extension.id, name: extension.name, version: extension.version, enabled: true }
    let before = entries.slice()
    entries = entries.filter(item => item !== previous)
    entries.push(entry)
    try { await persist() } catch (error) { entries = before; session.extensions.removeExtension(extension.id); throw error }
    return describe(extension)
  })
  let installedEntry = async (profile: string, id: string) => {
    let installed = (await list(profile)).extensions
    let found = installed.find(extension => extension.path === id) ?? findExtension(installed, id)
    let entry = found && entries.find(entry => entry.profile === profile && entry.path === found.path)
    if (!entry) throw new Error('Extension is not installed in this profile')
    return entry
  }
  let unload = (session: Session, entry: Entry) => {
    if (!entry.id) return
    for (let window of BrowserWindow.getAllWindows()) {
      if (window.webContents.session === session && window.webContents.getURL().startsWith(`chrome-extension://${entry.id}/`)) window.destroy()
    }
    session.extensions.removeExtension(entry.id)
  }
  let enable = (profile: string, id: string) => serial(async () => {
    let session = await getSession(profile)
    if (registryError) throw new Error(registryError)
    let entry = await installedEntry(profile, id)
    let loaded = entry.id ? session.extensions.getExtension(entry.id) : undefined
    if (loaded) return describe(loaded)
    ensureCompatibility(profile, session)
    let extension = await session.extensions.loadExtension(entry.path)
    let before = { ...entry }
    Object.assign(entry, { enabled: true, id: extension.id, name: extension.name, version: extension.version, error: undefined })
    try { await persist() } catch (error) { entries[entries.indexOf(entry)] = before; unload(session, { ...entry, id: extension.id }); throw error }
    return describe(extension)
  })
  let disable = (profile: string, id: string) => serial(async () => {
    let session = await getSession(profile)
    if (registryError) throw new Error(registryError)
    let entry = await installedEntry(profile, id)
    let before = { ...entry }
    entry.enabled = false
    entry.error = undefined
    try { await persist() } catch (error) { entries[entries.indexOf(entry)] = before; throw error }
    unload(session, entry)
    return { id: entry.id ?? entry.path, enabled: false }
  })
  let remove = (profile: string, id: string) => serial(async () => {
    let session = await getSession(profile)
    if (registryError) throw new Error(registryError)
    let entry = await installedEntry(profile, id)
    let before = entries.slice()
    entries = entries.filter(item => item !== entry)
    try { await persist() } catch (error) { entries = before; throw error }
    unload(session, entry)
    return { removed: id }
  })
  let open = async (profile: string, id: string, activate: boolean, activeTab?: ActiveTab, page: 'popup' | 'options' = 'popup') => {
    let session = await getSession(profile)
    let all = session.extensions.getAllExtensions()
    let extension = findExtension(all, id)
    if (!extension) throw new Error('Extension is not installed in this profile')
    let manifest = extension.manifest as Manifest
    let popupPath = page === 'options' ? manifest.options_ui?.page ?? manifest.options_page : manifest.action?.default_popup ?? manifest.browser_action?.default_popup
    if (!popupPath) throw new Error(`Extension has no ${page} page`)
    let origin = `chrome-extension://${extension.id}`
    let url = new URL(popupPath, `${origin}/`)
    if (url.protocol !== 'chrome-extension:' || url.hostname !== extension.id) throw new Error('Invalid extension page URL')
    let skipBitwardenIntro = page === 'popup' && extension.name === 'Bitwarden Password Manager' && extension.version === '2026.6.1'
    // Bitwarden 2026.6.1's introductory carousel waits forever when Electron
    // closes its background state-write message port. The login route works,
    // then its auth guard preserves the requested current-tab destination.
    if (skipBitwardenIntro) url.hash = '/login'
    if (activeTab && !activeTab.contents.isDestroyed()) track(profile, activeTab.contents, activeTab.parent, true)
    let key = `${profile}:${extension.id}:${page}`
    let window = popups.get(key)
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: page === 'options' ? 800 : 420, height: 640, useContentSize: true, resizable: page === 'options', maximizable: page === 'options', fullscreenable: false, show: false, title: extension.name, webPreferences: { session, nodeIntegration: false, contextIsolation: true, sandbox: true } })
      popups.set(key, window)
      window.on('closed', () => popups.delete(key))
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'w' || (!input.meta && !input.control) || input.alt || input.shift) return
        event.preventDefault()
        window?.close()
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, target) => {
        let parsed = new URL(target)
        if (parsed.protocol !== 'chrome-extension:' || parsed.hostname !== extension.id) event.preventDefault()
      })
    }
    try {
      await window.loadURL(url.href)
      if (skipBitwardenIntro) {
        await window.webContents.executeJavaScript("chrome.storage.local.set({ global_vaultBrowserIntroCarousel_introCarouselDismissed: true })")
        url.hash = '/tabs/current'
        await window.loadURL(url.href)
      }
    } catch (error) { window.destroy(); throw error }
    if (activate) { window.show(); window.focus() } else window.showInactive()
    return { opened: extension.id }
  }
  let close = () => { for (let popup of popups.values()) if (!popup.isDestroyed()) popup.destroy(); popups.clear() }
  return { attach, list, load, enable, disable, remove, open, close, track }
}
