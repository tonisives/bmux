export type VimInputState = { count: string; operator?: 'd' | 'c' | 'y'; operatorCount: number; pending?: string; register: string; find?: { key: string; character: string } }
export type VimInputAction = { kind: 'move'; cursor: number } | { kind: 'edit'; start: number; end: number; text: string; insert: boolean } | { kind: 'insert'; cursor: number } | { kind: 'suggestion'; direction: number } | { kind: 'undo' | 'redo' | 'handled' | 'pass' }
export let createVimInputState = (): VimInputState => ({ count: '', operatorCount: 1, register: '' })
export let resetVimInputState = (state: VimInputState) => { state.count = ''; state.operator = undefined; state.operatorCount = 1; state.pending = undefined }
let category = (character: string, big: boolean) => !character || /\s/u.test(character) ? 0 : big || /[\p{L}\p{N}_]/u.test(character) ? 1 : 2
export let vimMotion = (text: string, cursor: number, key: string, count = 1): number | undefined => {
  let position = Math.max(0, Math.min(text.length, cursor)), big = key === key.toUpperCase()
  if (key === '0' || key === 'gg') return 0
  if (key === '^') return Math.max(0, text.search(/\S/u))
  if (key === '$' || key === 'G') return Math.max(0, text.length - 1)
  if (key === 'h') return Math.max(0, position - count)
  if (key === 'l') return Math.min(text.length, position + count)
  if (!['w', 'W', 'b', 'B', 'e', 'E'].includes(key)) return undefined
  for (let index = 0; index < count; index++) {
    if (key.toLowerCase() === 'w') {
      let current = category(text[position], big)
      while (position < text.length && category(text[position], big) === current) position++
      while (position < text.length && !category(text[position], big)) position++
    } else if (key.toLowerCase() === 'b') {
      position = Math.max(0, position - 1)
      while (position > 0 && !category(text[position], big)) position--
      let current = category(text[position], big)
      while (position > 0 && category(text[position - 1], big) === current) position--
    } else {
      if (position < text.length - 1) position++
      while (position < text.length - 1 && !category(text[position], big)) position++
      let current = category(text[position], big)
      while (position < text.length - 1 && category(text[position + 1], big) === current) position++
    }
  }
  return Math.min(text.length, position)
}
export let vimFind = (text: string, cursor: number, key: string, character: string, count: number) => {
  let forward = key === 'f' || key === 't', position = cursor
  for (let index = 0; index < count; index++) {
    let found = forward ? text.indexOf(character, position + 1) : position > 0 ? text.lastIndexOf(character, position - 1) : -1
    if (found < 0) return undefined
    position = found
  }
  return position + (key === 't' ? -1 : key === 'T' ? 1 : 0)
}
export let vimWordRange = (text: string, cursor: number, big: boolean, around: boolean) => {
  let start = Math.min(cursor, Math.max(0, text.length - 1)), end = start, current = category(text[start], big)
  while (start > 0 && category(text[start - 1], big) === current) start--
  while (end < text.length && category(text[end], big) === current) end++
  if (around && current) {
    let trailing = end
    while (end < text.length && !category(text[end], big)) end++
    if (end === trailing) while (start > 0 && !category(text[start - 1], big)) start--
  }
  return { start, end }
}
let operatorAction = (state: VimInputState, text: string, start: number, end: number): VimInputAction => {
  let operator = state.operator
  state.register = text.slice(start, end); resetVimInputState(state)
  return operator === 'y' ? { kind: 'move', cursor: start } : { kind: 'edit', start, end, text: '', insert: operator === 'c' }
}
let finishMotion = (state: VimInputState, text: string, cursor: number, destination: number, inclusive: boolean): VimInputAction => {
  if (state.operator) return operatorAction(state, text, Math.min(cursor, destination), Math.min(text.length, Math.max(cursor, destination) + (inclusive ? 1 : 0)))
  resetVimInputState(state)
  return { kind: 'move', cursor: Math.max(0, Math.min(Math.max(0, text.length - 1), destination)) }
}
export let vimInputKey = (state: VimInputState, text: string, cursor: number, key: string): VimInputAction => {
  let count = Math.min(999, Number(state.count || 1) * state.operatorCount)
  if (state.pending === 'r') {
    resetVimInputState(state)
    return key.length === 1 && cursor < text.length ? { kind: 'edit', start: cursor, end: Math.min(text.length, cursor + count), text: key.repeat(Math.min(count, text.length - cursor)), insert: false } : { kind: 'handled' }
  }
  if (state.pending && ['f', 'F', 't', 'T'].includes(state.pending)) {
    let findKey = state.pending; state.pending = undefined
    if (key.length !== 1) { resetVimInputState(state); return { kind: 'handled' } }
    state.find = { key: findKey, character: key }
    let destination = vimFind(text, cursor, findKey, key, count)
    if (destination !== undefined) return finishMotion(state, text, cursor, destination, true)
    resetVimInputState(state); return { kind: 'handled' }
  }
  if (state.pending === 'i' || state.pending === 'a') {
    let around = state.pending === 'a'; state.pending = undefined
    if (key === 'w' || key === 'W') { let range = vimWordRange(text, cursor, key === 'W', around); return operatorAction(state, text, range.start, range.end) }
    resetVimInputState(state); return { kind: 'handled' }
  }
  if (/^[1-9]$/.test(key) || key === '0' && state.count) { state.count = (state.count + key).slice(0, 3); return { kind: 'handled' } }
  if (state.pending === 'g') { state.pending = undefined; if (key === 'g') return finishMotion(state, text, cursor, 0, false) }
  if (key === 'g' || ['f', 'F', 't', 'T', 'r'].includes(key) || state.operator && ['i', 'a'].includes(key)) { state.pending = key; return { kind: 'handled' } }
  if (key === ';' || key === ',') {
    let find = state.find
    if (find) {
      let findKey = key === ';' ? find.key : ({ f: 'F', F: 'f', t: 'T', T: 't' } as Record<string, string>)[find.key]
      let origin = findKey === 't' && text[cursor + 1] === find.character ? cursor + 1 : findKey === 'T' && text[cursor - 1] === find.character ? cursor - 1 : cursor
      let destination = vimFind(text, origin, findKey, find.character, count)
      if (destination !== undefined) return finishMotion(state, text, cursor, destination, true)
    }
    resetVimInputState(state); return { kind: 'handled' }
  }
  if (['d', 'c', 'y'].includes(key)) {
    if (state.operator === key) return operatorAction(state, text, 0, text.length)
    state.operator = key as 'd' | 'c' | 'y'; state.operatorCount = count; state.count = ''; return { kind: 'handled' }
  }
  let motionKey = state.operator === 'c' && ['w', 'W'].includes(key) && category(text[cursor], false) ? key === 'w' ? 'e' : 'E' : key
  let destination = state.operator === 'c' && motionKey !== key ? vimMotion(text, vimWordRange(text, cursor, key === 'W', false).end - 1, motionKey, count - 1) : vimMotion(text, cursor, motionKey, count)
  if (destination !== undefined) return finishMotion(state, text, cursor, destination, ['e', 'E', '$', 'G'].includes(motionKey))
  let incompleteOperator = !!state.operator
  resetVimInputState(state)
  if (incompleteOperator) return { kind: 'handled' }
  if (['i', 'a', 'I', 'A', '/'].includes(key)) return { kind: 'insert', cursor: key === 'I' ? 0 : key === 'A' ? text.length : key === 'a' ? Math.min(text.length, cursor + 1) : cursor }
  if (['x', 's', 'D', 'C', 'S'].includes(key)) {
    let start = key === 'S' ? 0 : cursor, end = ['D', 'C', 'S'].includes(key) ? text.length : Math.min(text.length, cursor + count)
    state.register = text.slice(start, end)
    return { kind: 'edit', start, end, text: '', insert: ['s', 'C', 'S'].includes(key) }
  }
  if (key === 'p' || key === 'P') { let position = Math.min(text.length, cursor + (key === 'p' ? 1 : 0)); return { kind: 'edit', start: position, end: position, text: state.register.repeat(count), insert: false } }
  if (key === 'u') return { kind: 'undo' }
  if (key === 'j' || key === 'k') return { kind: 'suggestion', direction: (key === 'j' ? 1 : -1) * count }
  return { kind: key.length === 1 ? 'handled' : 'pass' }
}
