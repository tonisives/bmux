import { textField } from './field'
import type { TextField } from './field'

export let createFieldHints = (open: (field: TextField) => void) => {
  let enabled = false, shortcut = '', pending = false
  let host = document.createElement('div')
  host.dataset.bmuxVimHints = 'true'; host.popover = 'manual'
  host.style.cssText = 'all:initial;position:fixed;inset:0;margin:0;border:0;padding:0;width:100%;height:100%;background:transparent;pointer-events:none;overflow:visible;'
  let root = host.attachShadow({ mode: 'open' }), sheet = new CSSStyleSheet()
  sheet.replaceSync(':host{color-scheme:dark}button{all:initial;position:fixed;box-sizing:border-box;font:11px/18px ui-monospace,monospace;color:#ddd;background:#222;border:1px solid #666;padding:0 4px;cursor:pointer;pointer-events:auto}button:hover{background:#444}button:focus-visible{outline:2px solid #aaa}')
  root.adoptedStyleSheets = [sheet]
  let buttons = new Map<TextField, HTMLButtonElement>()
  let hide = () => { if (host.isConnected) host.hidePopover(); host.remove() }
  let observer = new MutationObserver(() => refresh())
  let refresh = () => {
    if (pending || !enabled) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      if (!enabled) return
      observer.disconnect()
      let roots: (Document | ShadowRoot)[] = [document], fields = new Set<TextField>()
      for (let index = 0; index < roots.length; index++) {
        let current = roots[index]
        observer.observe(current, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'contenteditable', 'aria-disabled', 'aria-readonly', 'hidden', 'class', 'style', 'type'] })
        for (let element of current.querySelectorAll('*')) {
          if (element.hasAttribute('data-bmux-vim') || element === host) continue
          if (element.shadowRoot) roots.push(element.shadowRoot)
        }
        for (let element of current.querySelectorAll('input,textarea,[contenteditable]')) {
          let field = textField(element)
          if (!field || fields.has(field) || !field.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
          let rect = field.getBoundingClientRect()
          if (rect.width < 48 || rect.height < 20 || rect.right <= 0 || rect.left >= innerWidth || rect.bottom <= 0 || rect.top >= innerHeight) continue
          fields.add(field)
          let button = buttons.get(field)
          if (!button) {
            button = document.createElement('button'); button.type = 'button'; button.textContent = 'Vim'
            button.addEventListener('mousedown', event => event.preventDefault())
            button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(field) })
            buttons.set(field, button); root.append(button)
          }
          button.setAttribute('aria-label', 'Edit with Vim')
          if (field.id) button.setAttribute('aria-controls', field.id)
          button.title = shortcut ? `Edit with Vim (${shortcut})` : 'Edit with Vim'
          button.style.left = `${Math.max(0, Math.min(rect.right, innerWidth) - 36)}px`
          button.style.top = `${Math.max(0, rect.top)}px`
        }
      }
      for (let [field, button] of buttons) if (!fields.has(field)) { button.remove(); buttons.delete(field) }
      if (fields.size && !host.isConnected) { document.documentElement.append(host); host.showPopover() }
      if (!fields.size) hide()
    })
  }
  // Catch layout changes and newly attached shadow roots without modifying fields.
  let timer: ReturnType<typeof setInterval> | undefined
  window.addEventListener('scroll', refresh, true); window.addEventListener('resize', refresh)
  return {
    hide: () => { enabled = false; observer.disconnect(); hide(); if (timer) clearInterval(timer); timer = undefined },
    refresh: () => { enabled = true; refresh(); timer ??= setInterval(refresh, 1000) },
    configure: (value: boolean, binding: string) => {
      enabled = value; shortcut = binding
      if (enabled) { refresh(); timer ??= setInterval(refresh, 1000) }
      else { observer.disconnect(); hide(); if (timer) clearInterval(timer); timer = undefined }
    },
  }
}
