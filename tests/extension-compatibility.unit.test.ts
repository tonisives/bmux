import { expect, test, vi } from 'vitest'
import type { BaseWindow, Session, WebContents } from 'electron'
import { createExtensionCompatibility } from '../src/main/extension-compatibility'
vi.mock('../src/main/hanzisize-extension', () => ({ createHanzisizeCompatibility: () => vi.fn() }))

let fixture = vi.hoisted(() => ({ store: {
  tabToWindow: new WeakMap(), windowToActiveTab: new WeakMap(),
  windowDetailsCache: new Map(), tabDetailsCache: new Map(),
  addWindow: vi.fn(), lastFocusedWindowId: undefined as number | undefined,
}, selectTab: vi.fn(), handle: vi.fn(), queryTabs: vi.fn() }))
vi.mock('electron-chrome-extensions', () => ({ ElectronChromeExtensions: class {
  ctx = { store: fixture.store, router: { apiHandler: () => fixture.handle, getHandler: (name: string) => ({ callback: name === 'tabs.query' ? fixture.queryTabs : vi.fn() }) } }
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

test('current-window queries exclude active pages parked in another native window', () => {
  fixture.handle.mockClear()
  fixture.store.lastFocusedWindowId = 2
  let parked = { id: 1, windowId: 1, active: true }
  let selected = { id: 2, windowId: 2, active: true }
  fixture.queryTabs.mockReturnValue([parked, selected])
  createExtensionCompatibility({ extensions: { on: vi.fn() } } as unknown as Session, {})
  let query = fixture.handle.mock.calls.find(([name]) => name === 'tabs.query')![1]
  expect(query({}, { active: true, currentWindow: true })).toEqual([selected])
  expect(query({}, { currentWindow: false })).toEqual([parked])
  expect(query({}, {})).toEqual([parked, selected])
})

test('moving the selected page while an extension popup is focused preserves active-tab queries', () => {
  let oldParent = { id: 4, isDestroyed: () => false } as BaseWindow
  let parent = { id: 5, isDestroyed: () => false } as BaseWindow
  let contents = { id: 6 } as WebContents
  let previous = { id: 7 } as WebContents
  fixture.store.tabToWindow.set(contents, oldParent)
  fixture.store.windowToActiveTab.set(oldParent, contents)
  fixture.store.windowToActiveTab.set(parent, previous)
  fixture.store.tabDetailsCache.set(previous.id, { active: true })
  fixture.store.lastFocusedWindowId = oldParent.id
  fixture.selectTab.mockClear()
  let compatibility = createExtensionCompatibility({ extensions: { on: vi.fn() } } as unknown as Session, {})
  compatibility.track(contents, parent)
  expect(fixture.store.windowToActiveTab.has(oldParent)).toBe(false)
  expect(fixture.store.windowToActiveTab.get(parent)).toBe(contents)
  expect(fixture.store.lastFocusedWindowId).toBe(parent.id)
  expect(fixture.store.tabDetailsCache.has(previous.id)).toBe(false)
  expect(fixture.selectTab).not.toHaveBeenCalled()
})
