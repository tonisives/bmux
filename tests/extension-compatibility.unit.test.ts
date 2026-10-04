import { expect, test, vi } from 'vitest'
import type { BaseWindow, Session, WebContents } from 'electron'
import { createExtensionCompatibility } from '../src/main/extension-compatibility'

let fixture = vi.hoisted(() => ({ store: {
  tabToWindow: new WeakMap(), windowToActiveTab: new WeakMap(),
  windowDetailsCache: new Map(), tabDetailsCache: new Map(),
  addWindow: vi.fn(), lastFocusedWindowId: undefined as number | undefined,
}, selectTab: vi.fn() }))
vi.mock('electron-chrome-extensions', () => ({ ElectronChromeExtensions: class {
  ctx = { store: fixture.store, router: { apiHandler: () => vi.fn(), getHandler: () => ({ callback: vi.fn() }) } }
  selectTab = fixture.selectTab
} }))

test('extension tracking moves a surviving page away from a destroyed window', () => {
  let oldParent = { isDestroyed: () => true, get id() { throw new Error('Object has been destroyed') } } as unknown as BaseWindow
  let parent = { id: 2, isDestroyed: () => false } as BaseWindow
  let contents = { id: 3 } as WebContents
  fixture.store.tabToWindow.set(contents, oldParent)
  fixture.store.windowToActiveTab.set(oldParent, contents)
  let compatibility = createExtensionCompatibility({ extensions: { on: vi.fn() } } as unknown as Session, {})
  compatibility.track(contents, parent, true)
  expect(fixture.store.tabToWindow.get(contents)).toBe(parent)
  expect(fixture.store.windowToActiveTab.has(oldParent)).toBe(false)
  expect(fixture.store.addWindow).toHaveBeenCalledWith(parent)
  expect(fixture.selectTab).toHaveBeenCalledWith(contents)
  expect(fixture.store.lastFocusedWindowId).toBe(2)
})

test('moving the selected page while an extension popup is focused preserves active-tab queries', () => {
  let oldParent = { id: 4, isDestroyed: () => false } as BaseWindow
  let parent = { id: 5, isDestroyed: () => false } as BaseWindow
  let contents = { id: 6 } as WebContents
  fixture.store.tabToWindow.set(contents, oldParent)
  fixture.store.windowToActiveTab.set(oldParent, contents)
  fixture.store.lastFocusedWindowId = oldParent.id
  fixture.selectTab.mockClear()
  let compatibility = createExtensionCompatibility({ extensions: { on: vi.fn() } } as unknown as Session, {})
  compatibility.track(contents, parent)
  expect(fixture.store.windowToActiveTab.has(oldParent)).toBe(false)
  expect(fixture.store.windowToActiveTab.get(parent)).toBe(contents)
  expect(fixture.store.lastFocusedWindowId).toBe(parent.id)
  expect(fixture.selectTab).not.toHaveBeenCalled()
})
