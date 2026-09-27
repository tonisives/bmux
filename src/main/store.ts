import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { initialModel, newSession, validateModel } from './model'
import { updateBookmark } from './bookmarks'
import type { Bookmark, Model } from '../shared/types'
import { compactHistory } from '../shared/history'

export let bookmarksPath = (configFile: string) => path.join(path.dirname(configFile), 'bookmarks.yaml')
export let pendingBookmarkEditsPath = (bookmarkFile: string) => path.join(path.dirname(bookmarkFile), 'bookmark-edits.pending.json')
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

export let writeAtomic = (file: string, content: string) => {
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
  let source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
  let parsed = source === undefined ? undefined : JSON.parse(source)
  let upgraded = parsed?.version === 1
  let model = parsed === undefined ? initialModel() : validateModel(parsed)
  for (let profile of model.profiles) if (profile.history) profile.history = compactHistory(profile.history)
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
  let pendingFile = pendingBookmarkEditsPath(bookmarkFile)
  if (fs.existsSync(pendingFile)) {
    let pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8')) as { updates?: { profile?: unknown; bookmark?: unknown; title?: unknown }[] }
    if (!Array.isArray(pending.updates) || pending.updates.length > 100 || pending.updates.some(update => typeof update.profile !== 'string' || typeof update.bookmark !== 'string' || typeof update.title !== 'string' || !update.title.trim() || update.title.length > 200)) throw new Error('Invalid pending bookmark edits')
    for (let update of pending.updates) {
      let profile = model.profiles.find(profile => profile.id === update.profile)
      if (!profile) throw new Error('Pending bookmark profile not found')
      updateBookmark(profile, update.bookmark as string, { title: (update.title as string).trim() })
    }
    writeModel(directory, model, bookmarkFile)
    fs.unlinkSync(pendingFile)
  }
  if (upgraded) {
    let backup = `${file}.v1-backup`
    if (!fs.existsSync(backup)) writeAtomic(backup, source!)
    writeModel(directory, model, bookmarkFile)
  }
  return model
}
export let writeModel = (directory: string, model: Model, bookmarkFile = path.join(directory, 'bookmarks.yaml')) => {
  let profiles = bookmarkProfiles(model)
  // Leave hand-edited formatting and comments intact when only session state changed.
  if (!fs.existsSync(bookmarkFile) || JSON.stringify(parseBookmarks(fs.readFileSync(bookmarkFile, 'utf8'))) !== JSON.stringify(profiles)) writeAtomic(bookmarkFile, stringify({ profiles }))
  let sessions = model.sessions.filter(session => !session.private)
  if (!sessions.length) sessions = [newSession('main', model.profiles[0].id)]
  let sessionIds = new Set(sessions.map(session => session.id))
  let clients = model.clients.filter(client => sessionIds.has(client.sessionId)).map(client => ({ ...client, sessionHistory: client.sessionHistory?.filter(id => sessionIds.has(id)) }))
  let state: Model = { ...model, sessions, clients, profiles: model.profiles.map(({ bookmarks: _bookmarks, ...profile }) => profile) }
  writeAtomic(path.join(directory, 'state.json'), JSON.stringify(state, null, 2))
}
