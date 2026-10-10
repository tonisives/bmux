import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

export let useAddressVim = (moveSuggestion?: (direction: number) => void, focusVersion?: number) => {
  let [mode, setMode] = useState('NORMAL')
  useEffect(() => { setMode('NORMAL') }, [focusVersion])
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return false
    let input = event.currentTarget
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setMode('NORMAL')
      return true
    }
    if (mode === 'INSERT' || event.metaKey || event.ctrlKey || event.altKey) return false
    let start = input.selectionStart ?? 0, end = input.selectionEnd ?? start
    let cursor = start
    if (['i', 'a', 'I', 'A', '/'].includes(event.key)) {
      if (event.key === 'I') cursor = 0
      else if (event.key === 'A') cursor = input.value.length
      else if (event.key === 'a') cursor = Math.min(input.value.length, end + (start === end ? 1 : 0))
      if (!['i', '/'].includes(event.key)) input.setSelectionRange(cursor, cursor)
      setMode('INSERT')
    } else if (event.key === 'h') cursor = Math.max(0, start - 1)
    else if (event.key === 'l') cursor = Math.min(input.value.length, end + 1)
    else if (event.key === '0' || event.key === '^') cursor = 0
    else if (event.key === '$') cursor = input.value.length
    else if (event.key === 'w') cursor = start + (input.value.slice(start).match(/^(?:\w+\W*|\W+)/)?.[0].length || 1)
    else if (event.key === 'b') cursor = start - (input.value.slice(0, start).match(/\w+\W*$|\W+$/)?.[0].length || 1)
    else if (event.key === 'x' || event.key === 's') {
      input.setSelectionRange(start, start === end ? Math.min(input.value.length, end + 1) : end)
      document.execCommand('delete')
      if (event.key === 's') setMode('INSERT')
    } else if (event.key === 'j' || event.key === 'k') moveSuggestion?.(event.key === 'j' ? 1 : -1)
    else if (event.key.length !== 1) return false
    event.preventDefault(); event.stopPropagation()
    if (['h', 'l', '0', '^', '$', 'w', 'b'].includes(event.key)) input.setSelectionRange(Math.max(0, Math.min(input.value.length, cursor)), Math.max(0, Math.min(input.value.length, cursor)))
    return true
  }
  return { mode, keys, reset: () => setMode('NORMAL') }
}
