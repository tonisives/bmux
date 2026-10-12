import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { getCM, vim, Vim } from '@replit/codemirror-vim'
import { readField, textField, writeField } from './field'
import type { TextField } from './field'
import { createFieldHints } from './hints'
import css from './editor.css?inline'

type PageVim = { configure: (enabled: boolean, shortcut: string) => void }
let scope = globalThis as typeof globalThis & { bmuxPageVim?: PageVim }

let install = (): PageVim => {
  let enabled = true, active: { host: HTMLElement; close: (save: boolean) => void } | undefined
  let open = (field: TextField) => {
    if (!enabled || active) return
    hints.hide()
    let original = readField(field), host = document.createElement('div')
    host.dataset.bmuxVim = 'true'
    host.popover = 'manual'
    host.setAttribute('role', 'dialog')
    host.setAttribute('aria-label', 'Vim editor')
    host.style.cssText = 'position:fixed;margin:0;padding:0;border:0;background:transparent;overflow:visible;'
    let root = host.attachShadow({ mode: 'open' }), sheet = new CSSStyleSheet()
    sheet.replaceSync(css); root.adoptedStyleSheets = [sheet]
    let shell = document.createElement('div'), container = document.createElement('div'), footer = document.createElement('div'), status = document.createElement('span')
    shell.className = 'shell'; container.className = 'editor'; footer.className = 'footer'; status.className = 'status'
    footer.append(status)
    shell.append(container, footer); root.append(shell)
    document.documentElement.append(host); host.showPopover()
    let position = () => {
      let rect = field.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 360), window.innerWidth - 16), height = Math.min(Math.max(rect.height, 220), window.innerHeight - 16)
      host.style.width = `${width}px`; host.style.height = `${height}px`
      host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
      host.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`
    }
    position()
    let cursor = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.selectionStart ?? 0 : original.length
    let view = new EditorView({
      parent: container, root,
      state: EditorState.create({ doc: original, selection: { anchor: cursor }, extensions: [
        vim(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), lineNumbers(), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Vim text' }),
        EditorView.theme({ '&': { backgroundColor: '#181818', color: '#eee' }, '.cm-gutters': { backgroundColor: '#181818', color: '#888', border: 'none' }, '.cm-cursor': { borderLeftColor: '#eee' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#555' } }, { dark: true }),
      ] }),
    })
    let closing = false
    let save = () => {
      if (readField(field) !== original) { status.textContent = 'Field changed on the page. Copy your draft or discard.'; return false }
      if (!writeField(field, view.state.doc.toString(), view.state.selection.main.head)) { status.textContent = 'Could not update this field. Copy your draft or discard.'; view.focus(); return false }
      original = readField(field)
      return true
    }
    let close = (commit: boolean) => {
      if (closing || commit && !save()) return
      closing = true; active = undefined
      observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true)
      view.destroy(); host.remove(); hints.refresh()
      if (field.isConnected) field.focus({ preventScroll: true })
    }
    active = { host, close }
    let observer = new MutationObserver(() => {
      if (!host.isConnected) { close(false); return }
      let message = 'Field no longer available. Copy your draft or discard.'
      if (!field.isConnected && status.textContent !== message) status.textContent = message
    })
    observer.observe(document, { subtree: true, childList: true })
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true)
    for (let [label, commit] of [['Save', true], ['Discard', false]] as const) {
      let button = document.createElement('button')
      button.textContent = label; button.type = 'button'; button.addEventListener('click', () => close(commit)); footer.append(button)
    }
    let cm = getCM(view)!
    let mode = () => { let state = cm.state.vim; host.dataset.mode = state?.insertMode ? 'INSERT' : state?.visualMode ? 'VISUAL' : 'NORMAL'; status.textContent = `${host.dataset.mode}  :wq / :q` }
    cm.on('vim-mode-change', mode); mode()
    Vim.defineEx('write', 'w', () => { if (save()) { view.focus(); mode() } })
    Vim.defineEx('quit', 'q', () => queueMicrotask(() => close(false)))
    Vim.defineEx('wq', 'wq', () => queueMicrotask(() => close(true)))
    Vim.defineEx('xit', 'x', () => queueMicrotask(() => close(true)))
    root.addEventListener('keydown', event => {
      let key = event as KeyboardEvent
      if (key.key === 'Escape' && !key.isComposing && !cm.state.vim?.insertMode && !cm.state.vim?.visualMode && !root.querySelector('.cm-panel input')) {
        key.preventDefault(); key.stopImmediatePropagation(); close(true)
      }
    }, true)
    for (let type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, event => event.stopPropagation())
    view.focus()
  }
  let hints = createFieldHints(open)
  window.addEventListener('bmux:vim-editor', () => {
    if (!enabled || active || !document.hasFocus()) return
    let element = document.activeElement
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
    let field = textField(element)
    if (field) open(field)
  })
  return { configure: (value, shortcut) => {
    enabled = value
    if (!enabled) active?.close(true)
    hints.configure(enabled && !active, shortcut)
  } }
}

if (!scope.bmuxPageVim) scope.bmuxPageVim = install()
