export let viewportPanDelta = (event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>, width: number, height: number) => {
  let x = event.deltaX, y = event.deltaY
  return { x: x * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1), y: y * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1) }
}
