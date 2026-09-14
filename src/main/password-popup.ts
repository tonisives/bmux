import type { FieldBounds, PasswordSuggestions } from '../shared/types'

export let passwordPopupBounds = (page: FieldBounds, suggestion: PasswordSuggestions, zoom: number): FieldBounds => {
  let field = suggestion.anchor
  let width = Math.min(page.width, Math.max(280, Math.min(360, field.width * zoom)))
  let desiredHeight = suggestion.locked ? suggestion.expanded ? 246 : 96 : suggestion.busy || suggestion.message || !suggestion.items.length ? 148 : 76 + Math.min(5, suggestion.items.length) * 54
  let top = Math.max(0, Math.min(page.height, field.y * zoom)), bottom = Math.max(0, Math.min(page.height, (field.y + field.height) * zoom))
  let below = Math.max(0, page.height - bottom - 6), above = Math.max(0, top - 6)
  let useBelow = below >= desiredHeight || below >= above
  let height = Math.min(desiredHeight, useBelow ? below : above)
  return { x: Math.round(page.x + Math.max(0, Math.min(field.x * zoom, page.width - width))), y: Math.round(page.y + (useBelow ? bottom + 6 : top - height - 6)), width: Math.round(width), height: Math.max(1, Math.round(height)) }
}
