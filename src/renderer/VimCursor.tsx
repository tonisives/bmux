import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import css from './VimCursor.module.css'

export let VimCursor = ({ input, mode, value }: { input: RefObject<HTMLInputElement | null>; mode: string; value: string }) => {
  let cursor = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    let field = input.current, block = cursor.current
    if (!field || !block) return
    let canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
    let frame = 0
    let update = () => {
      let style = getComputedStyle(field), position = field.selectionStart ?? 0
      context.font = style.font
      context.letterSpacing = style.letterSpacing
      let character = field.value[position] || ' '
      let x = context.measureText(field.value.slice(0, position)).width + parseFloat(style.paddingLeft || '0') - field.scrollLeft
      let width = Math.max(1, context.measureText(character).width)
      if (mode === 'NORMAL' && document.activeElement === field && field.selectionStart === field.selectionEnd) {
        if (x < 0) field.scrollLeft += x
        else if (x + width > field.clientWidth) field.scrollLeft += x + width - field.clientWidth
        x = context.measureText(field.value.slice(0, position)).width + parseFloat(style.paddingLeft || '0') - field.scrollLeft
      }
      block.style.font = style.font
      block.style.setProperty('--vim-cursor-x', `${x}px`)
      block.style.setProperty('--vim-cursor-width', `${width}px`)
      block.style.setProperty('--vim-cursor-height', style.fontSize)
      block.textContent = character
    }
    let schedule = () => { update(); cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    let observer = new ResizeObserver(schedule)
    observer.observe(field)
    for (let event of ['select', 'input', 'scroll', 'keyup', 'pointerup', 'focus']) field.addEventListener(event, schedule)
    document.addEventListener('selectionchange', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame); observer.disconnect()
      for (let event of ['select', 'input', 'scroll', 'keyup', 'pointerup', 'focus']) field.removeEventListener(event, schedule)
      document.removeEventListener('selectionchange', schedule)
    }
  }, [input, mode, value])
  return <span ref={cursor} className={css.cursor} data-vim-cursor data-mode={mode} aria-hidden="true" />
}
