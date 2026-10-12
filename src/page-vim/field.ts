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

export let readField = (field: TextField) => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.innerText

export let writeField = (field: TextField, value: string, cursor: number) => {
  if (!field.isConnected || textField(field) !== field) return false
  if (field instanceof HTMLInputElement) value = value.replace(/[\r\n]/g, '')
  field.focus({ preventScroll: true })
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
      let selection = window.getSelection(), range = document.createRange()
      range.selectNodeContents(field)
      selection?.removeAllRanges(); selection?.addRange(range)
      // insertText with embedded newlines can create paragraphs whose innerText
      // gains extra blank lines. Explicit line breaks preserve the plain draft.
      let lines = value.split('\n')
      if (!document.execCommand('insertText', false, lines[0])) return false
      for (let line of lines.slice(1)) {
        if (!document.execCommand('insertLineBreak')) return false
        if (line && !document.execCommand('insertText', false, line)) return false
      }
    }
  }
  if (!field.isConnected || readField(field) !== value) return false
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(field.type)) field.setSelectionRange(Math.min(value.length, cursor), Math.min(value.length, cursor))
  return true
}
