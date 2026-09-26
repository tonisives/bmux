import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { normalizeUrl } from '../src/main/url'

let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-local-url-'))
let file = path.join(directory, 'page with spaces.html')
fs.writeFileSync(file, '<title>Local page</title>')
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

it('opens existing absolute and relative file paths', () => {
  let url = pathToFileURL(file).href
  expect(normalizeUrl(file)).toBe(url)
  expect(normalizeUrl(path.relative(process.cwd(), file))).toBe(url)
  expect(normalizeUrl(path.relative(os.homedir(), file))).toBe(url)
  expect(normalizeUrl(`~/${path.relative(os.homedir(), file)}`)).toBe(url)
})

it('keeps web addresses and searches working', () => {
  expect(normalizeUrl('https://example.test/page.html')).toBe('https://example.test/page.html')
  expect(normalizeUrl('example.test/page.html')).toBe('https://example.test/page.html')
  expect(normalizeUrl('missing local page')).toBe('https://www.google.com/search?q=missing%20local%20page')
})
