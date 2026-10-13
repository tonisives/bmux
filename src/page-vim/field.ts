export type TextField = HTMLInputElement | HTMLTextAreaElement | HTMLElement

export let textField = (element: Element | null): TextField | undefined => {
  if (!(element instanceof HTMLElement)) return
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly ? element : undefined
  if (element instanceof HTMLInputElement) return ['text', 'search', 'url', 'tel', 'email'].includes(element.type) && !element.disabled && !element.readOnly ? element : undefined
  if (!element.isContentEditable) return
  let field = element
  while (field.parentElement?.isContentEditable) field = field.parentElement
  return field.getAttribute('aria-readonly') !== 'true' && field.getAttribute('aria-disabled') !== 'true' ? field : undefined
}

let editableText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').replace(/\u00a0/g, ' ')
  if (!(node instanceof HTMLElement)) return ''
  if (node.tagName === 'BR') return '\n'
  let children = [...node.childNodes]
  // Chromium adds a final BR as a caret placeholder on an empty last line.
  if (children.at(-1) instanceof HTMLBRElement) children.pop()
  let text = '', previousBlock = false, first = true
  for (let child of children) {
    let display = child instanceof HTMLElement ? getComputedStyle(child).display : ''
    if (display === 'none' || child instanceof HTMLElement && ['SCRIPT', 'STYLE'].includes(child.tagName)) continue
    let block = ['block', 'list-item', 'table-row', 'flex', 'grid', 'flow-root'].includes(display)
    if (!first && (block || previousBlock)) text += '\n'
    text += editableText(child)
    previousBlock = block; first = false
  }
  return text
}

// Read logical lines and raw spacing, without innerText's paragraph margins and
// whitespace collapsing. Website styles should not change the plain-text draft.
export let readField = (field: TextField) => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : editableText(field)

export type FieldSelection = { anchor: number; head: number }

let selectField = (field: TextField, selection: FieldSelection) => {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(field.type)) {
    let anchor = Math.min(field.value.length, selection.anchor), head = Math.min(field.value.length, selection.head)
    field.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? 'backward' : 'forward')
  }
}

export let writeField = (field: TextField, value: string, selection: FieldSelection) => {
  if (!field.isConnected || textField(field) !== field) return false
  if (field instanceof HTMLInputElement) {
    selection = { anchor: value.slice(0, selection.anchor).replace(/[\r\n]/g, '').length, head: value.slice(0, selection.head).replace(/[\r\n]/g, '').length }
    value = value.replace(/[\r\n]/g, '')
  }
  if (readField(field) !== value) {
    if (!field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'insertReplacementText', data: value }))) return false
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      // Bypass React's instance value tracker, then notify its real page handlers.
      let prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      // Native editing preserves the rich editor's model, input events, and undo.
      // Never replace its HTML: Draft.js/Lexical and other composers own that DOM.
      field.focus({ preventScroll: true })
      let selection = window.getSelection(), range = document.createRange()
      // Selecting the host's child boundaries inserts before an empty paragraph.
      // Select within its text blocks so native replacement keeps one logical line.
      let start: Node = field, end: Node = field
      while (start.firstChild) start = start.firstChild
      while (end.lastChild) end = end.lastChild
      if (start instanceof HTMLBRElement) range.setStartBefore(start)
      else range.setStart(start, 0)
      if (end instanceof HTMLBRElement) range.setEndAfter(end)
      else range.setEnd(end, end.nodeType === Node.TEXT_NODE ? end.nodeValue!.length : end.childNodes.length)
      selection?.removeAllRanges(); selection?.addRange(range)
      // insertText with embedded newlines can create paragraphs whose innerText
      // gains extra blank lines. Explicit line breaks preserve the plain draft.
      let lines = value.split('\n')
      // An empty insert leaves a zero-height paragraph with no caret placeholder.
      // Native deletion leaves a proper empty editing line for the next live edit.
      if (!document.execCommand(lines[0] ? 'insertText' : 'delete', false, lines[0])) return false
      for (let line of lines.slice(1)) {
        if (!document.execCommand('insertLineBreak')) return false
        if (line && !document.execCommand('insertText', false, line)) return false
      }
    }
  }
  if (!field.isConnected || readField(field) !== value) return false
  selectField(field, selection)
  return true
}
