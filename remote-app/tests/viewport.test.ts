import { describe, expect, it } from 'vitest'
import { fitViewport, identityTransform, pagePoint } from '../src/viewport'

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
  it('fits logical phone dimensions within the host limits', () => {
    expect(fitViewport({ width: 393, height: 673 })).toEqual({ width: 393, height: 673 })
    expect(fitViewport({ width: 250, height: 1500 })).toEqual({ width: 320, height: 1080 })
  })
})
