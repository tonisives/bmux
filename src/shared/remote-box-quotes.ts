import type { BoxQuote } from './remote-account'

export let sortedBoxQuotes = (quotes: BoxQuote[]) => quotes.slice().sort((a, b) => a.monthlyCents - b.monthlyCents || a.memoryGb - b.memoryGb || a.regionName.localeCompare(b.regionName))
export let recommendedBoxQuotes = (quotes: BoxQuote[], timezone: string): BoxQuote[] => {
  let sorted = sortedBoxQuotes(quotes)
  let regions = timezone.startsWith('America/') ? /Los_Angeles|Vancouver|Phoenix|Denver|Anchorage/.test(timezone) ? ['hil', 'ash'] : ['ash', 'hil'] : /^(Asia|Australia|Pacific)\//.test(timezone) ? ['sin', 'hel1'] : ['fsn1', 'nbg1', 'hel1']
  let region = regions.find(region => sorted.some(quote => quote.region === region)) ?? sorted[0]?.region
  let suggestions = [sorted.find(quote => quote.region === region && quote.memoryGb === 4), sorted.find(quote => quote.region === region && quote.memoryGb === 8), sorted.find(quote => quote.region !== region), ...sorted]
  return suggestions.filter((quote): quote is BoxQuote => !!quote).filter((quote, index, all) => all.findIndex(item => item.id === quote.id) === index).slice(0, 3)
}
