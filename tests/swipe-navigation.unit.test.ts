import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { createSwipeGesture, createSwipeNavigation } from '../src/main/swipe-navigation'

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

test('horizontal intent locks early and tracks each event despite vertical drift', () => {
  let { gesture, preview, navigate, finish } = fixture()
  expect(gesture.push({ x: -3, y: 1, blocked: false })).toBe(true)
  expect(preview).toHaveBeenLastCalledWith(0)
  expect(gesture.push({ x: -9, y: 4, blocked: false })).toBe(true)
  expect(preview).toHaveBeenLastCalledWith(12)
  expect(gesture.push({ x: -38, y: 20, blocked: false })).toBe(true)
  expect(preview).toHaveBeenLastCalledWith(50)
  expect(gesture.push({ x: -20, y: 35, blocked: false })).toBe(true)
  expect(preview).toHaveBeenLastCalledWith(70)
  finish()
  expect(gesture.active).toBe(false)
  expect(preview).toHaveBeenLastCalledWith(0)
  expect(navigate).not.toHaveBeenCalled()
})

test('vertical intent locks early without swallowing scrolling or later horizontal drift', () => {
  let { gesture, preview, navigate, finish } = fixture()
  expect(gesture.push({ x: -3, y: 9, blocked: false })).toBe(false)
  expect(gesture.push({ x: -240, y: 10, blocked: false })).toBe(false)
  finish()
  expect(preview.mock.calls.every(([offset]) => offset === 0)).toBe(true)
  expect(navigate).not.toHaveBeenCalled()
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

let navigationFixture = async () => {
  let goBack = vi.fn()
  let sendCommand = vi.fn(async (method: string, _params?: Record<string, unknown>) => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : method === 'Page.createIsolatedWorld' ? { executionContextId: 1 } : {})
  let contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack },
    debugger: Object.assign(new EventEmitter(), { isAttached: () => true, sendCommand }),
  })
  await createSwipeNavigation(contents as unknown as WebContents, () => true)()
  let source = String(sendCommand.mock.calls.find(([method]) => method === 'Runtime.evaluate')![1]!.expression)
  let marker = source.match(/bmux-swipe:[a-f0-9-]+/)![0]
  let request = () => contents.emit('console-message', { message: marker + JSON.stringify({ id: 'document:1', direction: 'back' }) })
  return { contents, goBack, request }
}

test('a swipe commits once outside the console callback, including duplicate delivery', async () => {
  let { goBack, request } = await navigationFixture()
  request(); request()
  expect(goBack).not.toHaveBeenCalled()
  await vi.runAllTimersAsync()
  expect(goBack).toHaveBeenCalledTimes(1)
  request()
  await vi.runAllTimersAsync()
  expect(goBack).toHaveBeenCalledTimes(1)
})

test('blur, navigation or renderer loss cancels a queued native swipe commit', async () => {
  for (let event of ['blur', 'did-start-navigation', 'render-process-gone']) {
    let { contents, goBack, request } = await navigationFixture()
    request()
    contents.emit(event, { isMainFrame: true, isSameDocument: false })
    await vi.runAllTimersAsync()
    expect(goBack).not.toHaveBeenCalled()
  }
})


test('a physical trackpad stays put while held and commits only on finger release', () => {
  let { gesture, wheel, preview, navigate } = fixture()
  gesture.phase('begin')
  wheel(-100, 8)
  vi.advanceTimersByTime(10000)
  expect(preview).toHaveBeenLastCalledWith(100)
  expect(navigate).not.toHaveBeenCalled()
  wheel(-100, 20)
  vi.advanceTimersByTime(10000)
  expect(preview).toHaveBeenLastCalledWith(200)
  expect(navigate).not.toHaveBeenCalled()
  gesture.phase('end')
  gesture.phase('momentum')
  vi.advanceTimersByTime(40)
  expect(navigate.mock.calls).toEqual([['back']])
  wheel(-300, 10)
  vi.advanceTimersByTime(1000)
  expect(navigate).toHaveBeenCalledTimes(1)
  gesture.phase('begin')
  wheel(200)
  gesture.phase('end')
  vi.advanceTimersByTime(40)
  expect(navigate.mock.calls).toEqual([['back'], ['forward']])
})

test('native vertical momentum stays scrollable and cannot become navigation', () => {
  let { gesture, navigate } = fixture()
  gesture.phase('begin')
  expect(gesture.push({ x: 2, y: 80, blocked: false })).toBe(false)
  gesture.phase('end')
  vi.advanceTimersByTime(40)
  gesture.phase('momentum')
  expect(gesture.push({ x: -300, y: 80, blocked: false })).toBe(false)
  expect(navigate).not.toHaveBeenCalled()
  gesture.cancel()
  gesture.phase('momentum')
  expect(gesture.push({ x: -300, y: 1, blocked: false })).toBe(false)
  vi.advanceTimersByTime(1000)
  expect(navigate).not.toHaveBeenCalled()
})

test('native cancellation and reversal return without navigating after a long hold', () => {
  let { gesture, wheel, preview, navigate } = fixture()
  gesture.phase('begin'); wheel(-240)
  vi.advanceTimersByTime(10000)
  wheel(220)
  gesture.phase('end'); vi.advanceTimersByTime(40)
  expect(preview).toHaveBeenLastCalledWith(0)
  gesture.phase('begin'); wheel(-240); gesture.phase('cancel')
  vi.advanceTimersByTime(10000)
  expect(navigate).not.toHaveBeenCalled()
})


test('a delayed native begin adopts the first wheel and inertial tails cannot commit a short swipe', () => {
  let { gesture, wheel, preview, navigate } = fixture()
  wheel(-70)
  gesture.phase('begin')
  vi.advanceTimersByTime(1000)
  expect(preview).toHaveBeenLastCalledWith(70)
  gesture.phase('end'); gesture.phase('momentum'); wheel(-300)
  vi.advanceTimersByTime(1000)
  expect(navigate).not.toHaveBeenCalled()
  gesture.phase('fallback'); wheel(-200)
  vi.advanceTimersByTime(1000)
  expect(navigate).toHaveBeenCalledWith('back')
})


test('the first wheel of a new physical gesture survives late begin delivery after release', () => {
  let { gesture, wheel, preview, navigate } = fixture()
  gesture.phase('begin'); wheel(-70); gesture.phase('end')
  vi.advanceTimersByTime(1000)
  wheel(-240)
  gesture.phase('begin')
  vi.advanceTimersByTime(1000)
  expect(preview).toHaveBeenLastCalledWith(240)
  expect(navigate).not.toHaveBeenCalled()
  gesture.phase('end'); vi.advanceTimersByTime(40)
  expect(navigate).toHaveBeenCalledWith('back')
})
