import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, RefObject } from 'react'
import type { Bridge } from '../shared/types'
import { createVimInputState, resetVimInputState, vimInputKey } from '../shared/vim-input'

export let useAddressVim = (moveSuggestion?: (direction: number) => void, focusVersion?: number, initialMode = 'NORMAL', enabled = true, inputRef?: RefObject<HTMLInputElement | null>, exit?: () => void) => {
  let [mode, setMode] = useState(initialMode)
  let state = useRef(createVimInputState())
  let visual = useRef({ anchor: 0, cursor: 0 })
  let selectField = (input: HTMLInputElement) => {
    let start = input.selectionStart ?? 0, end = input.selectionEnd ?? start
    if (start === end) { reset(); return }
    visual.current = input.selectionDirection === 'backward' ? { anchor: end - 1, cursor: start } : { anchor: start, cursor: end - 1 }
    reset('VISUAL')
  }
  let reset = (mode = 'NORMAL') => { setMode(mode); resetVimInputState(state.current) }
  let select = (event: MouseEvent<HTMLInputElement>) => { if (enabled && mode !== 'INSERT' && event.button === 0) selectField(event.currentTarget) }
  useEffect(() => {
    reset(initialMode)
    let input = inputRef?.current
    if (enabled && initialMode === 'NORMAL' && input && input.selectionStart !== input.selectionEnd) selectField(input)
  }, [focusVersion, enabled])
  useEffect(() => {
    let input = inputRef?.current, selecting = false
    if (!input || !enabled || mode === 'INSERT') return
    let down = () => { selecting = true }
    let up = () => { if (selecting) { selecting = false; selectField(input) } }
    input.addEventListener('mousedown', down)
    document.addEventListener('mouseup', up)
    return () => { input.removeEventListener('mousedown', down); document.removeEventListener('mouseup', up) }
  }, [inputRef, enabled, mode])
  let keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return false
    let input = event.currentTarget
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      if (!enabled) return true
      if (mode === 'NORMAL' && exit) { reset(); exit(); return true }
      let cursor = mode === 'VISUAL' ? visual.current.cursor : input.selectionStart ?? 0
      if (mode === 'INSERT' && input.selectionStart === input.selectionEnd) cursor = Math.max(0, cursor - 1)
      cursor = Math.min(cursor, Math.max(0, input.value.length - 1))
      input.setSelectionRange(cursor, cursor); reset()
      return true
    }
    if (!enabled || mode === 'INSERT') return false
    if (mode !== 'VISUAL' && ['Backspace', 'Delete'].includes(event.key)) { reset('INSERT'); return false }
    if (event.metaKey || event.altKey) return false
    if (event.ctrlKey && event.key.toLowerCase() !== 'r') return false
    let cursor = mode === 'VISUAL' ? visual.current.cursor : Math.min(input.selectionStart ?? 0, Math.max(0, input.value.length - 1))
    if (event.key === 'v') {
      event.preventDefault(); event.stopPropagation()
      if (mode === 'VISUAL') { input.setSelectionRange(cursor, cursor); reset() }
      else { visual.current = { anchor: cursor, cursor }; input.setSelectionRange(cursor, Math.min(input.value.length, cursor + 1)); reset('VISUAL') }
      return true
    }
    let start = input.selectionStart ?? cursor, end = input.selectionEnd ?? cursor
    if (mode === 'VISUAL' && event.key === 'y') {
      event.preventDefault(); event.stopPropagation()
      state.current.register = input.value.slice(start, end)
      void bridge.clipboard(state.current.register).catch(() => undefined)
      input.setSelectionRange(start, start); reset(); return true
    }
    let yanking = state.current.operator === 'y'
    if (!event.ctrlKey && !state.current.operator && !state.current.pending && ['p', 'P'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      let count = Math.min(999, Number(state.current.count || 1)), key = event.key
      resetVimInputState(state.current)
      void bridge.clipboard().then(text => {
        if (!input.isConnected || document.activeElement !== input) return
        state.current.register = text
        let cursor = Math.min(input.selectionStart ?? 0, Math.max(0, input.value.length - 1)), position = Math.min(input.value.length, cursor + (key === 'p' ? 1 : 0))
        input.setSelectionRange(position, position); document.execCommand('insertText', false, text.replace(/[\r\n]/g, '').repeat(count)); input.setSelectionRange(position, position)
      }).catch(() => undefined)
      return true
    }
    let wholeFieldDelete = mode === 'NORMAL' && state.current.operator === 'd' && !state.current.pending && event.key === 'd' && !event.ctrlKey
    let action = mode === 'VISUAL' && ['x', 'd', 'c', 's', 'Backspace', 'Delete'].includes(event.key)
      ? { kind: 'edit' as const, start, end, text: '', insert: true }
      : event.ctrlKey ? { kind: 'redo' as const } : vimInputKey(state.current, input.value, cursor, event.key)
    if (yanking && action.kind === 'move') void bridge.clipboard(state.current.register).catch(() => undefined)
    if (action.kind === 'pass') return false
    event.preventDefault(); event.stopPropagation()
    if (action.kind === 'move' || action.kind === 'insert') {
      if (mode === 'VISUAL' && action.kind === 'move') {
        visual.current.cursor = action.cursor
        let anchor = visual.current.anchor
        input.setSelectionRange(Math.min(anchor, action.cursor), Math.min(input.value.length, Math.max(anchor, action.cursor) + 1), action.cursor < anchor ? 'backward' : 'forward')
      } else {
        input.setSelectionRange(action.cursor, action.cursor)
        if (action.kind === 'insert') reset('INSERT')
      }
    } else if (action.kind === 'edit') {
      let insert = action.insert || !wholeFieldDelete && !action.text && action.end > action.start
      if (!action.text && action.end > action.start) { state.current.register = input.value.slice(action.start, action.end); void bridge.clipboard(state.current.register).catch(() => undefined) }
      input.setSelectionRange(action.start, action.end)
      document.execCommand(action.text ? 'insertText' : 'delete', false, action.text)
      let cursor = insert ? action.start + action.text.length : Math.min(action.start, Math.max(0, input.value.length - 1))
      input.setSelectionRange(cursor, cursor)
      if (insert || wholeFieldDelete) reset(insert ? 'INSERT' : 'NORMAL')
    } else if (action.kind === 'undo' || action.kind === 'redo') document.execCommand(action.kind)
    else if (action.kind === 'suggestion') moveSuggestion?.(action.direction)
    return true
  }
  return { mode: enabled ? mode : 'INSERT', enabled, keys, reset, select }
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
