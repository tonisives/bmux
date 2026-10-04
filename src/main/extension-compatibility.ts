import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { ChromeExtensionOptions } from 'electron-chrome-extensions'
import type { BaseWindow, WebContents, Session, Extension } from 'electron'
import { createExtensionSessionStorage } from './extension-session-storage'
import { createHanzisizeCompatibility } from './hanzisize-extension'

type ExtensionEvent = { extension: Extension; sender: { getURL?: () => string; scriptURL?: string } }
type Internals = { ctx: {
  router: { apiHandler: () => (name: string, callback: (event: ExtensionEvent, ...args: any[]) => unknown, options?: { permission: string }) => void; getHandler: (name: string) => { callback: (event: ExtensionEvent, ...args: any[]) => unknown }; sendEvent: (id: string, name: string, ...args: unknown[]) => void }
  store: { tabs: Set<WebContents>; windows: Set<BaseWindow>; tabToWindow: WeakMap<WebContents, BaseWindow>; windowToActiveTab: WeakMap<BaseWindow, WebContents>; lastFocusedWindowId?: number; addWindow: (window: BaseWindow) => void; tabDetailsCache: Map<number, { active: boolean; windowId: number }>; windowDetailsCache: Map<number, unknown> }
} }

// Adapter for the pinned 4.9.0 package. The preload patch registers these API calls.
export let createExtensionCompatibility = (session: Session, options: Omit<ChromeExtensionOptions, 'license' | 'session'>) => {
  let syncing = false
  let api = new ElectronChromeExtensions({ ...options, selectTab: (tab, window) => { if (!syncing) options.selectTab?.(tab, window) }, session, license: 'GPL-3.0' })
  let dispose = createHanzisizeCompatibility(session)
  let { ctx } = api as unknown as Internals
  let storage = createExtensionSessionStorage()
  let handle = ctx.router.apiHandler()
  // The pinned package ignores currentWindow and can return a parked page first.
  let queryTabs = ctx.router.getHandler('tabs.query').callback
  handle('tabs.query', (event, properties: { currentWindow?: boolean } = {}) => {
    let tabs = queryTabs(event, properties) as { windowId: number }[]
    return typeof properties.currentWindow === 'boolean'
      ? tabs.filter(tab => (tab.windowId === ctx.store.lastFocusedWindowId) === properties.currentWindow)
      : tabs
  })
  // The pinned package ignores focused on windows.update; Bitwarden uses it to reopen an existing item window.
  let updateWindow = ctx.router.getHandler('windows.update').callback
  handle('windows.update', (event, id: number, properties: { focused?: boolean }) => {
    if (properties?.focused) {
      let windowId = id === -2 ? ctx.store.lastFocusedWindowId : id
      let window = [...ctx.store.windows].find(candidate => candidate.id === windowId && !candidate.isDestroyed())
      if (window) { window.show(); window.focus() }
    }
    return updateWindow(event, id, properties)
  })
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
        let active = ctx.store.windowToActiveTab.get(oldParent) === contents
        if (active) ctx.store.windowToActiveTab.delete(oldParent)
        // Closing a client parks its pages before the next reconciliation. The
        // old native window may already be destroyed; its close handler clears
        // the window cache, and reading its id here would abort page layout.
        if (!oldParent.isDestroyed()) ctx.store.windowDetailsCache.delete(oldParent.id)
        ctx.store.tabToWindow.set(contents, parent)
        ctx.store.addWindow(parent)
        // Opening an extension popup can move its page while browser focus is
        // elsewhere. Keep the selected page available to active-tab queries.
        if (active && !selected) {
          let previous = ctx.store.windowToActiveTab.get(parent)
          let previousDetails = previous && ctx.store.tabDetailsCache.get(previous.id)
          if (previousDetails) previousDetails.active = false
          ctx.store.windowToActiveTab.set(parent, contents)
          if (!oldParent.isDestroyed() && ctx.store.lastFocusedWindowId === oldParent.id) ctx.store.lastFocusedWindowId = parent.id
        }
        // The library drops onUpdated events when the previous snapshot is
        // absent. Keep its URL/loading state across native view reattachment.
        let details = ctx.store.tabDetailsCache.get(contents.id)
        if (details) details.windowId = parent.id
      }
      if (selected) {
        ctx.store.lastFocusedWindowId = parent.id
        api.selectTab(contents)
      }
      ctx.store.windowDetailsCache.delete(parent.id)
    } finally { syncing = false }
  }
  return { api, track, dispose }
}
