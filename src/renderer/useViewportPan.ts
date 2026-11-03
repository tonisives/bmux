import { useEffect } from 'react'
import type { RefObject } from 'react'
import type { Bridge } from '../shared/types'

export let useViewportPan = (viewport: RefObject<HTMLDivElement | null>, paneId: string, enabled: boolean) => {
  useEffect(() => {
    let element = viewport.current
    if (!element || !enabled) return
    let unsubscribe = bridge.viewportScroll((pane, x, y) => { if (pane === paneId) element.scrollBy(x, y) })
    return unsubscribe
  }, [paneId, enabled, viewport])
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
