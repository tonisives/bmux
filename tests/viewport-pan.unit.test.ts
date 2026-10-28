import { expect, test } from 'vitest'
import vm from 'node:vm'
import { observeViewportPan } from '../src/main/viewport-pan'
import { viewportPanDelta } from '../src/shared/viewport-pan'

for (let mac of [true, false]) test(`viewport panning consumes only trusted ${mac ? 'Command' : 'Ctrl'} wheel input while enabled`, () => {
  let listener: (event: any) => void = () => undefined, reports: string[] = []
  let context = vm.createContext({ innerWidth: 320, innerHeight: 200, window: { addEventListener: (_type: string, callback: typeof listener) => { listener = callback } }, console: { debug: (message: string) => reports.push(message) } })
  let configure = (enabled: boolean) => vm.runInContext(`(${observeViewportPan.toString()})('pan:', ${enabled}, ${mac}, ${viewportPanDelta.toString()})`, context)
  let wheel = (properties = {}) => {
    let event = { deltaX: 12, deltaY: 24, deltaMode: 0, shiftKey: false, metaKey: false, ctrlKey: false, isTrusted: true, prevented: false, stopped: false, preventDefault: () => { event.prevented = true }, stopImmediatePropagation: () => { event.stopped = true }, ...properties }
    listener(event)
    return event
  }
  let modifier = mac ? { metaKey: true } : { ctrlKey: true }
  configure(true)
  expect(wheel()).toMatchObject({ prevented: false, stopped: false })
  expect(wheel({ ...modifier, isTrusted: false })).toMatchObject({ prevented: false, stopped: false })
  expect(reports).toEqual([])
  expect(wheel(modifier)).toMatchObject({ prevented: true, stopped: true })
  expect(reports).toEqual(['pan:{"x":12,"y":24}'])
  configure(false)
  expect(wheel(modifier)).toMatchObject({ prevented: false, stopped: false })
  expect(reports).toHaveLength(1)
})

test('line wheels, page wheels and Shift-wheel preserve horizontal and vertical distances', () => {
  expect(viewportPanDelta({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: true }, 320, 200)).toEqual({ x: 48, y: 0 })
  expect(viewportPanDelta({ deltaX: -1, deltaY: 1, deltaMode: 2, shiftKey: false }, 320, 200)).toEqual({ x: -320, y: 200 })
})
