import { afterEach, describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { stringify } from 'yaml'
import { parsePluginManifest } from '../src/main/plugin-manifest'
import { bookmarkPluginValues, matchesBookmarkPlugin } from '../src/shared/bookmark-plugins'
import { readBookmarkPlugins, writeBookmarkPlugins } from '../src/main/bookmark-plugin-store'
import { createBookmarkPluginPages } from '../src/main/bookmark-plugin-pages'
import { cloneWindow, initialModel, validateModel } from '../src/main/model'

let definition = parsePluginManifest(fs.readFileSync('bundled-plugins/bmux.reddit-search/plugin.yaml', 'utf8')).bookmark!
let source = fs.readFileSync('bundled-plugins/bmux.reddit-search/filter.js', 'utf8')
afterEach(() => vi.useRealTimers())
describe('bookmark plugin contracts', () => {
  test('accepts old manifests and validates defaults, bounds, paths and site matches', () => {
    let manifest = { schema_version: 1, id: 'fixture', name: 'Fixture', version: '1', bookmark: definition }
    expect(parsePluginManifest(stringify({ ...manifest, bookmark: undefined })).bookmark).toBeUndefined()
    expect(bookmarkPluginValues(definition, {})).toMatchObject({ minScore: 2, minComments: 2, duplicateTitles: true })
    for (let values of [{ minScore: -1 }, { minScore: 1.5 }, { minComments: Infinity }, { duplicateTitles: 'yes' }, { rule: 'unknown' }, { missing: 1 }]) expect(() => bookmarkPluginValues(definition, values)).toThrow()
    for (let script of ['/tmp/file.js', '../file.js', 'a/../../file.js']) expect(() => parsePluginManifest(stringify({ ...manifest, bookmark: { ...definition, script } }))).toThrow()
    expect(() => parsePluginManifest(stringify({ ...manifest, bookmark: { ...definition, controls: [{ name: 'x', title: 'X', kind: 'number', default: -1, min: 0 }] } }))).toThrow()
    expect(matchesBookmarkPlugin(definition.matches, 'https://www.reddit.com/search/?q=foo')).toBe(true)
    expect(matchesBookmarkPlugin(definition.matches, 'https://old.reddit.com/r/news/search?q=foo')).toBe(true)
    expect(matchesBookmarkPlugin(definition.matches, 'https://www.reddit.com.evil/search')).toBe(false)
    expect(matchesBookmarkPlugin(definition.matches, 'https://www.reddit.com/r/news/comments/id/title')).toBe(false)
  })
  test('round trips settings and rejects malformed data without overwriting it', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-bookmark-plugin-')), file = path.join(directory, 'bookmark-plugins.yaml')
    try {
      expect(readBookmarkPlugins(file)).toEqual({})
      let settings = { personal: { reddit: [{ id: 'bmux.reddit-search', enabled: true, values: { minScore: 2, duplicateTitles: true } }] } }
      writeBookmarkPlugins(file, settings); expect(readBookmarkPlugins(file)).toEqual(settings)
      fs.writeFileSync(file, 'profiles: {personal: {reddit: [null]}}')
      expect(() => readBookmarkPlugins(file)).toThrow()
      expect(fs.readFileSync(file, 'utf8')).toContain('[null]')
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
  test('restores pane provenance but never copies it into a duplicate window', () => {
    let model = initialModel(), window = model.sessions[0].windows[0]
    window.panes[0].bookmarkSource = { profileId: window.panes[0].profileId, bookmarkId: 'reddit' }
    expect(validateModel(JSON.parse(JSON.stringify(model))).sessions[0].windows[0].panes[0].bookmarkSource).toBeDefined()
    expect(cloneWindow(window, model).panes[0].bookmarkSource).toBeUndefined()
  })
})
let row = (id: string, score: string | null, comments: string | null, title = id, link = '') => {
  let attributes = new Map([['id', `t3_${id}`], ['post-title', title], ['content-href', link]])
  if (score !== null) attributes.set('score', score)
  if (comments !== null) attributes.set('comment-count', comments)
  let styles = new Map<string, { value: string; priority: string }>()
  return { getAttribute: (key: string) => attributes.get(key) ?? null, querySelector: () => null, contains: () => false, style: { getPropertyValue: (key: string) => styles.get(key)?.value ?? '', getPropertyPriority: (key: string) => styles.get(key)?.priority ?? '', setProperty: (key: string, value: string, priority: string) => styles.set(key, { value, priority }), removeProperty: (key: string) => styles.delete(key) }, attributes, hidden: () => styles.get('display')?.value === 'none' }
}
let filter = (rows: ReturnType<typeof row>[], settings = {}) => {
  let notify: () => void = () => undefined, disconnect = vi.fn()
  let context = { location: { href: 'http://127.0.0.1/search/?q=foo&type=posts' }, URL, setTimeout, clearTimeout, document: { documentElement: {}, querySelectorAll: () => rows }, MutationObserver: class { constructor(callback: () => void) { notify = callback }; disconnect = disconnect; observe = vi.fn() } }
  let cleanup = vm.runInNewContext(`(${source})`, context)(bookmarkPluginValues(definition, settings))
  return { cleanup, context, notify: () => notify(), disconnect }
}
describe('Reddit filtering', () => {
  test('uses both minima by default, retains unknown counts and parses abbreviations', () => {
    let rows = [row('a', '1', '5'), row('b', '5', '1'), row('c', '2', '2'), row('d', null, '1'), row('e', '1.2k', '2,000'), row('f', '-2', '5')]
    let run = filter(rows)
    expect(rows.map(item => item.hidden())).toEqual([true, true, false, false, false, true])
    run.cleanup(); expect(rows.every(item => !item.hidden())).toBe(true)
    expect(run.disconnect).toHaveBeenCalled()
    let either = filter(rows, { rule: 'Require either minimum' })
    expect(rows.map(item => item.hidden())).toEqual([false, false, false, false, false, false]); either.cleanup()
  })
  test('filters thresholds before deduplicating IDs, URLs, crossposts and normalized titles', () => {
    let rows = [row('a', '1', '1', 'Same title'), row('b', '2', '2', ' Same  TITLE '), row('b', '4', '4', 'Different'), row('c', '2', '2', 'same title'), row('d', '2', '2', 'Link one', 'https://example.com/article?utm_source=reddit#one'), row('e', '2', '2', 'Link two', 'https://example.com/article#two'), row('f', '2', '2', 'Crosspost')]
    rows[6].attributes.set('crosspost-parent-id', 't3_d')
    let run = filter(rows)
    expect(rows.map(item => item.hidden())).toEqual([true, false, true, true, false, true, true]); run.cleanup()
    let noDuplicates = filter(rows, { minScore: 0, minComments: 0, duplicatePosts: false, duplicateLinks: false, duplicateTitles: false })
    expect(rows.every(item => !item.hidden())).toBe(true); noDuplicates.cleanup()
  })
  test('handles appended results, updated counts, search changes and original inline styles', async () => {
    vi.useFakeTimers()
    let rows = [row('a', '1', '2')]
    rows[0].style.setProperty('display', 'flex', 'important')
    let run = filter(rows); expect(rows[0].hidden()).toBe(true)
    rows[0].attributes.set('score', '5'); rows.push(row('b', '5', '5', 'a'))
    run.notify(); await vi.advanceTimersByTimeAsync(60)
    expect(rows.map(item => item.hidden())).toEqual([false, true])
    expect(rows[0].style.getPropertyValue('display')).toBe('flex')
    rows.splice(0, 1); run.context.location.href = 'https://www.reddit.com/search/?q=other'; run.notify(); await vi.advanceTimersByTimeAsync(60)
    expect(rows[0].hidden()).toBe(false)
    run.context.location.href = 'https://www.reddit.com/r/news/comments/post/discussion'; run.notify(); await vi.advanceTimersByTimeAsync(60)
    expect(rows[0].hidden()).toBe(false); run.cleanup()
  })
})
test('isolated world updates are document-bound and cannot target other bookmarks', async () => {
  let debug = new EventEmitter(), attachments = [{ id: 'test', enabled: true, values: {} }], update = vi.fn(async () => undefined)
  let contents = { getURL: () => 'https://example.test/search', isDestroyed: () => false, debugger: debug }
  let cdp = vi.fn(async (_tab: string, method: string) => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'frame' } } } : method === 'Page.createIsolatedWorld' ? { executionContextId: 42 } : { result: { value: [] } })
  let pages = createBookmarkPluginPages({ cdp, attachments: () => attachments, definitions: () => [{ id: 'test', name: 'Test', contribution: { matches: ['https://example.test/*'], script: 'test.js', controls: [] }, source: '() => () => {}' }], changed: vi.fn(), update })
  pages.attach('pane', contents as any); await pages.refresh('pane')
  expect(cdp).toHaveBeenCalledWith('pane', 'Runtime.addBinding', { name: '__bmuxBookmarkSettings', executionContextName: 'bmux:bookmark-plugins' })
  let message = (executionContextId: number, id = 'test') => debug.emit('message', {}, 'Runtime.bindingCalled', { name: '__bmuxBookmarkSettings', executionContextId, payload: JSON.stringify({ id, enabled: false, values: {}, profile: 'other', bookmark: 'other', remove: true }) })
  message(1); message(42, 'other'); expect(update).not.toHaveBeenCalled()
  message(42); expect(update).toHaveBeenCalledOnce(); expect(update).toHaveBeenCalledWith('pane', { id: 'test', enabled: false, values: {} })
  pages.invalidate('pane'); message(42); expect(update).toHaveBeenCalledOnce(); expect(update).toHaveBeenCalledWith('pane', { id: 'test', enabled: false, values: {} })
  attachments = []; await pages.refresh('pane'); pages.dispose('pane'); expect(debug.listenerCount('message')).toBe(0)
})
