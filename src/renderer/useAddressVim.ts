import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createVimInputState, resetVimInputState, vimInputKey } from '../shared/vim-input'

export let useAddressVim = (moveSuggestion?: (direction: number) => void, focusVersion?: number, initialMode = 'NORMAL') => {
  let [mode, setMode] = useState(initialMode)
  let state = useRef(createVimInputState())
  let reset = (mode = 'NORMAL') => { setMode(mode); resetVimInputState(state.current) }
  useEffect(() => reset(initialMode), [focusVersion])
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return false
    let input = event.currentTarget
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      let cursor = input.selectionStart ?? 0
      if (mode === 'INSERT' && input.selectionStart === input.selectionEnd) cursor = Math.max(0, cursor - 1)
      cursor = Math.min(cursor, Math.max(0, input.value.length - 1))
      input.setSelectionRange(cursor, cursor); reset()
      return true
    }
    if (mode === 'INSERT' || event.metaKey || event.altKey) return false
    if (event.ctrlKey && event.key.toLowerCase() !== 'r') return false
    let cursor = Math.min(input.selectionStart ?? 0, Math.max(0, input.value.length - 1))
    let action = event.ctrlKey ? { kind: 'redo' as const } : vimInputKey(state.current, input.value, cursor, event.key)
    if (action.kind === 'pass') return false
    event.preventDefault(); event.stopPropagation()
    if (action.kind === 'move' || action.kind === 'insert') {
      input.setSelectionRange(action.cursor, action.cursor)
      if (action.kind === 'insert') setMode('INSERT')
    } else if (action.kind === 'edit') {
      input.setSelectionRange(action.start, action.end)
      document.execCommand(action.text ? 'insertText' : 'delete', false, action.text)
      let cursor = action.insert ? action.start + action.text.length : Math.min(action.start, Math.max(0, input.value.length - 1))
      input.setSelectionRange(cursor, cursor)
      if (action.insert) setMode('INSERT')
    } else if (action.kind === 'undo' || action.kind === 'redo') document.execCommand(action.kind)
    else if (action.kind === 'suggestion') moveSuggestion?.(action.direction)
    return true
  }
  return { mode, keys, reset }
}
