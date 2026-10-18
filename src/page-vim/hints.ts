import { textField } from './field'
import type { TextField } from './field'

export let createFieldHints = (open: (field: TextField) => void) => {
  let enabled = false, shortcut = '', pending = false
  let host = document.createElement('div')
  host.dataset.bmuxVimHints = 'true'
  // Passive field controls must not compete with password managers for the top layer.
  host.style.cssText = 'all:initial;position:fixed;inset:0;margin:0;border:0;padding:0;width:100%;height:100%;background:transparent;pointer-events:none;overflow:visible;z-index:2147483646;'
  let root = host.attachShadow({ mode: 'open' }), sheet = new CSSStyleSheet()
  // Shadow DOM isolates page styles; a broad reset confuses Dark Reader's color conversion.
  sheet.replaceSync(':host{color-scheme:dark}button{appearance:none;position:fixed;box-sizing:border-box;margin:0;font:11px/18px ui-monospace,monospace;color:#25313b;background:transparent;border:0;padding:0 4px;cursor:pointer;pointer-events:auto;opacity:.8}button:hover{opacity:1}button:focus-visible{outline:2px solid #aaa;opacity:1}')
  root.adoptedStyleSheets = [sheet]
  let buttons = new Map<TextField, HTMLButtonElement>()
  let hide = () => host.remove()
  let observer = new MutationObserver(() => refresh())
  let refresh = () => {
    if (pending || !enabled) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      if (!enabled) return
      observer.disconnect()
      let roots: (Document | ShadowRoot)[] = [document], fields = new Set<TextField>(), container = document.documentElement
      for (let index = 0; index < roots.length; index++) {
        let current = roots[index]
        observer.observe(current, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'contenteditable', 'aria-disabled', 'aria-readonly', 'hidden', 'class', 'style', 'type', 'maxlength', 'autocomplete', 'inputmode'] })
        for (let element of current.querySelectorAll('*')) {
          if (element.hasAttribute('data-bmux-vim') || element === host) continue
          if (element.shadowRoot) roots.push(element.shadowRoot)
        }
        for (let element of current.querySelectorAll('input,textarea,[contenteditable]')) {
          let field = textField(element)
          if (!field || fields.has(field) || !field.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
          let rect = field.getBoundingClientRect()
          if (rect.width < 48 || rect.height < 20 || rect.right <= 0 || rect.left >= innerWidth || rect.bottom <= 0 || rect.top >= innerHeight) continue
          let centerX = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2, centerY = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2
          let hit = current.elementFromPoint(centerX, centerY)
          if (hit && !field.contains(hit) && hit !== host) continue
          fields.add(field)
          // A modal's ordinary descendants remain interactive inside its top layer.
          let topLayer = field.closest<HTMLElement>(':modal, :popover-open')
          if (topLayer) container = topLayer
          let button = buttons.get(field)
          if (!button) {
            button = document.createElement('button'); button.type = 'button'; button.textContent = 'v'
            button.addEventListener('mousedown', event => event.preventDefault())
            button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(field) })
            buttons.set(field, button); root.append(button)
          }
          button.setAttribute('aria-label', 'Edit with Vim')
          if (field.id) button.setAttribute('aria-controls', field.id)
          button.title = shortcut ? `Edit with Vim (${shortcut})` : 'Edit with Vim'
          button.style.left = `${Math.max(0, Math.min(rect.right, innerWidth) - 18)}px`
          button.style.top = `${Math.max(0, rect.top)}px`
        }
      }
      for (let [field, button] of buttons) if (!fields.has(field)) { button.remove(); buttons.delete(field) }
      if (fields.size && host.parentElement !== container) container.append(host)
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
