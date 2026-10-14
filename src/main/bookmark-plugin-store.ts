import fs from 'node:fs'
import { parseDocument, stringify } from 'yaml'
import type { BookmarkPluginSettings } from '../shared/plugins'
import { writeAtomic } from './store'

let record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export let readBookmarkPlugins = (file: string): BookmarkPluginSettings => {
  if (!fs.existsSync(file)) return {}
  let document = parseDocument(fs.readFileSync(file, 'utf8'), { uniqueKeys: true })
  if (document.errors.length) throw new Error('Invalid bookmark plugins YAML')
  let data = document.toJS({ maxAliasCount: 30 })
  if (!record(data) || Object.keys(data).some(key => key !== 'profiles') || !record(data.profiles) || Object.values(data.profiles).some(profile => !record(profile) || Object.values(profile).some(attachments => !Array.isArray(attachments) || attachments.length > 32 || new Set(attachments.map(item => item?.id)).size !== attachments.length || attachments.some(item => !record(item) || Object.keys(item).some(key => !['id', 'enabled', 'values'].includes(key)) || typeof item.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(item.id) || typeof item.enabled !== 'boolean' || !record(item.values) || Object.values(item.values).some(value => !['string', 'boolean', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 2048)))))) throw new Error('Invalid bookmark plugins file')
  return data.profiles as BookmarkPluginSettings
}
export let writeBookmarkPlugins = (file: string, settings: BookmarkPluginSettings) => writeAtomic(file, stringify({ profiles: settings }))
