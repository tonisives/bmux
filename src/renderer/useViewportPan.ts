import { useEffect } from 'react'
import type { RefObject } from 'react'
import type { Bridge } from '../shared/types'
import { viewportPanDelta } from '../shared/viewport-pan'

export let useViewportPan = (viewport: RefObject<HTMLDivElement | null>, paneId: string, enabled: boolean, toggled = false, clientId?: string) => {
  useEffect(() => {
    let element = viewport.current
    if (!element || !enabled) return
    let root = element.closest<HTMLElement>('[data-pane-id], [data-floating-pane]') ?? element
    let unsubscribe = bridge.viewportScroll((pane, x, y) => { if (pane === paneId) element.scrollBy(x, y) })
    let dragging: { id: number; x: number; y: number } | undefined
    let modifier = false
    let previousCursor = root.style.cursor
    let cursor = () => { root.style.cursor = dragging ? 'grabbing' : toggled || modifier ? 'grab' : previousCursor }
    let end = () => {
      if (dragging && root.hasPointerCapture(dragging.id)) root.releasePointerCapture(dragging.id)
      dragging = undefined; cursor()
    }
    let down = (event: PointerEvent) => {
      if (event.button !== 0 || !(toggled || event.altKey || event.metaKey) || (event.target as Element).closest('button,input,select,textarea,a,[data-edge]')) return
      event.preventDefault(); event.stopPropagation()
      dragging = { id: event.pointerId, x: event.screenX, y: event.screenY }
      root.setPointerCapture(event.pointerId); cursor()
      if (clientId) void bridge.command({ method: 'select-pane', args: { client: clientId, pane: paneId, focus: false } })
    }
    let move = (event: PointerEvent) => {
      modifier = event.altKey || event.metaKey
      if (dragging && event.pointerId === dragging.id) {
        event.preventDefault(); event.stopPropagation()
        element.scrollBy(dragging.x - event.screenX, dragging.y - event.screenY)
        dragging.x = event.screenX; dragging.y = event.screenY
      }
      cursor()
    }
    let wheel = (event: WheelEvent) => {
      if (!(toggled || event.altKey || event.metaKey)) return
      event.preventDefault(); event.stopPropagation()
      let delta = viewportPanDelta(event, element.clientWidth, element.clientHeight)
      element.scrollBy(delta.x, delta.y)
    }
    let keys = (event: KeyboardEvent) => {
      modifier = event.altKey || event.metaKey
      if (event.key === 'Escape') {
        end()
        if (toggled) void bridge.command({ method: 'viewport.pan-mode', args: { pane: paneId, enabled: false } })
      }
      cursor()
    }
    let blur = () => { modifier = false; end() }
    let lost = () => { dragging = undefined; cursor() }
    root.addEventListener('pointerdown', down, true)
    root.addEventListener('pointermove', move, true)
    root.addEventListener('pointerup', end)
    root.addEventListener('pointercancel', end)
    root.addEventListener('lostpointercapture', lost)
    element.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', keys)
    window.addEventListener('keyup', keys)
    window.addEventListener('blur', blur)
    cursor()
    return () => {
      end(); unsubscribe(); root.style.cursor = previousCursor
      root.removeEventListener('pointerdown', down, true)
      root.removeEventListener('pointermove', move, true)
      root.removeEventListener('pointerup', end)
      root.removeEventListener('pointercancel', end)
      root.removeEventListener('lostpointercapture', lost)
      element.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', keys)
      window.removeEventListener('keyup', keys)
      window.removeEventListener('blur', blur)
    }
  }, [paneId, enabled, toggled, clientId, viewport])
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
