import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { initialModel, validateModel } from './model'
import type { Bookmark, Model } from '../shared/types'

export let bookmarksPath = (configFile: string) => path.join(path.dirname(configFile), 'bookmarks.yaml')
let bookmarkProfiles = (model: Model) => Object.fromEntries(model.profiles.filter(profile => profile.bookmarks !== undefined).map(profile => [profile.id, profile.bookmarks]))

let parseBookmarks = (text: string): Record<string, Bookmark[]> => {
  let document = parseDocument(text, { uniqueKeys: true })
  if (document.errors.length) throw new Error('Invalid YAML in bookmarks file')
  let value = document.toJS({ maxAliasCount: 30 })
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles)) throw new Error('Bookmarks file must contain a profiles mapping')
  if (Object.keys(value).some(key => key !== 'profiles')) throw new Error('Unknown bookmarks file setting')
  let validate = (items: unknown, ids: Set<string>): items is Bookmark[] => Array.isArray(items) && items.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.title !== 'string') return false
    ids.add(item.id)
    return (typeof item.url === 'string') !== (Array.isArray(item.children))
      && (item.children === undefined || validate(item.children, ids))
      && Object.keys(item).every(key => ['id', 'title', 'url', 'children'].includes(key))
  })
  for (let items of Object.values(value.profiles)) if (!validate(items, new Set())) throw new Error('Invalid bookmarks in bookmarks file')
  return value.profiles as Record<string, Bookmark[]>
}

let writeAtomic = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  let temporary = `${file}.tmp`
  let fd = fs.openSync(temporary, 'w', 0o600)
  try {
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
}

export let readModel = (directory: string, bookmarkFile = path.join(directory, 'bookmarks.yaml')): Model => {
  let file = path.join(directory, 'state.json')
  // Never overwrite an unreadable state with an empty session.
  let model = fs.existsSync(file) ? validateModel(JSON.parse(fs.readFileSync(file, 'utf8'))) : initialModel()
  if (fs.existsSync(bookmarkFile)) {
    let profiles = parseBookmarks(fs.readFileSync(bookmarkFile, 'utf8'))
    for (let profileId of Object.keys(profiles)) if (!model.profiles.some(profile => profile.id === profileId)) throw new Error(`Unknown bookmark profile: ${profileId}`)
    for (let profile of model.profiles) {
      if (Object.hasOwn(profiles, profile.id)) profile.bookmarks = profiles[profile.id]
      else delete profile.bookmarks
    }
  } else if (model.profiles.some(profile => profile.bookmarks?.length)) {
    // Create the YAML copy before the next state save removes embedded bookmarks.
    writeAtomic(bookmarkFile, stringify({ profiles: bookmarkProfiles(model) }))
  }
  return model
}
export let writeModel = (directory: string, model: Model, bookmarkFile = path.join(directory, 'bookmarks.yaml')) => {
  let profiles = bookmarkProfiles(model)
  // Leave hand-edited formatting and comments intact when only session state changed.
  if (!fs.existsSync(bookmarkFile) || JSON.stringify(parseBookmarks(fs.readFileSync(bookmarkFile, 'utf8'))) !== JSON.stringify(profiles)) writeAtomic(bookmarkFile, stringify({ profiles }))
  let state: Model = { ...model, profiles: model.profiles.map(({ bookmarks: _bookmarks, ...profile }) => profile) }
  writeAtomic(path.join(directory, 'state.json'), JSON.stringify(state, null, 2))
}
