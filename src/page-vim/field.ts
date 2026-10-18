export type TextField = HTMLInputElement | HTMLTextAreaElement | HTMLElement

export let textField = (element: Element | null): TextField | undefined => {
  if (!(element instanceof HTMLElement)) return
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly ? element : undefined
  if (element instanceof HTMLInputElement) {
    // Codes and short structured values need the page's native typing behavior.
    if (element.maxLength >= 0 && element.maxLength <= 6 || element.autocomplete.split(/\s+/).includes('one-time-code') || ['numeric', 'decimal'].includes(element.inputMode)) return
    return ['text', 'search', 'url', 'tel', 'email'].includes(element.type) && !element.disabled && !element.readOnly ? element : undefined
  }
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

export let selectField = (field: TextField, selection: FieldSelection) => {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(field.type)) {
    let anchor = Math.min(field.value.length, selection.anchor), head = Math.min(field.value.length, selection.head)
    field.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? 'backward' : 'forward')
  } else if (field.classList.contains('public-DraftEditor-content') && document.activeElement === field) {
    let blocks = [...field.querySelectorAll<HTMLElement>('[data-block="true"]')]
    let point = (offset: number) => {
      for (let block of blocks) {
        let length = editableText(block).length
        if (offset > length && block !== blocks.at(-1)) { offset -= length + 1; continue }
        let walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), last: Node | undefined
        while (walker.nextNode()) {
          let node = walker.currentNode, length = node.nodeValue!.length
          if (offset <= length) return { node, offset }
          offset -= length; last = node
        }
        return last ? { node: last, offset: last.nodeValue!.length } : { node: block, offset: 0 }
      }
    }
    let anchor = point(selection.anchor), head = point(selection.head)
    if (anchor && head) {
      window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset)
      document.dispatchEvent(new Event('selectionchange'))
    }
  }
}

let selectRichContents = (field: HTMLElement) => {
  let selection = window.getSelection(), range = document.createRange()
  // Select within text blocks so replacement does not insert before them.
  let start: Node = field, end: Node = field
  while (start.firstChild) start = start.firstChild
  while (end.lastChild) end = end.lastChild
  if (start instanceof HTMLBRElement) range.setStartBefore(start)
  else range.setStart(start, 0)
  if (end instanceof HTMLBRElement) range.setEndAfter(end)
  else range.setEnd(end, end.nodeType === Node.TEXT_NODE ? end.nodeValue!.length : end.childNodes.length)
  selection?.removeAllRanges(); selection?.addRange(range)
}

let renderField = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

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
      if (field.classList.contains('public-DraftEditor-content')) {
        // Draft owns its text spans and model. Native replacement destroys those
        // spans; paste lets Draft replace the selected text in its own model.
        return (async () => {
          // Focus, selection, and paste each update Draft's controlled state.
          // Let each render finish before issuing the next event or blurring.
          await renderField()
          if (!field.isConnected) return false
          selectRichContents(field)
          document.dispatchEvent(new Event('selectionchange'))
          await renderField()
          let handled: boolean
          if (value) {
            let data = new DataTransfer()
            data.setData('text/plain', value)
            handled = !field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, composed: true, cancelable: true, clipboardData: data }))
          } else {
            handled = !field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8 }))
          }
          await renderField()
          return handled && field.isConnected && readField(field) === value
        })()
      }
      selectRichContents(field)
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
