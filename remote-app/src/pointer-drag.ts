type Point = { x: number; y: number }
type PointerInput = Point & { type: 'mouseDown' | 'mouseMove' | 'mouseUp'; button: 'left'; clickCount?: number }

export let createPointerDrag = (send: (event: PointerInput, generation: number) => void) => {
  let held: { point: Point; generation: number } | undefined
  let end = () => {
    let previous = held
    held = undefined
    if (previous) send({ type: 'mouseUp', ...previous.point, button: 'left', clickCount: 1 }, previous.generation)
  }
  return {
    start: (point: Point, generation: number) => {
      end()
      held = { point, generation }
      send({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }, generation)
    },
    move: (point?: Point) => {
      if (!held || !point) return
      held.point = point
      send({ type: 'mouseMove', ...point, button: 'left' }, held.generation)
    },
    end,
  }
}
