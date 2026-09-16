import { describe, expect, test } from 'vitest'
import { inlineUrlCompletion, parseSearchSuggestions } from '../src/shared/address-suggestions'

describe('address suggestions', () => {
  test('completes URL prefixes while preserving exactly what the user typed', () => {
    expect(inlineUrlCompletion('exa', 'https://example.com/docs')).toEqual({ value: 'example.com/docs', url: 'https://example.com/docs' })
    expect(inlineUrlCompletion('HTTPS://EXA', 'https://example.com/docs')).toEqual({ value: 'HTTPS://EXAmple.com/docs', url: 'https://example.com/docs' })
    expect(inlineUrlCompletion('www.ex', 'https://www.example.com/')).toEqual({ value: 'www.example.com/', url: 'https://www.example.com/' })
    expect(inlineUrlCompletion('example search', 'https://example.com/')).toBeUndefined()
  })

  test('accepts only unique non-empty search terms from the provider response', () => {
    expect(parseSearchSuggestions(['how to', ['how to', 'how to cook', '', 'HOW TO COOK', 3, 'how to code']], 'how to')).toEqual(['how to cook', 'how to code'])
    expect(parseSearchSuggestions({ suggestions: ['ignored'] }, 'query')).toEqual([])
  })
})
