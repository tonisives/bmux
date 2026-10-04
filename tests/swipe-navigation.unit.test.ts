import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createSwipeGesture } from '../src/main/swipe-navigation'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

let fixture = (available = (_direction: 'back' | 'forward') => true) => {
  let navigate = vi.fn(), preview = vi.fn(), gesture = createSwipeGesture(navigate, preview, available)
  let wheel = (x: number, y = 0, blocked = false) => { gesture.push({ x, y, blocked }); vi.advanceTimersByTime(16) }
  return { navigate, preview, gesture, wheel, finish: () => vi.advanceTimersByTime(220) }
}

test('page follows a partial swipe and its reversal before returning on release', () => {
  let { wheel, preview, navigate, finish } = fixture()
  wheel(-3)
  expect(preview).toHaveBeenLastCalledWith(0)
  wheel(-67)
  expect(preview).toHaveBeenLastCalledWith(70)
  wheel(50)
  expect(preview).toHaveBeenLastCalledWith(20)
  expect(navigate).not.toHaveBeenCalled()
  finish()
  expect(preview).toHaveBeenLastCalledWith(0)
  expect(navigate).not.toHaveBeenCalled()
  wheel(100)
  expect(preview).toHaveBeenLastCalledWith(-100)
})

test('page gestures cancel the preview and keep ownership until release', () => {
  let { wheel, preview, finish } = fixture()
  wheel(-70)
  expect(preview).toHaveBeenLastCalledWith(70)
  wheel(-70, 0, true)
  expect(preview).toHaveBeenLastCalledWith(0)
  wheel(-70)
  expect(preview).toHaveBeenLastCalledWith(0)
  finish()
  wheel(0, 100); wheel(-200)
  expect(preview).toHaveBeenLastCalledWith(0)
})

test('unavailable history or a disabled target cannot preview or commit', () => {
  let allowed = true
  let { wheel, preview, navigate, finish } = fixture(direction => allowed && direction === 'back')
  wheel(240); finish()
  expect(preview.mock.calls.every(([offset]) => offset === 0)).toBe(true)
  expect(navigate).not.toHaveBeenCalled()
  wheel(-240)
  expect(preview).toHaveBeenLastCalledWith(240)
  allowed = false
  finish()
  expect(preview).toHaveBeenLastCalledWith(0)
  expect(navigate).not.toHaveBeenCalled()
})

test('commits back and forward once after the gesture and its momentum finish', () => {
  let { wheel, navigate, finish } = fixture()
  for (let x of [-80, -80, -80, -40, -20, -5]) wheel(x)
  expect(navigate).not.toHaveBeenCalled()
  finish()
  expect(navigate.mock.calls).toEqual([['back']])
  for (let x of [80, 80, 80]) wheel(x)
  finish()
  expect(navigate.mock.calls).toEqual([['back'], ['forward']])
})

test('short swipes, vertical scrolling and diagonal drift do not navigate', () => {
  let { wheel, navigate, finish } = fixture()
  wheel(-100); finish()
  wheel(-50, 100); wheel(-250); finish()
  wheel(-200, 150); finish()
  expect(navigate).not.toHaveBeenCalled()
})

test('reversing a swipe before release cancels navigation', () => {
  let { wheel, navigate, finish } = fixture()
  wheel(-220); wheel(180); finish()
  expect(navigate).not.toHaveBeenCalled()
})

test('page scrolling or a canceled wheel owns the entire gesture, including its edge', () => {
  let { wheel, navigate, finish } = fixture()
  wheel(60, 0, true); wheel(240); finish()
  expect(navigate).not.toHaveBeenCalled()
  wheel(-240); finish()
  expect(navigate).toHaveBeenCalledWith('back')
})

test('navigation, closing or loss of the target cancels pending work', () => {
  let { wheel, navigate, gesture, finish } = fixture()
  wheel(-240); gesture.cancel(); finish()
  expect(navigate).not.toHaveBeenCalled()
})
