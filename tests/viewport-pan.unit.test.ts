import { expect, test } from 'vitest'
import vm from 'node:vm'
import { observeViewportPan } from '../src/main/viewport-pan'
import { viewportPanDelta, viewportZoomFactor } from '../src/shared/viewport-pan'

let fixture = () => {
  let element = () => {
    let listeners = new Map<string, (event: any) => void>(), attributes = new Map<string, string>(), captured = new Set<number>()
    return { style: {}, isConnected: false, listeners, attributes, setAttribute: (key: string, value: string) => attributes.set(key, value), addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener), setPointerCapture: (id: number) => captured.add(id), hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture: (id: number) => captured.delete(id) }
  }
  let host = element(), surface = element(), button = element(), window = element(), reports: string[] = [], modes: boolean[] = []
  let root = { innerHTML: '', querySelector: (selector: string) => selector === 'div' ? surface : button }
  let context = vm.createContext({ window, document: { createElement: () => Object.assign(host, { attachShadow: () => root }), documentElement: { append: () => { host.isConnected = true } } }, console: { debug: (value: string) => { let data = JSON.parse(value.slice(4)); if (typeof data.mode === 'boolean') modes.push(data.mode); else reports.push(value) } } })
  let configure = (area: unknown) => vm.runInContext(`(${observeViewportPan.toString()})('pan:', ${JSON.stringify(area)}, ${viewportPanDelta.toString()})`, context)
  let fire = (target: typeof surface, type: string, properties = {}) => {
    let event = { isTrusted: true, button: 0, pointerId: 1, screenX: 100, screenY: 100, altKey: false, metaKey: false, prevented: false, stopped: false, preventDefault: () => { event.prevented = true }, stopPropagation: () => { event.stopped = true }, stopImmediatePropagation: () => { event.stopped = true }, ...properties }
    target.listeners.get(type)?.(event)
    return event
  }
  return { host, surface, button, window, reports, modes, configure, fire }
}

test('hand mode, modifier dragging, cancellation and clipping updates preserve page input', () => {
  let f = fixture(), area = { x: 0, y: 0, width: 320, height: 200 }
  f.configure(area)
  expect(f.surface.style).toMatchObject({ pointerEvents: 'none' })
  f.fire(f.window, 'keydown', { shiftKey: true })
  expect(f.surface.style).toMatchObject({ pointerEvents: 'none' })
  f.fire(f.button, 'click')
  expect(f.button.attributes.get('aria-pressed')).toBe('true')
  expect(f.surface.style).toMatchObject({ pointerEvents: 'auto', cursor: 'grab' })
  f.fire(f.surface, 'pointerdown')
  expect(f.surface.style).toMatchObject({ cursor: 'grabbing' })
  f.fire(f.surface, 'pointermove', { screenX: 80, screenY: 70 })
  expect(f.reports).toEqual(['pan:{"x":20,"y":30}'])
  f.configure({ ...area, x: 20, y: 30 })
  expect(f.host.style).toMatchObject({ left: '20px', top: '30px' })
  f.fire(f.surface, 'pointerup')
  f.fire(f.window, 'keydown', { key: 'Escape' })
  expect(f.surface.style).toMatchObject({ pointerEvents: 'none' })
  for (let modifier of ['altKey', 'metaKey']) {
    f.fire(f.window, 'keydown', { [modifier]: true })
    expect(f.surface.style).toMatchObject({ pointerEvents: 'auto' })
    f.fire(f.surface, 'wheel', { deltaX: 0, deltaY: 24, deltaMode: 0, isTrusted: false })
    expect(f.reports).toHaveLength(1)
    f.fire(f.surface, 'wheel', { deltaX: 0, deltaY: 24, deltaMode: 0 })
    expect(f.reports.pop()).toBe('pan:{"x":0,"y":24}')
    f.fire(f.window, 'blur')
    expect(f.surface.style).toMatchObject({ pointerEvents: 'none' })
  }
  f.fire(f.button, 'click')
  f.configure(undefined)
  expect(f.host.style).toMatchObject({ display: 'none' })
  expect(f.button.attributes.get('aria-pressed')).toBe('true')
  f.configure({ ...area, toggled: false })
  expect(f.button.attributes.get('aria-pressed')).toBe('false')
  f.fire(f.button, 'click')
  f.fire(f.window, 'blur')
  expect(f.button.attributes.get('aria-pressed')).toBe('true')
  f.fire(f.button, 'click')
  expect(f.button.attributes.get('aria-pressed')).toBe('false')
  expect(f.modes.slice(-2)).toEqual([true, false])
})

test('pan wheels preserve both axes and normalize line and page deltas', () => {
  expect(viewportPanDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 320, 200)).toEqual({ x: 0, y: 48 })
  expect(viewportPanDelta({ deltaX: 0, deltaY: -24, deltaMode: 0 }, 320, 200)).toEqual({ x: 0, y: -24 })
  expect(viewportPanDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 320, 200)).toEqual({ x: 0, y: 200 })
  expect(viewportPanDelta({ deltaX: 24, deltaY: 0, deltaMode: 0 }, 320, 200)).toEqual({ x: 24, y: 0 })
  expect(viewportPanDelta({ deltaX: -1, deltaY: 1, deltaMode: 2 }, 320, 200)).toEqual({ x: -320, y: 200 })
})

test('hand controls counter page zoom and share the authoritative pressed state', () => {
  let f = fixture()
  for (let zoom of [.5, 1, 2]) {
    f.configure({ x: 0, y: 0, width: 320 / zoom, height: 200 / zoom, zoom, toggled: true })
    expect(f.button.style).toMatchObject({ transform: `scale(${1 / zoom})`, right: `${12 / zoom}px`, top: `${12 / zoom}px` })
    expect(f.button.attributes.get('aria-pressed')).toBe('true')
    f.fire(f.surface, 'wheel', { deltaX: 10, deltaY: 20, deltaMode: 0 })
    expect(JSON.parse(f.reports.pop()!.slice(4))).toEqual({ x: 10 * zoom, y: 20 * zoom })
  }
})

test('Alt wheel zooms without panning and clamps the page zoom range', () => {
  let f = fixture()
  f.configure({ x: 0, y: 0, width: 320, height: 200, control: false })
  expect(f.button.style).toMatchObject({ display: 'none' })
  f.fire(f.window, 'keydown', { altKey: true })
  f.fire(f.surface, 'wheel', { altKey: true, deltaX: 0, deltaY: -40, deltaMode: 0 })
  expect(f.reports).toEqual(['pan:{"zoom":-40}'])
  expect(viewportZoomFactor(1, -40)).toBeGreaterThan(1)
  expect(viewportZoomFactor(1, 40)).toBeLessThan(1)
  expect(viewportZoomFactor(1, -10000)).toBe(3)
  expect(viewportZoomFactor(1, 10000)).toBe(.25)
})
