import { parseDocument } from 'yaml'
import type { PluginAction, PluginCapability, PluginHook, PluginManifest, PluginParameter } from '../shared/plugins'

let object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a mapping')
  return value as Record<string, unknown>
}
let text = (value: unknown) => { if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Expected a nonempty string'); return value }
let identifier = (value: unknown) => { let result = text(value); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(result)) throw new Error('Invalid identifier'); return result }
let strings = (value: unknown): string[] => { if (!Array.isArray(value) || value.length > 1000) throw new Error('Expected a string list'); return value.map(text) }
let capabilities = new Set<PluginCapability>(['browser.forms', 'browser.read', 'browser.write', 'browser.manage', 'browser.cdp', 'ui'])
let parameter = (raw: unknown): PluginParameter => {
  let value = object(raw), kind = value.kind as PluginParameter['kind']
  if (!['text', 'password', 'boolean', 'choice'].includes(kind)) throw new Error('Unknown parameter kind')
  if (value.required !== undefined && typeof value.required !== 'boolean') throw new Error('required must be boolean')
  let choices = kind === 'choice' ? strings(value.choices) : undefined
  if (choices && (!choices.length || new Set(choices).size !== choices.length)) throw new Error('Choices must be nonempty and unique')
  return { name: identifier(value.name), title: text(value.title), kind, required: value.required === true, choices }
}
let action = (raw: unknown): PluginAction => {
  let value = object(raw), command = strings(value.command), allowed = strings(value.capabilities ?? []) as PluginCapability[]
  if (!command.length || allowed.some(item => !capabilities.has(item))) throw new Error('Invalid command or capability')
  let timeout = value.timeout_seconds ?? 120
  if (!Number.isInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 3600) throw new Error('timeout_seconds must be 1–3600')
  if (value.parameters !== undefined && !Array.isArray(value.parameters)) throw new Error('parameters must be a list')
  let parameters = ((value.parameters ?? []) as unknown[]).map(parameter)
  if (new Set(parameters.map(item => item.name)).size !== parameters.length) throw new Error('Duplicate parameter')
  return { id: identifier(value.id), title: text(value.title), description: value.description === undefined ? undefined : text(value.description), command, capabilities: allowed, timeout_seconds: Number(timeout), parameters }
}
export let parsePluginManifest = (source: string): PluginManifest => {
  if (source.length > 262144) throw new Error('Manifest too large')
  let document = parseDocument(source)
  if (document.errors.length) throw new Error('Invalid manifest YAML')
  let value = object(document.toJS({ maxAliasCount: 30 }))
  if (value.schema_version !== 1) throw new Error('Unsupported plugin schema_version (expected 1)')
  if ((value.actions !== undefined && !Array.isArray(value.actions)) || (value.hooks !== undefined && !Array.isArray(value.hooks))) throw new Error('Actions and hooks must be lists')
  let actions = ((value.actions ?? []) as unknown[]).map(action)
  let hooks = ((value.hooks ?? []) as unknown[]).map((raw): PluginHook => {
    let value = object(raw), base = action(raw), event = value.event as PluginHook['event']
    if (!['startup', 'page-ready', 'url-change'].includes(event)) throw new Error('Unknown hook event')
    if (base.parameters.length) throw new Error('Hooks cannot have interactive parameters')
    let matches = event === 'startup' ? undefined : strings(value.matches)
    if (matches && (!matches.length || matches.some(pattern => !/^(https?:\/\/|file:\/\/)/.test(pattern)))) throw new Error('Page hooks require URL patterns')
    return { ...base, event, matches, profiles: value.profiles === undefined ? undefined : strings(value.profiles) }
  })
  let all = [...actions, ...hooks]
  if (all.length > 100 || new Set(all.map(item => item.id)).size !== all.length) throw new Error('Too many or duplicate actions/hooks')
  return { schema_version: 1, id: identifier(value.id), name: text(value.name), version: text(value.version), actions, hooks }
}
export let matchesPluginUrl = (pattern: string, url: string) => {
  let expression = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${expression}$`).test(url)
}
