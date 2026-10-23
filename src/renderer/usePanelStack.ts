import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { usePanelBack } from './PanelHeader'
import type { PanelBack } from './PanelHeader'

export let usePanelStack = (initial: string | null = null, label = 'Back', origin: PanelBack | null = null) => {
  let [selected, setSelected] = useState<string | null>(initial)
  let list = useRef<HTMLElement>(null)
  let previous = useRef<string | null>(null)
  let back = useCallback(() => setSelected(null), [])
  let navigation = useMemo(() => selected ? selected === initial && origin ? origin : { label, run: back } : null, [selected, initial, origin, label, back])
  usePanelBack(navigation)
  useEffect(() => {
    if (!selected && previous.current) {
      let button = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-details]') ?? []).find(button => button.dataset.details === previous.current)
      if (button) button.focus()
      else list.current?.focus()
    }
    previous.current = selected
  }, [selected])
  let open = (event: MouseEvent<HTMLButtonElement>) => setSelected(event.currentTarget.dataset.details ?? null)
  let keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && selected) { event.preventDefault(); event.stopPropagation(); navigation?.run(); return }
    if (event.key !== 'i' || event.metaKey || event.ctrlKey || event.altKey || selected) return
    let target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable=true]')) return
    let row = target.closest('[data-panel-row]')
    let button = row?.querySelector<HTMLButtonElement>('[data-details]')
    if (button) { event.preventDefault(); event.stopPropagation(); button.click() }
  }
  return { selected, setSelected, list, open, back, keys }
}
