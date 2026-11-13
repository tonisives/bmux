import { expect, it } from 'vitest'
// @ts-expect-error Optional plugins run as native ES modules.
import { collectSearchResults, typeSearchQuery } from '../optional-plugins/bmux.x/search-input.mjs'

let fixture = (lostFocus = false, changedQuery = false) => {
  let typed = '', operations: string[] = [], focusChecks = 0
  let call = (method: string, args: Record<string, unknown>) => {
    operations.push(method)
    if (method === 'eval') {
      if (String(args.expression).includes('activeElement')) return !lostFocus || ++focusChecks < 3
      return !changedQuery
    }
    if (method === 'type') typed += args.text
  }
  return { call, operations, typed: () => typed }
}

it('types a long query in bounded native chunks under host pacing', async () => {
  let f = fixture(), query = '("thinking of building" OR "working on") ("for accountants" OR "for agencies") lang:en'
  await typeSearchQuery(f.call, async () => undefined, () => 20, 'input', query)
  expect(f.typed()).toBe(query)
  expect(f.operations.filter(method => method === 'type')).toHaveLength(Math.ceil(query.length / 20))
  expect(f.operations.filter(method => method === 'cdp')).toHaveLength(4)
})

it('stops typing when the search field loses focus', async () => {
  let f = fixture(true)
  await expect(typeSearchQuery(f.call, async () => undefined, () => 20, 'input', 'query '.repeat(20))).rejects.toThrow('lost focus')
  expect(f.operations.filter(method => method === 'type')).toHaveLength(1)
})

it('refuses submission when the field does not contain the exact query', async () => {
  let f = fixture(false, true)
  await expect(typeSearchQuery(f.call, async () => undefined, () => 20, 'input', 'a query')).rejects.toThrow('query changed')
})

it('collects each visible batch before virtualized cards leave the page', async () => {
  let index = 0, batches = [[{ url: 'a' }, { url: 'b' }], [{ url: 'b' }, { url: 'c' }], [{ url: 'd' }]]
  let result = await collectSearchResults(async () => { index++ }, () => batches[index], 4, 4)
  expect(result).toEqual({ results: [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }], partial: false })
  expect(index).toBe(2)
})

it('preserves captured results and reports a later scroll timeout', async () => {
  let result = await collectSearchResults(async () => { throw new Error('Scroll Input.dispatchMouseEvent timed out after 2000ms') }, () => [{ url: 'captured' }], 3, 20)
  expect(result).toEqual({ results: [{ url: 'captured' }], partial: true, warning: 'Scroll Input.dispatchMouseEvent timed out after 2000ms' })
})

it('keeps a scroll timeout unsuccessful when no results were captured', async () => {
  await expect(collectSearchResults(async () => { throw new Error('Scroll exceeded its 5000ms deadline') }, () => [], 3, 20)).rejects.toThrow('Scroll exceeded')
})

it('does not turn account control failures into partial success', async () => {
  await expect(collectSearchResults(async () => { throw new Error('ACCOUNT_EXECUTION_EXPIRED') }, () => [{ url: 'captured' }], 3, 20)).rejects.toThrow('ACCOUNT_EXECUTION_EXPIRED')
})
