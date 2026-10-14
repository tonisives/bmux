import type { TextField } from './field'

export let mountInlineEditor = (field: TextField, host: HTMLElement) => {
  let style = getComputedStyle(field), bounds = field.getBoundingClientRect()
  let display = field.style.getPropertyValue('display'), priority = field.style.getPropertyPriority('display'), hadStyle = field.hasAttribute('style')
  host.style.cssText = 'all:initial;display:block;position:static;box-sizing:border-box;min-width:0;max-width:100%;overflow:hidden;'
  for (let property of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'order', 'grid-area']) host.style.setProperty(property, style.getPropertyValue(property))
  if (field.hasAttribute('slot')) host.slot = field.slot
  host.style.colorScheme = style.colorScheme
  host.style.width = `${bounds.width}px`
  host.style.height = `${Math.max(bounds.height, field instanceof HTMLInputElement ? 84 : 160)}px`
  host.style.setProperty('--field-color', style.color)
  let background = style.backgroundColor, parent = field.parentElement
  while ((!background || background === 'rgba(0, 0, 0, 0)' || background === 'transparent') && parent) { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement }
  host.style.setProperty('--field-background', !background || background === 'rgba(0, 0, 0, 0)' || background === 'transparent' ? 'Canvas' : background)
  host.style.setProperty('--field-border', style.borderTopColor)
  let showField = () => {
    if (display) field.style.setProperty('display', display, priority)
    else field.style.removeProperty('display')
    if (!hadStyle && !field.style.length) field.removeAttribute('style')
  }
  let hideField = () => field.style.setProperty('display', 'none', 'important')
  field.after(host); hideField()
  return {
    write: (save: () => boolean) => {
      // Native rich-text editing needs the original field to be rendered/focused.
      // Swap synchronously so :w can update its framework model and stay inline.
      host.style.display = 'none'; showField()
      try { return save() }
      finally { hideField(); host.style.display = 'block' }
    },
    restore: () => { showField(); host.remove() },
    retain: () => {
      if (host.isConnected) return
      if (field.isConnected) field.after(host)
      else (document.body ?? document.documentElement).append(host)
    },
  }
}
