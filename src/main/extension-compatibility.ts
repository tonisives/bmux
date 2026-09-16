import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { ChromeExtensionOptions } from 'electron-chrome-extensions'
import type { BaseWindow, WebContents, Session, Extension } from 'electron'
import { createExtensionSessionStorage } from './extension-session-storage'

type ExtensionEvent = { extension: Extension; sender: { getURL?: () => string; scriptURL?: string } }
type Internals = { ctx: {
  router: { apiHandler: () => (name: string, callback: (event: ExtensionEvent, ...args: any[]) => unknown, options: { permission: string }) => void; sendEvent: (id: string, name: string, ...args: unknown[]) => void }
  store: { tabs: Set<WebContents>; tabToWindow: WeakMap<WebContents, BaseWindow>; windowToActiveTab: WeakMap<BaseWindow, WebContents>; lastFocusedWindowId?: number; addWindow: (window: BaseWindow) => void; tabDetailsCache: Map<number, unknown>; windowDetailsCache: Map<number, unknown> }
} }

// Adapter for the pinned 4.9.0 package. The preload patch registers these API calls.
export let createExtensionCompatibility = (session: Session, options: Omit<ChromeExtensionOptions, 'license' | 'session'>) => {
  let syncing = false
  let api = new ElectronChromeExtensions({ ...options, selectTab: (tab, window) => { if (!syncing) options.selectTab?.(tab, window) }, session, license: 'GPL-3.0' })
  let { ctx } = api as unknown as Internals
  let storage = createExtensionSessionStorage()
  let handle = ctx.router.apiHandler()
  let register = (name: string, callback: (id: string, ...args: any[]) => unknown) => handle(`storage.session.${name}`, (event, ...args) => {
    let url = new URL(event.sender.getURL?.() ?? event.sender.scriptURL ?? 'about:blank')
    if (url.protocol !== 'chrome-extension:' || url.hostname !== event.extension.id) throw new Error('Session storage is restricted to trusted extension contexts')
    return callback(event.extension.id, ...args)
  }, { permission: 'storage' })
  let changed = (id: string, changes: Record<string, unknown>) => {
    if (Object.keys(changes).length) ctx.router.sendEvent(id, 'storage.session.onChanged', changes)
  }
  register('get', storage.get)
  register('getKeys', storage.keys)
  register('getBytesInUse', storage.bytes)
  register('set', (id, items) => changed(id, storage.update(id, items)))
  register('remove', (id, keys) => changed(id, storage.update(id, {}, typeof keys === 'string' ? [keys] : keys)))
  register('clear', id => changed(id, storage.clear(id)))
  register('setAccessLevel', (_id, details) => { if (details?.accessLevel !== 'TRUSTED_CONTEXTS') throw new Error('Only TRUSTED_CONTEXTS session storage is supported') })
  session.extensions.on('extension-unloaded', (_event, extension) => storage.unload(extension.id))
  let track = (contents: WebContents, parent: BaseWindow, selected = false) => {
    syncing = true
    try {
      let oldParent = ctx.store.tabToWindow.get(contents)
      if (!oldParent) api.addTab(contents, parent)
      else if (oldParent !== parent) {
        if (ctx.store.windowToActiveTab.get(oldParent) === contents) ctx.store.windowToActiveTab.delete(oldParent)
        ctx.store.windowDetailsCache.delete(oldParent.id)
        ctx.store.tabToWindow.set(contents, parent)
        ctx.store.addWindow(parent)
        ctx.store.tabDetailsCache.delete(contents.id)
      }
      if (selected) {
        ctx.store.lastFocusedWindowId = parent.id
        api.selectTab(contents)
      }
      ctx.store.windowDetailsCache.delete(parent.id)
    } finally { syncing = false }
  }
  return { api, track }
}
