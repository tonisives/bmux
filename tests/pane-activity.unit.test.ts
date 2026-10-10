import { expect, test } from 'vitest'
import { activityLabel, windowVisitTime } from '../src/shared/pane-activity'
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
