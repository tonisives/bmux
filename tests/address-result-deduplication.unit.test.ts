import { expect, test } from 'vitest'
import { deduplicateAddressEntries } from '../src/shared/address-result-deduplication'

test('groups the same title on the same site despite different paths and www', () => {
  let entries = [
    { title: 'City Resort - Google Maps', url: 'https://www.google.com/maps/place/Beach/first' },
    { title: '  CITY RESORT   - Google Maps ', url: 'https://google.com/maps/place/Resort/second?entry=ttu' },
    { title: 'City Resort - Google Maps', url: 'https://other.test/resort' },
    { title: 'Different place - Google Maps', url: 'https://google.com/maps/place/Park' },
  ]
  expect(deduplicateAddressEntries(entries)).toEqual([entries[0], entries[2], entries[3]])
})

test('recognizes tracking parameters and reordered queries without rewriting saved URLs', () => {
  let entries = [
    { title: 'New title', url: 'https://www.example.test/article?id=42&utm_source=news&fbclid=first' },
    { title: 'Old title', url: 'https://example.test/article/?gclid=second&id=42' },
    { title: 'New title', url: 'https://example.test/article?id=43' },
  ]
  let before = structuredClone(entries)
  expect(deduplicateAddressEntries(entries)).toEqual([entries[0], entries[2]])
  expect(entries).toEqual(before)
})

test('keeps meaningful query values, app routes, subdomains and ports distinct', () => {
  let urls = ['https://example.test/search?q=one', 'https://example.test/search?q=two', 'https://example.test/#/one', 'https://example.test/#/two', 'https://other.example.test/search?q=one', 'https://example.test:8443/search?q=one']
  let entries = urls.map(url => ({ title: 'Search', url }))
  expect(deduplicateAddressEntries(entries)).toEqual(entries)
})

test('matches Maps place IDs across localized slugs, titles and viewport state', () => {
  let entries = [
    { title: 'City Park - Google Maps', url: 'https://www.google.com/maps/place/City+Park/@1,2,10z/data=!4m5!1s0xabc:0x123!8m2?entry=ttu' },
    { title: 'สวนสาธารณะ - Google Maps', url: 'https://maps.google.com/maps/place/Localized+Park/@3,4,12z/data=!4m7!1s0xabc:0x123!8m2' },
    { title: 'Other place', url: 'https://www.google.com/maps/search/?api=1&query=park&query_place_id=place123' },
    { title: 'Generic title', url: 'https://www.google.com/maps/search/?query_place_id=place123&api=1&query=park&hl=et' },
  ]
  expect(deduplicateAddressEntries(entries)).toEqual([entries[0], entries[2]])
})

test('matches Maps name encodings and optional place IDs', () => {
  let entries = [
    { title: 'City Park', url: 'https://google.com/maps/place/City+Park/@1,2,10z' },
    { title: 'Google Maps', url: 'https://google.com/maps/place/City%20Park/data=!1s0xabc%3A0x123' },
  ]
  expect(deduplicateAddressEntries(entries)).toEqual([entries[0]])
})

test('prefers bookmarks over matching history and keeps unrelated pages with generic titles', () => {
  let bookmark = { title: 'Saved place', url: 'https://example.test/place?utm_source=bookmark' }
  let history = [
    { title: 'Renamed place', url: 'https://example.test/place?utm_source=history' },
    { title: 'Saved place', url: 'https://example.test/other-path' },
    { title: '', url: 'https://example.test/one' },
    { title: '', url: 'https://example.test/two' },
  ]
  expect(deduplicateAddressEntries(history, [bookmark])).toEqual(history.slice(2))
})

test('does not merge unrelated Maps places through a discarded generic-title alias', () => {
  let entries = [
    { title: 'Google Maps', url: 'https://google.com/maps/place/One/data=!1sfirst' },
    { title: 'Google Maps', url: 'https://google.com/maps/place/Two/data=!1ssecond' },
    { title: 'Second place', url: 'https://google.com/maps/place/Two/data=!1ssecond' },
  ]
  expect(deduplicateAddressEntries(entries)).toEqual([entries[0], entries[2]])
})
