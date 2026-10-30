import { expect, test } from 'vitest'
import { newPane, newSession, newWindow } from '../src/main/model'
import { sessionIsLocked, windowCloseBehavior } from '../src/shared/window-close'

test('closes a window directly and confirms only for multiple pages', () => {
  let session = newSession('test', 'profile')
  expect(windowCloseBehavior(session, session.windows[0])).toBe('close-window')
  let window = newWindow('second', 'profile')
  session.windows.push(window)
  expect(windowCloseBehavior(session, window)).toBe('close-window')
  window.panes.push(newPane('profile'))
  expect(windowCloseBehavior(session, window)).toBe('confirm')
})

test('locked windows protect their session until every window is unlocked', () => {
  let session = newSession('test', 'profile'), first = session.windows[0], second = newWindow('second', 'profile')
  session.windows.push(second)
  expect(sessionIsLocked(session)).toBe(false)
  first.locked = true
  expect(windowCloseBehavior(session, first)).toBe('locked')
  expect(windowCloseBehavior(session, second)).toBe('close-window')
  expect(sessionIsLocked(session)).toBe(true)
  first.panes.push(newPane('profile'))
  expect(windowCloseBehavior(session, first)).toBe('locked')
  second.locked = true; first.locked = false
  expect(sessionIsLocked(session)).toBe(true)
  second.locked = false
  expect(sessionIsLocked(session)).toBe(false)
  expect(windowCloseBehavior(session, first)).toBe('confirm')
})
