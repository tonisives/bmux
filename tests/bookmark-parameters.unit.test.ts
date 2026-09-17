import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bookmarkParametersPath, readBookmarkParameters, writeBookmarkParameters } from '../src/main/bookmark-parameters'
import { editableBookmarkParameters, parameterizedBookmarkUrl, queryParameters } from '../src/shared/bookmark-parameters'

describe('bookmark parameters', () => {
  it('applies text and number values and removes hidden keys without changing the saved URL', () => {
    let original = 'https://example.test/find?q=first&limit=10&unused=1#results'
    let settings = { values: { q: 'a & b', limit: '25' }, hidden: ['unused'] }
    expect(queryParameters(original)).toEqual([['q', 'first'], ['limit', '10'], ['unused', '1']])
    expect(parameterizedBookmarkUrl(original, settings)).toBe('https://example.test/find?q=a+%26+b&limit=25#results')
    expect(original).toBe('https://example.test/find?q=first&limit=10&unused=1#results')
  })

  it('edits numeric minimum operators inside an X search query', () => {
    let url = 'https://x.com/search?q=startup&f=live'
    let settings = { values: { q: 'startup min_faves:1 min_replies:1 min_views:100', 'x:min_faves': '25', 'x:min_views': '250' }, hidden: ['x:min_replies'] }
    expect(editableBookmarkParameters(url, settings)).toEqual([
      ['q', 'startup'], ['f', 'live'], ['x:min_faves', '1'], ['x:min_replies', '1'], ['x:min_views', '100'],
    ])
    let opened = new URL(parameterizedBookmarkUrl(url, settings))
    expect(opened.searchParams.get('q')).toBe('startup min_faves:25 min_views:250')
    expect(opened.searchParams.get('f')).toBe('live')
    expect(url).toBe('https://x.com/search?q=startup&f=live')
  })

  it('stores customizations beside config and refuses invalid edits', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-parameters-'))
    try {
      let file = bookmarkParametersPath(path.join(directory, 'config.yaml'))
      let settings = { profile_personal: { bookmark_one: { values: { q: 'custom' }, hidden: ['tracking'] } } }
      expect(readBookmarkParameters(file)).toEqual({})
      writeBookmarkParameters(file, settings)
      expect(readBookmarkParameters(file)).toEqual(settings)
      fs.writeFileSync(file, 'profiles:\n  profile_personal: [invalid]\n')
      expect(() => readBookmarkParameters(file)).toThrow('Invalid bookmark parameters file')
      expect(fs.readFileSync(file, 'utf8')).toContain('[invalid]')
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
})
