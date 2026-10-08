import { expect, it, vi } from 'vitest'
import { observeViewerFocus, receiveViewerMessage } from '../remote/web/viewer-updates'

it('refreshes after returning to a viewer and stops observing when it closes', () => {
  let target = new EventTarget(), visibility = Object.assign(new EventTarget(), { hidden: false }), refresh = vi.fn()
  let stop = observeViewerFocus(refresh, target, visibility)
  target.dispatchEvent(new Event('focus'))
  expect(refresh).toHaveBeenCalledTimes(1)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  target.dispatchEvent(new Event('focus'))
  expect(refresh).toHaveBeenCalledTimes(1)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(refresh).toHaveBeenCalledTimes(2)
  stop()
  target.dispatchEvent(new Event('focus'))
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(refresh).toHaveBeenCalledTimes(2)
})

it.each(['CONTROL_EXPIRED', 'CONTROL_HELD'])('refreshes ownership after %s while preserving the operation error', error => {
  let events = { state: vi.fn(), error: vi.fn(), ready: vi.fn(), refresh: vi.fn() }
  receiveViewerMessage({ type: 'error', error }, events)
  expect(events.refresh).toHaveBeenCalledOnce()
  expect(events.error).toHaveBeenCalledWith(error)
  expect(events.ready).not.toHaveBeenCalled()
})

it('applies the refreshed state after a takeover and completes pending watch readiness', () => {
  let events = { state: vi.fn(), error: vi.fn(), ready: vi.fn(), refresh: vi.fn() }
  let state = { type: 'state' as const, sessions: [], viewports: {}, pane: 'pane', controls: {} }
  receiveViewerMessage(state, events)
  expect(events.state).toHaveBeenCalledWith(state)
  expect(events.ready).toHaveBeenCalledOnce()
  expect(events.refresh).not.toHaveBeenCalled()
})

it('reports other operation errors without retrying or requesting another state', () => {
  let events = { state: vi.fn(), error: vi.fn(), ready: vi.fn(), refresh: vi.fn() }
  receiveViewerMessage({ type: 'error', error: 'Remote operation failed' }, events)
  expect(events.error).toHaveBeenCalledWith('Remote operation failed')
  expect(events.refresh).not.toHaveBeenCalled()
})
