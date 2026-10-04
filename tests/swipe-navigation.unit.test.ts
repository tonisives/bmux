import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createSwipeGesture } from '../src/main/swipe-navigation'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

let fixture = () => {
  let navigate = vi.fn(), gesture = createSwipeGesture(navigate)
  let wheel = (x: number, y = 0, blocked = false) => { gesture.push({ x, y, blocked }); vi.advanceTimersByTime(16) }
  return { navigate, gesture, wheel, finish: () => vi.advanceTimersByTime(220) }
}

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
