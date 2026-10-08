import { afterEach, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFaviconCache } from '../src/main/favicon-cache'

let directories: string[] = []
let directory = () => { let value = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-favicons-')); directories.push(value); return value }
let icon = 'data:image/png;base64,aGVsbG8='

afterEach(() => { for (let value of directories) fs.rmSync(value, { recursive: true, force: true }); directories = [] })

test('restores a site icon after reopening and keeps profiles separate', () => {
  let location = directory()
  let first = createFaviconCache(location)
  first.set('work', 'https://example.test/one', icon)
  first.close()
  let reopened = createFaviconCache(location)
  expect(reopened.get('work', 'https://example.test/two')).toBe(icon)
  expect(reopened.get('personal', 'https://example.test/one')).toBeUndefined()
  expect(reopened.get('work', 'https://other.test/one')).toBeUndefined()
  reopened.close()
})

test('keeps private icons in memory and never writes them to disk', () => {
  let location = directory()
  let cache = createFaviconCache(location)
  cache.set('work', 'https://example.test', icon, 'private-one')
  expect(cache.get('work', 'https://example.test/page', 'private-one')).toBe(icon)
  expect(cache.get('work', 'https://example.test', 'private-two')).toBeUndefined()
  cache.close()
  expect(fs.existsSync(path.join(location, 'favicons.json'))).toBe(false)
  expect(createFaviconCache(location).get('work', 'https://example.test')).toBeUndefined()
})

test('ignores unsupported pages and invalid cached data', () => {
  let location = directory()
  let cache = createFaviconCache(location)
  cache.set('work', 'about:blank', icon)
  cache.set('work', 'https://example.test', 'data:text/html;base64,aGVsbG8=')
  expect(cache.get('work', 'https://example.test')).toBeUndefined()
  cache.close()
  fs.writeFileSync(path.join(location, 'favicons.json'), '{broken')
  expect(createFaviconCache(location).get('work', 'https://example.test')).toBeUndefined()
})
