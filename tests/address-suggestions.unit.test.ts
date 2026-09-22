import { describe, expect, test } from 'vitest'
import { inlineUrlCompletion, prioritizeInlineHistory } from '../src/shared/address-suggestions'

describe('address suggestions', () => {
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
