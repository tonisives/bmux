export let viewportPanDelta = (event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>, width: number, height: number, zoom = 1) => {
  let x = event.deltaX, y = event.deltaY
  return { x: x * (event.deltaMode === 1 ? 16 * zoom : event.deltaMode === 2 ? width : zoom), y: y * (event.deltaMode === 1 ? 16 * zoom : event.deltaMode === 2 ? height : zoom) }
}

export let viewportZoomFactor = (current: number, delta: number) => Math.max(.25, Math.min(3, current * Math.exp(-delta * .002)))
