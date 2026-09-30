import { expect, test, vi } from 'vitest'
import type { Cookie } from 'electron'
import { copyConnectionCookies } from '../src/main/connection-cookies'

let cookie = (overrides: Partial<Cookie> = {}): Cookie => ({ name: 'fixture', value: 'fixture-value', domain: 'example.test', path: '/', secure: false, httpOnly: true, hostOnly: true, session: true, sameSite: 'lax', ...overrides })
let store = (cookies: Cookie[] = []) => ({ get: vi.fn(async () => cookies), set: vi.fn(async () => {}), flushStore: vi.fn(async () => {}) })

test('restores overlapping cookies through HTTPS while preserving cookie attributes', async () => {
  let source = store([cookie({ secure: true, hostOnly: false, domain: '.example.test', sameSite: 'strict', expirationDate: 1900000000 }), cookie({ path: '/account' })]), target = store()
  expect(await copyConnectionCookies(source, target)).toBe(0)
  expect(target.set.mock.calls).toEqual([
    [{ url: 'https://example.test/', name: 'fixture', value: 'fixture-value', domain: '.example.test', path: '/', secure: true, httpOnly: true, sameSite: 'strict', expirationDate: 1900000000 }],
    [{ url: 'https://example.test/account', name: 'fixture', value: 'fixture-value', path: '/account', secure: false, httpOnly: true, sameSite: 'lax', expirationDate: undefined }],
  ])
  expect(target.flushStore).toHaveBeenCalledOnce()
})

test('keeps cookies already in the destination when retrying a partial copy', async () => {
  let target = store([cookie({ value: 'newer', secure: true })])
  await copyConnectionCookies(store([cookie()]), target)
  expect(target.set).not.toHaveBeenCalled()
})

test('continues copying after Chromium rejects an individual cookie', async () => {
  let target = store()
  target.set.mockRejectedValueOnce(new Error('EXCLUDE_OVERWRITE_SECURE'))
  expect(await copyConnectionCookies(store([cookie(), cookie({ name: 'second' })]), target)).toBe(1)
  expect(target.set).toHaveBeenCalledTimes(2)
  expect(target.flushStore).toHaveBeenCalledOnce()
})
