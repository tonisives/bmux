import { describe, expect, it } from 'vitest'
import { estimateCurrency, localPrice, priceEstimate } from '../src/shared/remote-prices'
import type { ReferenceRates } from '../src/shared/remote-account'

let rates: ReferenceRates = {base:'USD',source:'ECB',date:'2026-10-23',rates:{USD:1,EUR:.9,GBP:.75,JPY:150,THB:35}}
describe('remote price estimates', () => {
  it('selects a reference currency for European and other regional locales', () => {
    expect(estimateCurrency(['de-DE'],rates)).toBe('EUR')
    expect(estimateCurrency(['bg-BG'],rates)).toBe('EUR')
    expect(estimateCurrency(['en-GB'],rates)).toBe('GBP')
    expect(estimateCurrency(['ja-JP'],rates)).toBe('JPY')
    expect(estimateCurrency(['th-TH'],rates)).toBe('THB')
    expect(estimateCurrency(['en-AE'],rates)).toBe('USD')
  })
  it('formats dollar prices and local estimates using the currency precision', () => {
    expect(priceEstimate(1000,'EUR',rates,'en-US')).toBe('$10.00 (≈ EUR\u00a09.00)')
    expect(priceEstimate(851,'JPY',rates,'en-US')).toBe('$8.51 (≈ JPY\u00a01,277)')
    expect(priceEstimate(1000,'USD',rates,'en-US')).toBe('$10.00')
  })
  it('keeps the USD price available without reference data', () => {
    expect(estimateCurrency(['de-DE'])).toBe('USD')
    expect(estimateCurrency(['invalid!','ja-JP'],rates)).toBe('JPY')
    expect(localPrice(1000,'EUR')).toBeUndefined()
    expect(priceEstimate(1000,'AED',rates,'en-US')).toBe('$10.00')
  })
})
