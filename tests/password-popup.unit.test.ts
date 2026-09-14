import { expect, test } from 'vitest'
import { passwordPopupBounds } from '../src/main/password-popup'
import type { PasswordSuggestions } from '../src/shared/types'

let suggestion: PasswordSuggestions = { id: 'popup', tabId: 'tab', origin: 'https://example.test', anchor: { x: 20, y: 30, width: 200, height: 30 }, locked: true, items: [] }
test('password popup follows field coordinates and page zoom inside its pane', () => {
  expect(passwordPopupBounds({ x: 500, y: 60, width: 600, height: 700 }, suggestion, 1.5)).toEqual({ x: 530, y: 156, width: 300, height: 96 })
})
test('an unlocked account list leaves room for search above its rows', () => {
  let unlocked = { ...suggestion, locked: false, items: Array.from({ length: 8 }, (_, index) => ({ id: `${index}`, name: `Account ${index}`, username: `user-${index}` })) }
  expect(passwordPopupBounds({ x: 0, y: 0, width: 600, height: 700 }, unlocked, 1).height).toBe(372)
})
test('password popup opens above low fields and clamps at the pane edge', () => {
  expect(passwordPopupBounds({ x: 500, y: 60, width: 300, height: 500 }, { ...suggestion, anchor: { x: 210, y: 420, width: 80, height: 30 } }, 1)).toEqual({ x: 520, y: 378, width: 280, height: 96 })
})
test('page-provided coordinates cannot position the popup outside its pane', () => {
  let bounds = passwordPopupBounds({ x: 500, y: 60, width: 300, height: 500 }, { ...suggestion, anchor: { x: 1e20, y: 1e20, width: 1e20, height: 1e20 } }, 1)
  expect(bounds.x).toBe(500)
  expect(bounds.y).toBeGreaterThanOrEqual(60)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(560)
})
