import type { BookmarkPluginContribution, BookmarkPluginValue } from './plugins'

export let matchesBookmarkPlugin = (patterns: string[], url: string) => patterns.some(pattern => {
  let expression = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${expression}$`).test(url)
})
export let bookmarkPluginValues = (definition: BookmarkPluginContribution, raw: unknown): Record<string, BookmarkPluginValue> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Plugin settings must be an object')
  let values = raw as Record<string, unknown>
  if (Object.keys(values).some(key => !definition.controls.some(control => control.name === key))) throw new Error('Unknown plugin setting')
  return Object.fromEntries(definition.controls.map(control => {
    let value = values[control.name] ?? control.default
    if (control.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < (control.min ?? -Infinity) || value > (control.max ?? Infinity) || (control.step !== undefined && Math.abs((value - (control.min ?? 0)) / control.step - Math.round((value - (control.min ?? 0)) / control.step)) > 1e-8))) throw new Error('Invalid numeric plugin setting')
    if (control.kind === 'boolean' && typeof value !== 'boolean') throw new Error('Invalid boolean plugin setting')
    if (['text', 'choice'].includes(control.kind) && (typeof value !== 'string' || value.length > 2048 || (control.kind === 'choice' && !control.choices?.includes(value)))) throw new Error('Invalid text plugin setting')
    return [control.name, value as BookmarkPluginValue]
  }))
}
