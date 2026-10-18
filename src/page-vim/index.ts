import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { getCM, vim, Vim } from '@replit/codemirror-vim'
import { readField, selectField, textField, writeField } from './field'
import type { FieldSelection, TextField } from './field'
import { matchesBinding } from '../shared/keyboard'
import { createFieldHints } from './hints'
import { mountInlineEditor } from './inline'
import css from './editor.css?inline'

type PageVim = { configure: (enabled: boolean, shortcuts: string[], platform: NodeJS.Platform) => void }
let scope = globalThis as typeof globalThis & { bmuxPageVim?: PageVim; bmuxVimEditing?: boolean }

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
  registers.pushText = (...args) => { pushText(...args); if (clipboardAuthorized && args[0] !== '_' && args[1] === 'yank') void clipboard('write', registers.getRegister('"').toString()).catch(() => undefined) }

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
    let shell = document.createElement('div'), container = document.createElement('div')
    shell.className = 'shell'; container.className = 'editor'
    shell.append(container); root.append(shell)
    let inline = mountInlineEditor(field, host)
    let cursor = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.selectionStart ?? 0 : original.length
    let savedSelection = { anchor: cursor, head: cursor }
    let relativeNumbers = new Compartment(), closing = false, syncQueued = false, nativeWrite = false, syncing = Promise.resolve(true)
    let deferredInputs: (() => void)[] = []
    let scheduleSync = () => {
      if (syncQueued || closing) return
      syncQueued = true
      queueMicrotask(() => { syncQueued = false; if (!closing) void sync() })
    }
    let view = new EditorView({
      parent: container, root,
      state: EditorState.create({ doc: original, selection: { anchor: cursor }, extensions: [
        vim(), drawSelection(), EditorView.updateListener.of(update => { if (update.docChanged || update.selectionSet && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) scheduleSync() }), history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
        relativeNumbers.of(lineNumbers({ formatNumber: relativeLineNumber })),
        EditorState.transactionExtender.of(transaction => transaction.selection || transaction.docChanged ? { effects: relativeNumbers.reconfigure(lineNumbers({ formatNumber: relativeLineNumber })) } : null),
        EditorView.contentAttributes.of({ 'aria-label': 'Vim text' }),
        EditorView.theme({ '&': { backgroundColor: 'var(--field-background)', color: 'var(--field-color)' }, '.cm-gutters': { backgroundColor: 'var(--field-background)', color: 'var(--field-color)', border: 'none', opacity: '.65' }, '.cm-cursor': { borderLeftColor: 'var(--field-color)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--field-color) 25%, transparent)' } }),
      ] }),
    })
    let write = async (value: string, selection: FieldSelection) => {
      // Regular fields can update while hidden, without blurring the Vim editor.
      let focused = root.activeElement as HTMLElement | null ?? view.contentDOM
      let nativeSelection = !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
      nativeWrite = nativeSelection && readField(field) !== value
      let result = !nativeSelection || readField(field) === value ? writeField(field, value, selection) : inline.write(() => writeField(field, value, selection))
      let restoreFocus = () => {
        if (closing || nativeWrite || root.activeElement && root.activeElement !== focused) return
        if (focused === view.contentDOM) {
          // Native editing changes the document selection outside the shadow root.
          // Restore it explicitly; CodeMirror's cached range may still look current.
          if (nativeSelection) {
            let anchor = view.domAtPos(view.state.selection.main.anchor), head = view.domAtPos(view.state.selection.main.head)
            window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset)
          }
          if (nativeSelection) view.focus()
          else view.contentDOM.focus({ preventScroll: true })
        }
        else focused?.focus({ preventScroll: true })
      }
      if (!(result instanceof Promise)) restoreFocus()
      let accepted = await result
      nativeWrite = false
      restoreFocus()
      for (let input of deferredInputs.splice(0)) input()
      requestAnimationFrame(restoreFocus)
      return accepted
    }
    let sync = () => {
      syncing = syncing.then(async () => {
        if (closing) return false
        // A native focus swap would blur and dismiss Vim's command prompt.
        // Its command will synchronize the latest draft after the prompt closes.
        if (root.querySelector('.cm-vim-panel input')) return false
        if (readField(field) !== synced) return false
        if (!await write(view.state.doc.toString(), view.state.selection.main)) return false
        synced = readField(field)
        return true
      })
      return syncing
    }
    let save = async () => {
      if (!await sync()) return false
      original = synced; savedSelection = { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }
      return true
    }
    let discard = async () => {
      await syncing
      // Leave independent page changes intact; otherwise restore the last :w.
      if (readField(field) !== synced || synced === original || !field.isConnected) return true
      return write(original, savedSelection)
    }
    let close = async (commit: boolean) => {
      if (closing || !(commit ? await save() : await discard()) || closing) return
      closing = true; active = undefined; scope.bmuxVimEditing = false
      window.removeEventListener('keydown', forwardKey, true)
      window.removeEventListener('beforeinput', forwardInput, true)
      window.removeEventListener('focusin', keepNativeFocus, true)
      observer.disconnect()
      view.destroy(); inline.restore(); hints.refresh()
      if (field.isConnected) {
        field.focus({ preventScroll: true })
        selectField(field, savedSelection)
      }
    }
    active = { host, close }; scope.bmuxVimEditing = true
    let editorFocus: HTMLElement = view.contentDOM
    root.addEventListener('focusin', event => {
      editorFocus = event.target as HTMLElement
      if (editorFocus === view.contentDOM) scheduleSync()
    })
    let observer = new MutationObserver(() => {
      if (inline.retain() && !closing && !nativeWrite) editorFocus.focus({ preventScroll: true })
    })
    observer.observe(document, { subtree: true, childList: true })
    let fieldRoot = field.getRootNode()
    if (fieldRoot !== document) observer.observe(fieldRoot, { subtree: true, childList: true })
    let cm = getCM(view)!
    let forwardedKeys = new WeakSet<KeyboardEvent>()
    let dispatchKey = (forwarded: KeyboardEvent) => {
      forwardedKeys.add(forwarded)
      let prompt = root.querySelector<HTMLInputElement>('.cm-vim-panel input')
      if (prompt && root.activeElement === prompt) {
        if (prompt.dispatchEvent(forwarded) && forwarded.key.length === 1 && !forwarded.ctrlKey && !forwarded.metaKey && !forwarded.altKey) {
          prompt.setRangeText(forwarded.key, prompt.selectionStart ?? 0, prompt.selectionEnd ?? 0, 'end')
          prompt.dispatchEvent(new InputEvent('input', { bubbles: true, data: forwarded.key, inputType: 'insertText' }))
        }
        return
      }
      if (view.contentDOM.dispatchEvent(forwarded) && cm.state.vim?.insertMode && forwarded.key.length === 1 && !forwarded.ctrlKey && !forwarded.metaKey && !forwarded.altKey) view.dispatch({ ...view.state.replaceSelection(forwarded.key), userEvent: 'input.type' })
    }
    let forwardKey = (key: KeyboardEvent) => {
      if (!key.isTrusted || !nativeWrite && (key.composedPath().includes(host) || key.key !== 'Escape')) return
      let forwarded = new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, key: key.key, code: key.code, keyCode: key.keyCode, which: key.which, ctrlKey: key.ctrlKey, metaKey: key.metaKey, altKey: key.altKey, shiftKey: key.shiftKey, repeat: key.repeat })
      key.preventDefault(); key.stopImmediatePropagation()
      if (nativeWrite) deferredInputs.push(() => dispatchKey(forwarded))
      else dispatchKey(forwarded)
    }
    let forwardInput = (event: Event) => {
      let input = event as InputEvent
      if (!nativeWrite || !input.isTrusted) return
      input.preventDefault(); input.stopImmediatePropagation()
      if (input.data === null) return
      deferredInputs.push(() => view.dispatch({ ...view.state.replaceSelection(input.data!), userEvent: 'input.type' }))
    }
    let keepNativeFocus = (event: FocusEvent) => {
      if (nativeWrite && event.composedPath().includes(host)) queueMicrotask(() => { if (nativeWrite) field.focus({ preventScroll: true }) })
    }
    window.addEventListener('keydown', forwardKey, true)
    window.addEventListener('beforeinput', forwardInput, true)
    window.addEventListener('focusin', keepNativeFocus, true)
    let mode = () => { let state = cm.state.vim; host.dataset.mode = state?.insertMode ? 'INSERT' : state?.visualMode ? 'VISUAL' : 'NORMAL' }
    cm.on('vim-mode-change', mode); mode()
    Vim.defineEx('write', 'w', () => { void save().then(saved => { if (saved && !closing) { view.focus(); mode() } }) })
    Vim.defineEx('quit', 'q', () => queueMicrotask(() => close(false)))
    Vim.defineEx('wq', 'wq', () => queueMicrotask(() => close(true)))
    Vim.defineEx('xit', 'x', () => queueMicrotask(() => close(true)))
    root.addEventListener('keydown', event => {
      let key = event as KeyboardEvent
      if (!key.isTrusted && !forwardedKeys.has(key)) return
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
    root.addEventListener('focusout', () => {
      // Some search widgets blur their input after reacting to an edit. Keep
      // keyboard focus when that leaves the page body selected, while allowing
      // deliberate focus on another control and our native rich-text writes.
      queueMicrotask(() => {
        if (!closing && !nativeWrite && !root.activeElement && (document.activeElement === document.body || document.activeElement === field)) view.contentDOM.focus({ preventScroll: true })
      })
    })
    view.focus()
    requestAnimationFrame(() => { if (!closing && !nativeWrite && !root.activeElement) view.contentDOM.focus({ preventScroll: true }) })
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
