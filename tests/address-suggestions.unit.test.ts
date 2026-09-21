import { describe, expect, test } from 'vitest'
import { inlineUrlCompletion } from '../src/shared/address-suggestions'

describe('address suggestions', () => {
  test('completes URL prefixes while preserving exactly what the user typed', () => {
    expect(inlineUrlCompletion('exa', 'https://example.com/docs')).toEqual({ value: 'example.com/docs', url: 'https://example.com/docs' })
    expect(inlineUrlCompletion('HTTPS://EXA', 'https://example.com/docs')).toEqual({ value: 'HTTPS://EXAmple.com/docs', url: 'https://example.com/docs' })
    expect(inlineUrlCompletion('www.ex', 'https://www.example.com/')).toEqual({ value: 'www.example.com/', url: 'https://www.example.com/' })
    expect(inlineUrlCompletion('example search', 'https://example.com/')).toBeUndefined()
  })
})
