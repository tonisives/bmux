import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { getCM, vim, Vim } from '@replit/codemirror-vim'
import { readField, textField, writeField } from './field'
import type { FieldSelection, TextField } from './field'
import { matchesBinding } from '../shared/keyboard'
import { createFieldHints } from './hints'
import { mountInlineEditor } from './inline'
import css from './editor.css?inline'

type PageVim = { configure: (enabled: boolean, shortcuts: string[], platform: NodeJS.Platform) => void }
let scope = globalThis as typeof globalThis & { bmuxPageVim?: PageVim }

let relativeLineNumber = (line: number, state: EditorState) => {
  let current = state.doc.lineAt(state.selection.main.head).number
  return String(line === current ? line : Math.abs(line - current))
}

let install = (): PageVim => {
  Vim.map('zz', ':wq<CR>', 'normal')
  Vim.map('ZZ', ':wq<CR>', 'normal')
  let requests = new Map<number, (text: string) => void>(), sequence = 0
  let clipboardScope = globalThis as typeof globalThis & { bmuxVimClipboard: (payload: string) => void; bmuxVimClipboardResolve: (id: number, text: string) => void }
  clipboardScope.bmuxVimClipboardResolve = (id, text) => { requests.get(id)?.(text); requests.delete(id) }
  let clipboard = (operation: string, text?: string) => new Promise<string>(resolve => { let id = ++sequence; requests.set(id, resolve); clipboardScope.bmuxVimClipboard(JSON.stringify({ id, operation, text })) })
  let clipboardAuthorized = false
  let registers = Vim.getRegisterController(), pushText = registers.pushText.bind(registers)
  registers.pushText = (...args) => { pushText(...args); if (clipboardAuthorized && args[0] !== '_') void clipboard('write', registers.getRegister('"').toString()).catch(() => undefined) }

  let shortcuts: string[] = [], platform: NodeJS.Platform = 'darwin'
  let enabled = true, active: { host: HTMLElement; close: (save: boolean) => void } | undefined
  let open = (field: TextField) => {
    if (!enabled || active) return
    hints.hide()
    let original = readField(field), synced = original, host = document.createElement('div')
    host.dataset.bmuxVim = 'true'
    host.setAttribute('role', 'group')
    host.setAttribute('aria-label', 'Vim editor')
    let root = host.attachShadow({ mode: 'open' }), sheet = new CSSStyleSheet()
    sheet.replaceSync(css); root.adoptedStyleSheets = [sheet]
    let shell = document.createElement('div'), container = document.createElement('div'), status = document.createElement('div')
    shell.className = 'shell'; container.className = 'editor'; status.className = 'status'; status.hidden = true
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    shell.append(container, status); root.append(shell)
    let report = (message: string) => { status.textContent = message; status.hidden = false }
    let inline = mountInlineEditor(field, host)
    let cursor = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.selectionStart ?? 0 : original.length
    let savedSelection = { anchor: cursor, head: cursor }
    let relativeNumbers = new Compartment(), closing = false, syncQueued = false
    let scheduleSync = () => {
      if (syncQueued || closing) return
      syncQueued = true
      queueMicrotask(() => { syncQueued = false; if (!closing) sync() })
    }
    let view = new EditorView({
      parent: container, root,
      state: EditorState.create({ doc: original, selection: { anchor: cursor }, extensions: [
        vim(), drawSelection(), EditorView.updateListener.of(update => { if (update.docChanged || update.selectionSet) scheduleSync() }), history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
        relativeNumbers.of(lineNumbers({ formatNumber: relativeLineNumber })),
        EditorState.transactionExtender.of(transaction => transaction.selection || transaction.docChanged ? { effects: relativeNumbers.reconfigure(lineNumbers({ formatNumber: relativeLineNumber })) } : null),
        EditorView.contentAttributes.of({ 'aria-label': 'Vim text' }),
        EditorView.theme({ '&': { backgroundColor: 'var(--field-background)', color: 'var(--field-color)' }, '.cm-gutters': { backgroundColor: 'var(--field-background)', color: 'var(--field-color)', border: 'none', opacity: '.65' }, '.cm-cursor': { borderLeftColor: 'var(--field-color)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--field-color) 25%, transparent)' } }),
      ] }),
    })
    let write = (value: string, selection: FieldSelection) => {
      // Regular fields can update while hidden, without blurring the Vim editor.
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || readField(field) === value) return writeField(field, value, selection)
      let focused = root.activeElement as HTMLElement | null
      let result = inline.write(() => writeField(field, value, selection))
      if (focused === view.contentDOM) view.focus()
      else focused?.focus({ preventScroll: true })
      return result
    }
    let sync = () => {
      if (readField(field) !== synced) { report('Field changed on the page. Copy your draft or use :q to discard.'); return false }
      if (!write(view.state.doc.toString(), view.state.selection.main)) { report('Could not update this field. Copy your draft or use :q to discard.'); return false }
      synced = readField(field); status.hidden = true
      return true
    }
    let save = () => {
      if (!sync()) return false
      original = synced; savedSelection = { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }
      return true
    }
    let discard = () => {
      // Leave independent page changes intact; otherwise restore the last :w.
      if (readField(field) !== synced || synced === original || !field.isConnected) return true
      if (!write(original, savedSelection)) { report('Could not restore this field. Copy your draft or save to close.'); return false }
      return true
    }
    let close = (commit: boolean) => {
      if (closing || !(commit ? save() : discard())) return
      closing = true; active = undefined
      observer.disconnect()
      view.destroy(); inline.restore(); hints.refresh()
      if (field.isConnected) field.focus({ preventScroll: true })
    }
    active = { host, close }
    let observer = new MutationObserver(() => {
      inline.retain()
      let message = 'Field no longer available. Copy your draft or use :q to discard.'
      if (!field.isConnected && status.textContent !== message) report(message)
    })
    observer.observe(document, { subtree: true, childList: true })
    let fieldRoot = field.getRootNode()
    if (fieldRoot !== document) observer.observe(fieldRoot, { subtree: true, childList: true })
    let cm = getCM(view)!
    let mode = () => { let state = cm.state.vim; host.dataset.mode = state?.insertMode ? 'INSERT' : state?.visualMode ? 'VISUAL' : 'NORMAL' }
    cm.on('vim-mode-change', mode); mode()
    Vim.defineEx('write', 'w', () => { if (save()) { view.focus(); mode() } })
    Vim.defineEx('quit', 'q', () => queueMicrotask(() => close(false)))
    Vim.defineEx('wq', 'wq', () => queueMicrotask(() => close(true)))
    Vim.defineEx('xit', 'x', () => queueMicrotask(() => close(true)))
    root.addEventListener('keydown', event => {
      let key = event as KeyboardEvent
      if (!key.isTrusted) return
      clipboardAuthorized = true; setTimeout(() => { clipboardAuthorized = false }, 0)
      if (['p', 'P'].includes(key.key) && !key.metaKey && !key.ctrlKey && !key.altKey && !cm.state.vim?.insertMode && !cm.state.vim?.inputState.registerName && !root.querySelector('.cm-panel input')) {
        key.preventDefault(); key.stopImmediatePropagation()
        void clipboard('read').then(text => { if (closing) return; registers.getRegister('"').setText(text, text.endsWith('\n')); Vim.handleKey(cm, key.key, 'user') })
        return
      }
      if (key.key === 'Escape' && !key.isComposing && !cm.state.vim?.insertMode && !cm.state.vim?.visualMode && !root.querySelector('.cm-panel input')) {
        key.preventDefault(); key.stopImmediatePropagation(); close(true)
      }
    }, true)
    for (let type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, event => event.stopPropagation())
    view.focus()
  }
  let hints = createFieldHints(open)
  window.addEventListener('keydown', event => {
    if (!enabled || active || event.isComposing || event.repeat || !shortcuts.some(binding => matchesBinding(binding, { key: event.key, code: event.code, meta: event.metaKey, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey }, platform))) return
    let element = event.composedPath().find(item => item instanceof HTMLElement) as HTMLElement | undefined
    let field = textField(element ?? null)
    if (!field) return
    event.preventDefault(); event.stopImmediatePropagation(); open(field)
  }, true)
  window.addEventListener('bmux:vim-editor', () => {
    if (!enabled || active || !document.hasFocus()) return
    let element = document.activeElement
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
    let field = textField(element)
    if (field) open(field)
  })
  return { configure: (value, bindings, os) => {
    enabled = value; shortcuts = bindings; platform = os
    if (!enabled) active?.close(true)
    hints.configure(enabled && !active, shortcuts.join(' / '))
  } }
}

if (!scope.bmuxPageVim) scope.bmuxPageVim = install()
