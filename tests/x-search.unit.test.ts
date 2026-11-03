import { afterEach, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { parsePluginManifest } from '../src/main/plugin-manifest'
import { bookmarkPluginValues, matchesBookmarkPlugin } from '../src/shared/bookmark-plugins'

let definition = parsePluginManifest(fs.readFileSync('bundled-plugins/bmux.x-search/plugin.yaml', 'utf8')).bookmark!
let source = fs.readFileSync('bundled-plugins/bmux.x-search/filter.js', 'utf8')
afterEach(() => vi.useRealTimers())
let tweet = (textContent: string) => {
  let text = { textContent }, styles = new Map<string, { value: string; priority: string }>()
  return { text, querySelector: () => text, style: { getPropertyValue: (key: string) => styles.get(key)?.value ?? '', getPropertyPriority: (key: string) => styles.get(key)?.priority ?? '', setProperty: (key: string, value: string, priority: string) => styles.set(key, { value, priority }), removeProperty: (key: string) => styles.delete(key) }, hidden: () => styles.get('display')?.value === 'none' }
}
let filter = (rows: ReturnType<typeof tweet>[], settings = {}) => {
  let notify: () => void = () => undefined
  let context = { location: { href: 'https://x.com/search?q=saas' }, URL, setTimeout, clearTimeout, document: { documentElement: {}, querySelectorAll: () => rows }, MutationObserver: class { constructor(callback: () => void) { notify = callback }; disconnect = vi.fn(); observe = vi.fn() } }
  let cleanup = vm.runInNewContext(`(${source})`, context)(bookmarkPluginValues(definition, settings))
  return { cleanup, context, notify: () => notify() }
}
test('X filter matches search bookmarks on X and Twitter only', () => {
  for (let host of ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']) expect(matchesBookmarkPlugin(definition.matches, `https://${host}/search?q=saas`)).toBe(true)
  for (let url of ['https://x.com/home', 'https://x.com/user/status/123', 'https://x.com.evil/search']) expect(matchesBookmarkPlugin(definition.matches, url)).toBe(false)
})
test('filters the screenshot prompts and preserves technical posts and original styles', () => {
  let rows = ["let's #connect\nI'm into:\nReact\nAI agents", 'Hey founders & builders!\nLet’s connect with people building in tech:', "Hi, @X algorithm\nI'm looking to #connect with people interested in:\nindie hackers", 'Hey X\nlooking to #connect with people who are into:\nLLM apps', "Let's connect to our API", 'Connecting developers with useful tools'].map(tweet)
  rows[0].style.setProperty('display', 'flex', 'important')
  let run = filter(rows)
  expect(rows.map(row => row.hidden())).toEqual([true, true, true, true, false, false])
  run.cleanup()
  expect(rows.every(row => !row.hidden())).toBe(true)
  expect(rows[0].style.getPropertyValue('display')).toBe('flex')
  expect(rows[0].style.getPropertyPriority('display')).toBe('important')
  let disabled = filter(rows, { connectionPosts: false })
  expect(rows.every(row => !row.hidden())).toBe(true); disabled.cleanup()
})
test('handles appended and recycled tweets and restores results outside search', async () => {
  vi.useFakeTimers()
  let rows = [tweet('Shipping a new app')], run = filter(rows)
  rows.push(tweet('Looking to connect with fellow builders'))
  run.notify(); await vi.advanceTimersByTimeAsync(60)
  expect(rows[1].hidden()).toBe(true)
  rows[1].text.textContent = 'Shipped an update'
  run.notify(); await vi.advanceTimersByTimeAsync(60)
  expect(rows[1].hidden()).toBe(false)
  rows[0].text.textContent = "Let's #connect"
  run.notify(); await vi.advanceTimersByTimeAsync(60)
  expect(rows[0].hidden()).toBe(true)
  run.context.location.href = 'https://x.com/home'
  run.notify(); await vi.advanceTimersByTimeAsync(60)
  expect(rows.every(row => !row.hidden())).toBe(true); run.cleanup()
})
