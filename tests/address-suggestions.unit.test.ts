import { describe, expect, test } from 'vitest'
import { baseUrlCompletion, inlineUrlCompletion, prioritizeInlineHistory, searchUrlDestination, urlDestinationTitle } from '../src/shared/address-suggestions'

describe('address suggestions', () => {
  test('uses the saved title for the same clean page without borrowing titles from deeper pages', () => {
    let entries = [
      { title: 'Issue details', url: 'https://github.com/acme/bmux/issues/1' },
      { title: 'Long term metrics - Grafana', url: 'https://metrics.test/d/id/long-term-metrics?orgId=1&from=now-1y#chart' },
      { title: 'Repository', url: 'https://github.com/acme/bmux/' },
    ]
    expect(urlDestinationTitle('https://metrics.test/d/id/long-term-metrics', entries)).toBe('Long term metrics - Grafana')
    expect(urlDestinationTitle('https://github.com/acme/bmux', entries)).toBe('Repository')
    expect(urlDestinationTitle('https://github.com/acme', entries)).toBeUndefined()
    expect(urlDestinationTitle('https://other.test/d/id/long-term-metrics', entries)).toBeUndefined()
    expect(urlDestinationTitle('https://metrics.test/', [{ title: '', url: 'https://metrics.test/?old' }])).toBeUndefined()
  })

  test.each(['google maps', 'maps google', '  GOOGLE   MAPS  ', 'maps'])('offers the clean Maps URL for the text search %s', query => {
    let urls = [
      'https://www.google.com/maps/place/Be+Live+Residence/@8,98,12z/data=previous',
      'https://www.google.com/maps/place/Seapine+Beach?entry=ttu#saved',
    ]
    expect(searchUrlDestination(query, urls)).toEqual({ value: 'google.com/maps', url: 'https://www.google.com/maps' })
  })

  test('infers clean host and repository destinations without a site-specific list', () => {
    expect(searchUrlDestination('google translate', ['https://translate.google.com/?sl=en&tl=et&text=old'])).toEqual({ value: 'translate.google.com', url: 'https://translate.google.com/' })
    expect(searchUrlDestination('github bmux', ['https://github.com/tonisives/bmux/issues/123?state=old'])).toEqual({ value: 'github.com/tonisives/bmux', url: 'https://github.com/tonisives/bmux' })
  })

  test('prefers a shallow destination over an older page mentioning the same words', () => {
    expect(searchUrlDestination('google maps', ['https://example.test/articles/using/google/maps/details', 'https://www.google.com/maps/place/previous'])).toEqual({ value: 'google.com/maps', url: 'https://www.google.com/maps' })
  })

  test('does not infer destinations from query data, fragments, or unrelated URLs', () => {
    let urls = ['https://www.google.com/search?q=maps', 'https://example.test/#google-maps', 'file:///google/maps', 'invalid', 'https://google:maps@example.test/']
    expect(searchUrlDestination('google maps', urls)).toBeUndefined()
    expect(searchUrlDestination('unrelated place', ['https://www.google.com/maps/place/previous'])).toBeUndefined()
    for (let query of ['', ' ', 'google.com/maps', 'google.com/?q=maps']) expect(searchUrlDestination(query, urls)).toBeUndefined()
    expect(searchUrlDestination('google maps', ['https://www.google.com/maps'])).toBeUndefined()
  })

  test.each(['translate', 'translate.google.com', 'translate.google.com/'])('prefers the translation homepage for %s', input => {
    expect(baseUrlCompletion(input, 'https://translate.google.com/?sl=en&tl=et&text=previous+translation')).toEqual({
      value: input.endsWith('/') ? 'translate.google.com/' : 'translate.google.com', url: 'https://translate.google.com/',
    })
  })

  test.each(['google.com/ma', 'google.com/maps'])('prefers the Maps entry point for %s', input => {
    expect(baseUrlCompletion(input, 'https://google.com/maps/place/Bangkok/@13,100,12z?entry=ttu#saved')).toEqual({ value: 'google.com/maps', url: 'https://google.com/maps' })
  })

  test('preserves explicit deeper paths, schemes, ports, and typed casing', () => {
    expect(baseUrlCompletion('HTTP://LOCALHOST:8080/do', 'http://localhost:8080/docs/page?state=old')).toEqual({ value: 'HTTP://LOCALHOST:8080/docs', url: 'http://localhost:8080/docs' })
    expect(baseUrlCompletion('www.ex', 'https://www.example.com/docs')).toEqual({ value: 'www.example.com', url: 'https://www.example.com/' })
    expect(baseUrlCompletion('example.com/docs/pa', 'https://example.com/docs/page/section?state=old')).toEqual({ value: 'example.com/docs/page', url: 'https://example.com/docs/page' })
    expect(baseUrlCompletion('example.com', 'https://example.com?state=old')).toEqual({ value: 'example.com', url: 'https://example.com/' })
    expect(baseUrlCompletion('example.com/docs', 'https://example.com/docs?state=old')).toEqual({ value: 'example.com/docs', url: 'https://example.com/docs' })
    expect(baseUrlCompletion('example.com/', 'https://example.com/docs/page')).toEqual({ value: 'example.com/', url: 'https://example.com/' })
    expect(baseUrlCompletion('https://', 'https://example.com/docs/page')).toEqual({ value: 'https://example.com', url: 'https://example.com/' })
    expect(baseUrlCompletion('https:/', 'https://example.com/docs/page')).toEqual({ value: 'https://example.com', url: 'https://example.com/' })
  })

  test('leaves search terms and explicit query or fragment completion to history', () => {
    for (let input of ['', 'example search', 'unrelated.com', 'example.com/docs?q=', 'example.com/docs#']) {
      expect(baseUrlCompletion(input, 'https://example.com/docs?q=old#section')).toBeUndefined()
    }
    expect(baseUrlCompletion('file', 'file:///tmp/example')).toBeUndefined()
    expect(baseUrlCompletion('example', 'invalid')).toBeUndefined()
  })

  test('completes URL prefixes while preserving exactly what the user typed', () => {
    expect(inlineUrlCompletion('exa', 'https://example.com/docs')).toEqual({ value: 'example.com/docs', url: 'https://example.com/docs' })
    expect(inlineUrlCompletion('HTTPS://EXA', 'https://example.com/docs')).toEqual({ value: 'HTTPS://EXAmple.com/docs', url: 'https://example.com/docs' })
    expect(inlineUrlCompletion('www.ex', 'https://www.example.com/')).toEqual({ value: 'www.example.com/', url: 'https://www.example.com/' })
    expect(inlineUrlCompletion('example search', 'https://example.com/')).toBeUndefined()
  })

  test('keeps the inline-completed history URL at the front of the quicklist', () => {
    let history = [
      { title: 'First fuzzy match', url: 'https://example.test/first', visitedAt: 3 },
      { title: 'Second fuzzy match', url: 'https://example.test/second', visitedAt: 2 },
      { title: 'GCP dashboard', url: 'https://gfn-gcp.example.test/dashboard', visitedAt: 1 },
    ]
    expect(prioritizeInlineHistory(history.slice(0, 2), history, history[2].url).map(entry => entry.url)).toEqual([history[2].url, history[0].url, history[1].url])
    expect(prioritizeInlineHistory(history, history).map(entry => entry.url)).toEqual(history.map(entry => entry.url))
  })
})
