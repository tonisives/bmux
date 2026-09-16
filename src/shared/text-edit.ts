export let deleteWordBackward = (value: string, selectionStart: number, selectionEnd: number) => {
  let start = Math.max(0, Math.min(selectionStart, value.length))
  let end = Math.max(start, Math.min(selectionEnd, value.length))
  if (start === end) {
    while (start > 0 && /\s/u.test(value[start - 1])) start--
    while (start > 0 && !/\s/u.test(value[start - 1])) start--
  }
  return { value: value.slice(0, start) + value.slice(end), cursor: start }
}
