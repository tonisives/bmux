import { useEffect, useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

export let captureAddressPointer = (event: PointerEvent<HTMLInputElement>) => {
  if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId)
}

export let useAddressSelection = () => {
  let cleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => cleanup.current?.(), [])
  return (event: MouseEvent<HTMLInputElement>) => {
    cleanup.current?.()
    // Keep native word selection and dragging already-selected text.
    if (event.button !== 0 || event.detail !== 1) return
    let input = event.currentTarget
    let context = document.createElement('canvas').getContext('2d')!
    let style = getComputedStyle(input)
    context.font = style.font
    context.letterSpacing = style.letterSpacing
    let offsets = [0, ...Array.from(new Intl.Segmenter().segment(input.value), part => part.index + part.segment.length)]
    let width = (index: number) => context.measureText(input.value.slice(0, offsets[index])).width
    let leftInset = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    let rightInset = parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)
    let position = (x: number) => {
      let distance = x - input.getBoundingClientRect().left - leftInset + input.scrollLeft
      let low = 0, high = offsets.length - 1
      while (low < high) {
        let middle = Math.floor((low + high) / 2)
        if (distance < (width(middle) + width(middle + 1)) / 2) high = middle
        else low = middle + 1
      }
      return offsets[low]
    }
    let cursor = position(event.clientX)
    let start = input.selectionStart ?? 0, end = input.selectionEnd ?? 0
    if (!event.shiftKey && start !== end && cursor >= start && cursor <= end) return
    event.preventDefault()
    let anchor = event.shiftKey ? input.selectionDirection === 'backward' ? end : start : cursor
    let x = event.clientX, y = event.clientY, frame = 0
    let select = () => {
      let bounds = input.getBoundingClientRect()
      let outside = y < bounds.top || y > bounds.bottom
      // A diagonal drag follows its horizontal direction; only a vertical drag follows y.
      let towardStart = x < event.clientX || (x === event.clientX && y < bounds.top)
      let cursor = outside ? towardStart ? 0 : input.value.length : position(x)
      input.setSelectionRange(Math.min(anchor, cursor), Math.max(anchor, cursor), cursor < anchor ? 'backward' : 'forward')
    }
    input.focus({ preventScroll: true })
    select()
    let scroll = () => {
      let bounds = input.getBoundingClientRect()
      if (y < bounds.top || y > bounds.bottom) { select(); frame = 0; return }
      let distance = x < bounds.left + leftInset ? x - bounds.left - leftInset : Math.max(0, x - bounds.right + rightInset)
      input.scrollLeft += Math.max(-20, Math.min(20, distance))
      select()
      frame = distance ? requestAnimationFrame(scroll) : 0
    }
    let move = (event: globalThis.MouseEvent) => {
      x = event.clientX
      y = event.clientY
      cancelAnimationFrame(frame)
      scroll()
    }
    let finish = () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', finish)
      document.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      cleanup.current = undefined
    }
    cleanup.current = finish
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', finish)
    document.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
  }
}
