import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, stringify } from 'yaml'
import type { BookmarkParameterSettings, BookmarkParameters } from '../shared/types'
import { writeAtomic } from './store'

export let bookmarkParametersPath = (configFile: string) => path.join(path.dirname(configFile), 'bookmark-parameters.yaml')

let isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
let validParameters = (value: unknown): value is BookmarkParameters => isRecord(value)
  && Object.keys(value).every(key => ['values', 'hidden'].includes(key))
  && isRecord(value.values) && Object.values(value.values).every(item => typeof item === 'string')
  && Array.isArray(value.hidden) && value.hidden.every((item: unknown) => typeof item === 'string')

export let readBookmarkParameters = (file: string): BookmarkParameterSettings => {
  if (!fs.existsSync(file)) return {}
  let document = parseDocument(fs.readFileSync(file, 'utf8'), { uniqueKeys: true })
  if (document.errors.length) throw new Error('Invalid YAML in bookmark parameters file')
  let data = document.toJS({ maxAliasCount: 30 })
  if (!isRecord(data) || !isRecord(data.profiles) || Object.keys(data).some(key => key !== 'profiles')
    || Object.values(data.profiles).some(profile => !isRecord(profile) || Object.values(profile).some(settings => !validParameters(settings)))) throw new Error('Invalid bookmark parameters file')
  return data.profiles as BookmarkParameterSettings
}

export let writeBookmarkParameters = (file: string, settings: BookmarkParameterSettings) => writeAtomic(file, stringify({ profiles: settings }))
