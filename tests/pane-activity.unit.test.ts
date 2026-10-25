import { expect, test } from 'vitest'
import { activityAge, activityLabel, compactActivityLabel, windowActivityTime, windowVisitTime, sessionActivityTime } from '../src/shared/pane-activity'
import { newPane } from '../src/main/model'

test('pane activity distinguishes missing, recent, old and future timestamps', () => {
  let now = 2_000_000_000_000
  expect(activityLabel(undefined, now)).toBe('')
  expect(activityLabel(now + 1000, now)).toBe('just now')
  expect(activityLabel(now - 59000, now)).toBe('just now')
  expect(activityLabel(now - 60000, now)).toBe('1m ago')
  expect(activityLabel(now - 3600000, now)).toBe('1h ago')
  expect(activityLabel(now - 86400000, now)).toBe('1d ago')
  expect(activityLabel(now - 604800000, now)).toBe('1w ago')
})

test('window visits use one recorded time and retain legacy pane times until visited', () => {
  let first = newPane('profile_default'), second = newPane('profile_default')
  expect(windowVisitTime({ panes: [first, second] })).toBeUndefined()
  first.lastActivityAt = 1000; second.lastActivityAt = 2000
  expect(windowVisitTime({ panes: [first, second] })).toBe(2000)
  expect(windowVisitTime({ lastVisitedAt: 1500, panes: [first, second] })).toBe(1500)
})

test('visit age changes at one hour and one day, including future timestamps', () => {
  let now = 2_000_000_000_000
  expect(activityAge(now + 1000, now)).toBe('recent')
  expect(activityAge(now - 3599999, now)).toBe('recent')
  expect(activityAge(now - 3600000, now)).toBe('today')
  expect(activityAge(now - 86399999, now)).toBe('today')
  expect(activityAge(now - 86400000, now)).toBe('old')
})

test('session use includes agent activity, pane interaction, and window visits', () => {
  let pane = newPane('profile_default')
  expect(sessionActivityTime({ windows: [] })).toBeUndefined()
  expect(sessionActivityTime({ lastActivityAt: 1000, windows: [] })).toBe(1000)
  let window = { id: 'window', name: 'main', layout: null, lastVisitedAt: 1500, panes: [pane] }
  pane.lastActivityAt = 2000
  expect(sessionActivityTime({ lastActivityAt: 1000, windows: [window] })).toBe(2000)
  expect(sessionActivityTime({ lastActivityAt: 3000, windows: [window] })).toBe(3000)
})

test('compact status ages use minutes, hours and days without an ago suffix', () => {
  let now = 2_000_000_000_000
  expect(compactActivityLabel(undefined, now)).toBe('')
  expect(compactActivityLabel(now + 1000, now)).toBe('jn')
  expect(compactActivityLabel(now - 59999, now)).toBe('jn')
  expect(compactActivityLabel(now - 60000, now)).toBe('1m')
  expect(compactActivityLabel(now - 13 * 60000, now)).toBe('13m')
  expect(compactActivityLabel(now - 3599999, now)).toBe('59m')
  expect(compactActivityLabel(now - 3600000, now)).toBe('1h')
  expect(compactActivityLabel(now - 86399999, now)).toBe('23h')
  expect(compactActivityLabel(now - 86400000, now)).toBe('1d')
  expect(compactActivityLabel(now - 13 * 86400000, now)).toBe('13d')
})

test('window status uses the latest actual pane activity, independently of visits', () => {
  let first = newPane('profile_default'), second = newPane('profile_default')
  let window = { panes: [first, second], lastVisitedAt: 9000 }
  expect(windowActivityTime(window)).toBeUndefined()
  first.lastActivityAt = 1000; second.lastActivityAt = 2000
  expect(windowActivityTime(window)).toBe(2000)
  window.lastVisitedAt = 10000
  expect(windowActivityTime(window)).toBe(2000)
  expect(windowVisitTime(window)).toBe(10000)
})
