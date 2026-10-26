import type { ReferenceRates } from './remote-account'

let regions: Record<string, string> = {}
for (let [currency,countries] of Object.entries({
  EUR:'AD AT AX BE BG BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA XK YT',
  GBP:'GB GG IM JE', CHF:'CH LI', NOK:'NO BV SJ', DKK:'DK FO GL',
  AUD:'AU CC CX HM KI NR NF TV', NZD:'NZ CK NU PN TK',
  USD:'US AS BQ EC FM GU IO MH MP PA PR PW SV TC TL UM VG VI',
  JPY:'JP', CZK:'CZ', HUF:'HU', PLN:'PL', RON:'RO', SEK:'SE', ISK:'IS', TRY:'TR',
  BRL:'BR', CAD:'CA', CNY:'CN', HKD:'HK', IDR:'ID', ILS:'IL', INR:'IN', KRW:'KR',
  MXN:'MX', MYR:'MY', PHP:'PH', SGD:'SG', THB:'TH', ZAR:'ZA',
})) for (let region of countries.split(' ')) regions[region] = currency

export let estimateCurrency = (locales: readonly string[], rates?: ReferenceRates) => {
  for (let locale of locales) {
    try {
      let currency = regions[new Intl.Locale(locale).maximize().region ?? '']
      return currency && (rates?.rates[currency] ?? 0) > 0 ? currency : 'USD'
    } catch { /* Try the next preferred locale. */ }
  }
  return 'USD'
}
export let usdPrice = (cents: number) => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents / 100)
export let localPrice = (cents: number, currency: string, rates?: ReferenceRates, locale?: string) => {
  let rate = rates?.rates[currency]
  if (currency === 'USD' || !rate || !Number.isFinite(rate) || rate <= 0) return undefined
  return new Intl.NumberFormat(locale, { style:'currency', currency, currencyDisplay:'code' }).format(cents / 100 * rate)
}
export let priceEstimate = (cents: number, currency: string, rates?: ReferenceRates, locale?: string) => {
  let local = localPrice(cents,currency,rates,locale)
  return `${usdPrice(cents)}${local ? ` (≈ ${local})` : ''}`
}
