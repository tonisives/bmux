import { describe, expect, it } from 'vitest'
import { fitViewport, identityTransform, pagePoint, pinchTransform } from '../src/viewport'

describe('stream coordinates', () => {
  let frame = { width: 400, height: 800 }, viewport = { width: 1600, height: 900, generation: 7 }
  it('maps the center of a letterboxed desktop page to CSS coordinates', () => {
    expect(pagePoint({ x: 200, y: 400 }, frame, viewport, identityTransform)).toEqual({ x: 800, y: 450 })
  })
  it('ignores the letterbox rather than clicking the page edge', () => {
    expect(pagePoint({ x: 200, y: 200 }, frame, viewport, identityTransform)).toBeUndefined()
  })
  it('inverts zoom and pan before applying browser coordinates', () => {
    expect(pagePoint({ x: 200, y: 400 }, frame, viewport, { zoom: 2, x: 100, y: -50 })).toEqual({ x: 600, y: 550 })
  })
  it('does not emit coordinates during an unmeasured layout', () => {
    expect(pagePoint({ x: 0, y: 0 }, { width: 0, height: 0 }, viewport, identityTransform)).toBeUndefined()
  })
  it('keeps the page point under the moving pinch center at both zoom limits', () => {
    let initial = { zoom: 2, x: 30, y: -20 }, start = { x: 180, y: 430 }, end = { x: 240, y: 380 }
    let expected = pagePoint(start, frame, viewport, initial)
    for (let ratio of [0.1, 1.5, 10]) {
      let transform = pinchTransform(frame, initial, start, end, ratio)
      expect(transform.zoom).toBeGreaterThanOrEqual(1)
      expect(transform.zoom).toBeLessThanOrEqual(5)
      expect(pagePoint(end, frame, viewport, transform)).toEqual(expected)
    }
  })
  it('fits logical phone dimensions within the host limits', () => {
    expect(fitViewport({ width: 393, height: 673 })).toEqual({ width: 393, height: 673 })
    expect(fitViewport({ width: 250, height: 1500 })).toEqual({ width: 320, height: 1080 })
  })
})

// A fold changes display size without changing which part of the remote page is enlarged.
it('retains zoom and the viewed page point through display resizing', async () => {
  let { resizeTransform } = await import('../src/viewport')
  let viewport = { width: 1200, height: 800 }
  let open = { width: 600, height: 400 }, folded = { width: 300, height: 600 }
  let transform = { zoom: 2, x: -80, y: 40 }
  let resized = resizeTransform(open, folded, viewport, transform)
  expect(resized).toEqual({ zoom: 2, x: -40, y: 20 })
  expect(resizeTransform(folded, open, viewport, resized)).toEqual(transform)
})
