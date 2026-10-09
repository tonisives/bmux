import { expect, test } from 'vitest'
import { activityLabel } from '../src/shared/pane-activity'

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
