import { expect, it, vi } from 'vitest'
import { createPointerDrag } from '../src/pointer-drag'

it('releases at the last valid page point when a drag ends outside the viewport', () => {
  let send = vi.fn(), drag = createPointerDrag(send)
  drag.start({ x: 100, y: 200 }, 4)
  drag.move({ x: 300, y: 400 })
  drag.move(undefined)
  drag.end()
  expect(send.mock.calls).toEqual([
    [{ type: 'mouseDown', x: 100, y: 200, button: 'left', clickCount: 1 }, 4],
    [{ type: 'mouseMove', x: 300, y: 400, button: 'left' }, 4],
    [{ type: 'mouseUp', x: 300, y: 400, button: 'left', clickCount: 1 }, 4],
  ])
})
it('cancels a held pointer before another drag and releases only once', () => {
  let send = vi.fn(), drag = createPointerDrag(send)
  drag.start({ x: 10, y: 20 }, 1)
  drag.start({ x: 30, y: 40 }, 2)
  drag.end(); drag.end(); drag.move({ x: 50, y: 60 })
  expect(send.mock.calls.map(([event, generation]) => [event.type, generation])).toEqual([['mouseDown', 1], ['mouseUp', 1], ['mouseDown', 2], ['mouseUp', 2]])
})
