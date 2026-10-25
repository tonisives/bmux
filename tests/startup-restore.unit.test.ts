import { expect, it } from 'vitest'
import { shouldDeferStartupPane } from '../src/main/startup-restore'

let cases = [
  { backgroundStartup: false, backgroundProfile: false, deferBackground: false, deferred: true },
  { backgroundStartup: false, backgroundProfile: false, deferBackground: true, deferred: true },
  { backgroundStartup: false, backgroundProfile: true, deferBackground: false, deferred: false },
  { backgroundStartup: false, backgroundProfile: true, deferBackground: true, deferred: false },
  { backgroundStartup: true, backgroundProfile: false, deferBackground: false, deferred: true },
  { backgroundStartup: true, backgroundProfile: false, deferBackground: true, deferred: true },
  { backgroundStartup: true, backgroundProfile: true, deferBackground: false, deferred: false },
  { backgroundStartup: true, backgroundProfile: true, deferBackground: true, deferred: true },
]

it.each(cases)('initial restore: headless=$backgroundStartup background profile=$backgroundProfile opt-in=$deferBackground', options => {
  expect(shouldDeferStartupPane({ ...options, lazyRestore: true })).toBe(options.deferred)
})

it.each(cases)('lazyRestore=false eagerly restores: headless=$backgroundStartup background profile=$backgroundProfile opt-in=$deferBackground', options => {
  expect(shouldDeferStartupPane({ ...options, lazyRestore: false })).toBe(false)
})

it.each(cases)('keepAlive eagerly restores: headless=$backgroundStartup background profile=$backgroundProfile opt-in=$deferBackground', options => {
  expect(shouldDeferStartupPane({ ...options, lazyRestore: true, keepAlive: true })).toBe(false)
})
