import { useEffect, useRef } from 'react'
import type { ComponentPropsWithRef } from 'react'
import css from './SearchInput.module.css'

export let SearchInput = ({ ref, ...props }: ComponentPropsWithRef<'input'>) => {
  let local = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let keys = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault(); local.current?.focus(); local.current?.select()
    }
    document.addEventListener('keydown', keys)
    return () => document.removeEventListener('keydown', keys)
  }, [])
  let attach = (element: HTMLInputElement | null) => {
    local.current = element
    if (typeof ref === 'function') return ref(element)
    if (ref) ref.current = element
  }
  return <input {...props} ref={attach} className={css.search} placeholder="/ to search" autoComplete="off" spellCheck={false} />
}
