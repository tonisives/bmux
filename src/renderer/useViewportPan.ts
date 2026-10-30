import { useEffect } from 'react'
import type { RefObject } from 'react'
import type { Bridge } from '../shared/types'
import { viewportPanDelta } from '../shared/viewport-pan'

export let useViewportPan = (viewport: RefObject<HTMLDivElement | null>, paneId: string, enabled: boolean) => {
  useEffect(() => {
    let element = viewport.current
    if (!element || !enabled) return
    let unsubscribe = bridge.viewportScroll((pane, x, y) => { if (pane === paneId) element.scrollBy(x, y) })
    let wheel = (event: WheelEvent) => {
      if (!event.shiftKey) return
      event.preventDefault(); event.stopPropagation()
      let delta = viewportPanDelta(event, element.clientWidth, element.clientHeight)
      element.scrollBy(delta.x, delta.y)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { unsubscribe(); element.removeEventListener('wheel', wheel) }
  }, [paneId, enabled, viewport])
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
