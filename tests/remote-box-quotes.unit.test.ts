import { expect, it } from 'vitest'
import type { BoxQuote } from '../src/shared/remote-account'
import { recommendedBoxQuotes, sortedBoxQuotes } from '../src/shared/remote-box-quotes'

let quote = (id: string, region: string, memoryGb: number, monthlyCents: number): BoxQuote => ({ id, region, regionName: region, memoryGb, monthlyCents, cores: 2, diskGb: 40, trafficBytes: 1e12, currency: 'usd' })
let quotes = [quote('eu8', 'fsn1', 8, 1400), quote('us4', 'ash', 4, 950), quote('asia8', 'sin', 8, 1800), quote('eu4', 'fsn1', 4, 800), quote('asia4', 'sin', 4, 1100), quote('us-west4', 'hil', 4, 1000)]

it('offers two sizes near the user and a cheaper alternative without changing the catalog', () => {
  expect(recommendedBoxQuotes(quotes, 'Asia/Bangkok').map(quote => quote.id)).toEqual(['asia4', 'asia8', 'eu4'])
  expect(recommendedBoxQuotes(quotes, 'Europe/Tallinn').map(quote => quote.id)).toEqual(['eu4', 'eu8', 'us4'])
  expect(recommendedBoxQuotes(quotes, 'America/New_York')[0].id).toBe('us4')
  expect(recommendedBoxQuotes(quotes, 'America/Los_Angeles')[0].id).toBe('us-west4')
  expect(quotes[0].id).toBe('eu8')
})
it('uses available regions and sizes and handles a sparse or empty catalog', () => {
  expect(recommendedBoxQuotes([quotes[0]], 'Asia/Bangkok')).toEqual([quotes[0]])
  expect(recommendedBoxQuotes([], 'Asia/Bangkok')).toEqual([])
  expect(new Set(recommendedBoxQuotes(quotes, 'Pacific/Auckland').map(quote => quote.id)).size).toBe(3)
  expect(sortedBoxQuotes(quotes).map(quote => quote.monthlyCents)).toEqual([800, 950, 1000, 1100, 1400, 1800])
})
