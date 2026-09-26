import { expect, test } from 'vitest'
import { initialModel, validateModel } from '../src/main/model'
import { searchUrl } from '../src/shared/search-app'

test('search apps encode the same query for each supported service', () => {
  expect(searchUrl('cats & dogs')).toBe('https://www.google.com/search?q=cats%20%26%20dogs')
  expect(searchUrl('cats & dogs', 'duckduckgo')).toBe('https://duckduckgo.com/?q=cats%20%26%20dogs')
  expect(searchUrl('cats & dogs', 'bing')).toBe('https://www.bing.com/search?q=cats%20%26%20dogs')
  expect(searchUrl('cats & dogs', 'brave')).toBe('https://search.brave.com/search?q=cats%20%26%20dogs')
})

test('legacy session search choices are removed from saved session state', () => {
  let model = initialModel()
  let legacy = { ...model, sessions: [{ ...model.sessions[0], searchApp: 'duckduckgo' }] }
  expect(validateModel(legacy).sessions[0]).not.toHaveProperty('searchApp')
})
