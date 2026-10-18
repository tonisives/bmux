import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

export let usePanelStack = () => {
  let [selected, setSelected] = useState<string | null>(null)
  let list = useRef<HTMLElement>(null), backButton = useRef<HTMLButtonElement>(null)
  let previous = useRef<string | null>(null)
  useEffect(() => {
    if (selected) backButton.current?.focus()
    else if (previous.current) {
      let button = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-details]') ?? []).find(button => button.dataset.details === previous.current)
      if (button) button.focus()
      else list.current?.focus()
    }
    previous.current = selected
  }, [selected])
  let open = (event: MouseEvent<HTMLButtonElement>) => setSelected(event.currentTarget.dataset.details ?? null)
  let back = () => setSelected(null)
  let keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && selected) { event.preventDefault(); event.stopPropagation(); back(); return }
    if (event.key !== 'i' || event.metaKey || event.ctrlKey || event.altKey || selected) return
    let target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable=true]')) return
    let row = target.closest('[data-panel-row]')
    let button = row?.querySelector<HTMLButtonElement>('[data-details]')
    if (button) { event.preventDefault(); event.stopPropagation(); button.click() }
  }
  return { selected, setSelected, list, backButton, open, back, keys }
}
