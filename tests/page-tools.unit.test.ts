import { test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import type { WebContents } from 'electron'
import { parseBrowserSettings } from '../src/main/browser-config'
import { createPageTools } from '../src/main/page-tools'

let fixture = async (adblock?: () => boolean | undefined) => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-page-tools-'))
  let css = '.custom { color: red !important }', ads = '.ad { display: none !important }'
  fs.writeFileSync(path.join(directory, 'style.css'), css)
  let settings = parseBrowserSettings({ userscripts: [{ id: 'style', file: 'style.css', enabled: true, matches: ['https://page.test/*'] }] })
  let url = 'https://page.test/first', sheets = new Map<string, string>(), registrations = new Map<string, Record<string, any>>(), sequence = 0
  let sendCommand = vi.fn(async (method: string, params: Record<string, any> = {}): Promise<any> => {
    if (method === 'CSS.createStyleSheet') return { styleSheetId: String(++sequence) }
    if (method === 'CSS.setStyleSheetText') { if (params.text) sheets.set(params.styleSheetId, params.text); else sheets.delete(params.styleSheetId); return {} }
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url } } }
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'main' } }
    if (method === 'Target.getTargets') return { targetInfos: [] }
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
    if (method === 'Runtime.evaluate') return { result: { value: { ids: [], classes: ['ad'] } } }
    if (method === 'Page.addScriptToEvaluateOnNewDocument') { let identifier = String(++sequence); registrations.set(identifier, params); return { identifier } }
    if (method === 'Page.removeScriptToEvaluateOnNewDocument') { registrations.delete(params.identifier); return {} }
    return {}
  })
  let contents = Object.assign(new EventEmitter(), {
    debugger: Object.assign(new EventEmitter(), { isAttached: () => true, detach: vi.fn(), sendCommand }),
    mainFrame: { framesInSubtree: [] }, isDestroyed: () => false, getURL: () => url,
    insertCSS: vi.fn(async (source: string) => { let key = String(++sequence); sheets.set(key, source); return key }),
    removeInsertedCSS: vi.fn(async (key: string) => { sheets.delete(key) }),
  }) as unknown as WebContents
  let tools = createPageTools({ directory, settings: () => settings, changed: () => undefined, visible: () => false, adblock, styles: () => ads })
  await tools.attach('tab', 'profile_default', contents, false)
  await tools.reload()
  return {
    contents, tools, sheets, css, ads, directory, settings, registrations, sendCommand,
    start: (sameDocument = false) => contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: sameDocument }, 'https://page.test/next', sameDocument, true),
    commit: () => { url = 'https://page.test/next'; sheets.clear(); contents.emit('did-navigate', {}, url, 200, 'OK'); contents.emit('dom-ready') },
    close: () => { tools.close(); fs.rmSync(directory, { recursive: true, force: true }) },
  }
}

test('removes old userscripts after an interrupted registration refresh', async () => {
  let { tools, directory, settings, registrations, sendCommand, close } = await fixture()
  try {
    fs.writeFileSync(path.join(directory, 'early.js'), "globalThis.earlyFlag = 'before-inline'")
    settings.userscripts.push(...parseBrowserSettings({ userscripts: [{ id: 'early', file: 'early.js', enabled: true, runAt: 'document-start', matches: ['https://page.test/*'] }] }).userscripts)
    await tools.reload()
    let original = sendCommand.getMockImplementation()!, interrupted = false
    sendCommand.mockImplementation(async (method, params = {}) => {
      if (method === 'Page.removeScriptToEvaluateOnNewDocument' && !interrupted) { interrupted = true; throw new Error('Renderer changed during refresh') }
      return original(method, params)
    })
    fs.writeFileSync(path.join(directory, 'early.js'), "globalThis.earlyFlag = 'changed'")
    await tools.reload()
    expect(tools.error('tab')).toContain('could not refresh')
    settings.userscripts.find(script => script.id === 'early')!.enabled = false
    await tools.reload()
    expect(tools.error('tab')).toBeUndefined()
    let document = vm.createContext({ location: { protocol: 'https:', href: 'https://page.test/next' } })
    document.window = document; document.top = document
    for (let registration of registrations.values()) if (!registration.worldName) vm.runInContext(registration.source, document)
    expect(document.earlyFlag).toBeUndefined()
    expect(registrations.size).toBe(3)
  } finally { close() }
})

test.each(['Page.removeScriptToEvaluateOnNewDocument', 'Page.createIsolatedWorld'])('updates user CSS even when %s fails during refresh', async method => {
  let { tools, directory, sheets, css, settings, sendCommand, close } = await fixture()
  try {
    let original = sendCommand.getMockImplementation()!
    sendCommand.mockImplementation(async (command, params = {}) => {
      if (command === method) throw new Error('Renderer changed during refresh')
      return original(command, params)
    })
    let updated = '.custom { color: green !important }'
    fs.writeFileSync(path.join(directory, 'style.css'), updated)
    fs.writeFileSync(path.join(directory, 'early.js'), 'globalThis.changed = true')
    settings.userscripts.push(...parseBrowserSettings({ userscripts: [{ id: 'early', file: 'early.js', enabled: true, matches: ['https://page.test/*'] }] }).userscripts)
    await tools.reload()
    expect([...sheets.values()]).toContain(updated)
    expect([...sheets.values()]).not.toContain(css)
    expect(tools.error('tab')).toContain('could not refresh')
    sendCommand.mockImplementation(original)
    await tools.reload()
    expect(tools.error('tab')).toBeUndefined()
    expect([...sheets.values()].filter(source => source === updated)).toHaveLength(1)
  } finally { close() }
})

test('preserves installed scripts across CSS edits and duplicate watcher refreshes', async () => {
  let { contents, tools, directory, registrations, sendCommand, sheets, close } = await fixture()
  try {
    let installed = [...registrations.entries()]
    sendCommand.mockClear()
    let updated = '.custom { color: green !important }'
    fs.writeFileSync(path.join(directory, 'style.css'), updated)
    await tools.reload()
    await tools.reload()
    expect([...sheets.values()]).toContain(updated)
    expect([...registrations.entries()]).toEqual(installed)
    expect(sendCommand.mock.calls.some(([method]) => method === 'Page.removeScriptToEvaluateOnNewDocument' || method === 'Page.addScriptToEvaluateOnNewDocument')).toBe(false)
    // A new debugger session must still install its own registrations.
    registrations.clear()
    contents.debugger.emit('detach', {}, 'test session reset')
    await tools.reload()
    expect(registrations.size).toBe(3)
    expect(sendCommand.mock.calls.some(([method]) => method === 'Page.addScriptToEvaluateOnNewDocument')).toBe(true)
  } finally { close() }
})

test('finishes registration cleanup when Chromium already removed a script', async () => {
  let { tools, directory, settings, registrations, sendCommand, close } = await fixture()
  try {
    fs.writeFileSync(path.join(directory, 'early.js'), "globalThis.earlyFlag = 'before-inline'")
    settings.userscripts.push(...parseBrowserSettings({ userscripts: [{ id: 'early', file: 'early.js', enabled: true, runAt: 'document-start', matches: ['https://page.test/*'] }] }).userscripts)
    await tools.reload()
    let original = sendCommand.getMockImplementation()!, missing = false
    sendCommand.mockImplementation(async (method, params = {}) => {
      let response = await original(method, params)
      if (method === 'Page.removeScriptToEvaluateOnNewDocument' && !missing) {
        missing = true
        throw new Error('Script not found')
      }
      return response
    })
    settings.userscripts.find(script => script.id === 'early')!.enabled = false
    await tools.reload()
    expect(tools.error('tab')).toBeUndefined()
    expect(registrations.size).toBe(3)
    let document = vm.createContext({ location: { protocol: 'https:', href: 'https://page.test/next' } })
    document.window = document; document.top = document
    for (let registration of registrations.values()) if (!registration.worldName) vm.runInContext(registration.source, document)
    expect(document.earlyFlag).toBeUndefined()
  } finally { close() }
})

test('reapplies styles when a settings refresh finishes in the outgoing document', async () => {
  let { tools, sheets, css, ads, start, commit, close } = await fixture()
  try {
    start()
    // A slow response leaves the outgoing document alive during this refresh.
    await tools.reload()
    expect([...sheets.values()]).toContain(css)
    commit()
    await tools.reload()
    expect([...sheets.values()].sort()).toEqual([css, ads].sort())
  } finally { close() }
})

test('discards an outgoing document style insertion that resolves after navigation commits', async () => {
  let { contents, tools, sheets, css, ads, start, commit, close } = await fixture()
  let insert = vi.mocked(contents.insertCSS), original = insert.getMockImplementation()!
  let release: () => void = () => undefined, started: () => void = () => undefined
  let inserting = new Promise<void>(resolve => { started = resolve })
  insert.mockImplementationOnce(async (...args) => {
    let key = await original(...args)
    started()
    await new Promise<void>(resolve => { release = resolve })
    return key
  })
  try {
    start()
    let refreshing = tools.reload()
    await inserting
    commit()
    release()
    await refreshing
    await tools.reload()
    expect([...sheets.values()].sort()).toEqual([css, ads].sort())
  } finally { release(); close() }
})

test('preserves styles during same-document navigation without adding duplicate sheets', async () => {
  let { contents, tools, sheets, start, close } = await fixture()
  try {
    let before = [...sheets.entries()], count = vi.mocked(contents.insertCSS).mock.calls.length
    start(true)
    contents.emit('did-navigate-in-page', {}, 'https://page.test/first#section', true)
    await tools.reload()
    expect([...sheets.entries()]).toEqual(before)
    expect(contents.insertCSS).toHaveBeenCalledTimes(count)
  } finally { close() }
})

test('navigation releases a lost style reply and cleans a late outgoing insertion', async () => {
  let { contents, tools, sheets, css, ads, start, commit, close } = await fixture()
  let insert = vi.mocked(contents.insertCSS), original = insert.getMockImplementation()!
  let release: (key: string) => void = () => undefined, started: () => void = () => undefined
  let inserting = new Promise<void>(resolve => { started = resolve })
  insert.mockImplementationOnce(() => { started(); return new Promise<string>(resolve => { release = resolve }) })
  try {
    start()
    let refreshing = tools.reload()
    await inserting
    commit()
    // This must complete while the outgoing renderer's IPC is still pending.
    await refreshing
    await tools.reload()
    expect([...sheets.values()].sort()).toEqual([css, ads].sort())
    let late = await original('.late { color: red }', { cssOrigin: 'user' })
    release(late)
    await Promise.resolve()
    await Promise.resolve()
    expect(sheets.has(late)).toBe(false)
  } finally { release(''); close() }
})

test('a stalled current-document style insertion reports a bounded error and can refresh again', async () => {
  let { contents, tools, directory, sheets, close } = await fixture()
  vi.useFakeTimers()
  try {
    fs.writeFileSync(path.join(directory, 'style.css'), '.custom { color: green !important }')
    vi.mocked(contents.insertCSS).mockImplementationOnce(() => new Promise<string>(() => undefined))
    let refreshing = tools.reload()
    await vi.advanceTimersByTimeAsync(3000)
    await refreshing
    expect(tools.error('tab')).toContain('insertCSS: timeout')
    await tools.reload()
    expect(tools.error('tab')).toBeUndefined()
    expect([...sheets.values()]).toContain('.custom { color: green !important }')
  } finally { vi.useRealTimers(); close() }
})


test('pane blocking overrides remove and restore cosmetic sheets without changing user styles', async () => {
  let enabled = true
  let { tools, sheets, css, ads, close } = await fixture(() => enabled)
  try {
    enabled = false
    await tools.refresh('tab')
    expect([...sheets.values()]).toEqual([css])
    enabled = true
    await tools.refresh('tab')
    expect([...sheets.values()].sort()).toEqual([css, ads].sort())
  } finally { close() }
})
