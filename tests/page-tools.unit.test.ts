import { test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { parseBrowserSettings } from '../src/main/browser-config'
import { createPageTools } from '../src/main/page-tools'

let fixture = async () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-page-tools-'))
  let css = '.custom { color: red !important }', ads = '.ad { display: none !important }'
  fs.writeFileSync(path.join(directory, 'style.css'), css)
  let settings = parseBrowserSettings({ userscripts: [{ id: 'style', file: 'style.css', enabled: true, matches: ['https://page.test/*'] }] })
  let url = 'https://page.test/first', sheets = new Map<string, string>(), sequence = 0
  let sendCommand = vi.fn(async (method: string): Promise<any> => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url } } }
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'main' } }
    if (method === 'Target.getTargets') return { targetInfos: [] }
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
    if (method === 'Runtime.evaluate') return { result: { value: { ids: [], classes: ['ad'] } } }
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(++sequence) }
    return {}
  })
  let contents = Object.assign(new EventEmitter(), {
    debugger: Object.assign(new EventEmitter(), { isAttached: () => true, detach: vi.fn(), sendCommand }),
    mainFrame: { framesInSubtree: [] }, isDestroyed: () => false, getURL: () => url,
    insertCSS: vi.fn(async (source: string) => { let key = String(++sequence); sheets.set(key, source); return key }),
    removeInsertedCSS: vi.fn(async (key: string) => { sheets.delete(key) }),
  }) as unknown as WebContents
  let tools = createPageTools({ directory, settings: () => settings, changed: () => undefined, visible: () => false, styles: () => ads })
  await tools.attach('tab', 'profile_default', contents, false)
  await tools.reload()
  return {
    contents, tools, sheets, css, ads,
    start: (sameDocument = false) => contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: sameDocument }, 'https://page.test/next', sameDocument, true),
    commit: () => { url = 'https://page.test/next'; sheets.clear(); contents.emit('did-navigate', {}, url, 200, 'OK'); contents.emit('dom-ready') },
    close: () => { tools.close(); fs.rmSync(directory, { recursive: true, force: true }) },
  }
}

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
