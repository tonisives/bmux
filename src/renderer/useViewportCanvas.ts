import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { viewportPanMetrics, viewportPanScroll } from '../shared/viewport-pan'

export let useViewportCanvas = (viewport: RefObject<HTMLDivElement | null>, size: { width: number; height: number } | undefined) => {
  useLayoutEffect(() => {
    let element = viewport.current
    if (!element || !size) return
    element.style.setProperty('--remote-width', `${size.width}px`)
    element.style.setProperty('--remote-height', `${size.height}px`)
    let scroll = { x: 0, y: 0 }, width = 0, height = 0
    let resize = () => {
      width = element.clientWidth; height = element.clientHeight
      let x = viewportPanMetrics(size.width, width), y = viewportPanMetrics(size.height, height)
      element.style.setProperty('--pan-inset-x', `${x.inset}px`)
      element.style.setProperty('--pan-inset-y', `${y.inset}px`)
      element.dataset.panOriginX = String(x.origin); element.dataset.panOriginY = String(y.origin)
      scroll = { x: Math.max(x.min, Math.min(x.max, scroll.x)), y: Math.max(y.min, Math.min(y.max, scroll.y)) }
      element.scrollTo(scroll.x + x.origin, scroll.y + y.origin)
    }
    let record = () => { if (element.clientWidth === width && element.clientHeight === height) scroll = viewportPanScroll(element) }
    let observer = new ResizeObserver(resize)
    element.addEventListener('scroll', record)
    observer.observe(element); resize()
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', record)
      delete element.dataset.panOriginX; delete element.dataset.panOriginY
      element.style.removeProperty('--pan-inset-x'); element.style.removeProperty('--pan-inset-y')
    }
  }, [viewport, size?.width, size?.height])
}
