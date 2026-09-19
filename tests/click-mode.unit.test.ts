import { expect, it } from 'vitest'
import { createDoubleTapTracker, generateHints, usableHintCharacters } from '../src/shared/click-mode'
import type { DoubleTapInput } from '../src/shared/click-mode'

let option = (type: 'keyDown' | 'keyUp', alt = type === 'keyDown'): DoubleTapInput => ({ type, key: 'Alt', code: 'AltLeft', alt, control: false, meta: false, shift: false })

it('generates equal-length hints without prefix conflicts', () => {
  expect(generateHints(0, 'ab')).toEqual([])
  expect(generateHints(2, 'ab')).toEqual(['A', 'B'])
  expect(generateHints(3, 'ab')).toEqual(['AA', 'AB', 'BA'])
  let hints = generateHints(30, 'asdfg')
  expect(hints).toHaveLength(30)
  expect(new Set(hints).size).toBe(30)
  expect(hints.every(hint => hint.length === 3)).toBe(true)
})

it('reserves action-first link keys from legacy hint alphabets', () => {
  expect(usableHintCharacters('asfghjl')).toBe('asgj')
})

it('detects two quick pure modifier taps and resets invalid attempts', () => {
  let tracker = createDoubleTapTracker()
  expect(tracker.update(option('keyDown'), 'Option', 0)).toBe(false)
  expect(tracker.update(option('keyUp'), 'Option', 100)).toBe(false)
  expect(tracker.update(option('keyDown'), 'Option', 250)).toBe(false)
  expect(tracker.update(option('keyUp'), 'Option', 300)).toBe(true)

  expect(tracker.update(option('keyDown'), 'Option', 1000)).toBe(false)
  expect(tracker.update(option('keyUp'), 'Option', 1250)).toBe(false)
  expect(tracker.update(option('keyDown'), 'Option', 1300)).toBe(false)
  expect(tracker.update(option('keyUp'), 'Option', 1350)).toBe(false)

  expect(tracker.update(option('keyDown'), 'Option', 2000)).toBe(false)
  expect(tracker.update({ ...option('keyDown'), key: 'x', code: 'KeyX', alt: false }, 'Option', 2010)).toBe(false)
  expect(tracker.update(option('keyDown'), 'Option', 2020)).toBe(false)
  expect(tracker.update(option('keyUp'), 'Option', 2030)).toBe(false)
})
