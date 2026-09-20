import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bookmarkParametersPath, readBookmarkParameters, writeBookmarkParameters } from '../src/main/bookmark-parameters'
import { bookmarkParameterPresentation, editableBookmarkParameters, parameterizedBookmarkUrl, queryParameters } from '../src/shared/bookmark-parameters'

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
    let settings = { values: { q: 'startup min_faves:1 min_replies:1', 'x:min_faves': '25' }, hidden: ['x:min_replies'] }
    expect(editableBookmarkParameters(url, settings)).toEqual([
      ['q', 'startup'], ['f', 'live'], ['x:min_faves', '1'], ['x:min_replies', '1'], ['x:max_age_days', '0'],
    ])
    let opened = new URL(parameterizedBookmarkUrl(url, settings))
    expect(opened.searchParams.get('q')).toBe('startup min_faves:25')
    expect(opened.searchParams.get('f')).toBe('live')
    expect(url).toBe('https://x.com/search?q=startup&f=live')
  })

  it('turns an X post age in days into a relative since operator', () => {
    let now = new Date('2026-09-21T12:00:00Z')
    let url = 'https://x.com/search?q=startup+since%3A2026-09-01&f=live'
    expect(editableBookmarkParameters(url, undefined, now)).toContainEqual(['x:max_age_days', '20'])
    let opened = new URL(parameterizedBookmarkUrl(url, { values: { 'x:max_age_days': '7' }, hidden: [] }, now))
    expect(opened.searchParams.get('q')).toBe('startup since:2026-09-14')
    let unlimited = new URL(parameterizedBookmarkUrl(url, { values: { 'x:max_age_days': '0' }, hidden: [] }, now))
    expect(unlimited.searchParams.get('q')).toBe('startup')
  })

  it('clarifies X result and virtual parameter labels', () => {
    let url = 'https://x.com/search?q=startup&f=live'
    expect(bookmarkParameterPresentation(url, 'f')).toEqual({ label: 'Results', help: 'X result type; live means Latest' })
    expect(bookmarkParameterPresentation(url, 'x:max_age_days')).toEqual({ label: 'Post age (days)', help: '0 means any age' })
    expect(bookmarkParameterPresentation('https://example.test/?f=live', 'f')).toEqual({ label: 'f' })
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
