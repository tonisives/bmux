import { expect, test } from 'vitest'
import { newPane, newSession, newWindow } from '../src/main/model'
import { windowCloseBehavior } from '../src/shared/window-close'

test('closes a window directly and confirms only for multiple pages', () => {
  let session = newSession('test', 'profile')
  expect(windowCloseBehavior(session, session.windows[0])).toBe('close-window')
  let window = newWindow('second', 'profile')
  session.windows.push(window)
  expect(windowCloseBehavior(session, window)).toBe('close-window')
  window.panes.push(newPane('profile'))
  expect(windowCloseBehavior(session, window)).toBe('confirm')
})
