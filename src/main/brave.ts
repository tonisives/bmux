import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Bookmark, Model, Profile } from '../shared/types'
import { id, newSession } from './model'

export let braveDirectory = () => path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
let readJson = (file: string): any => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new Error('Could not read Brave profile metadata or bookmarks; no profiles were imported') }
}
type ImportedProfile = { directory: string; name: string; bookmarks: Bookmark[]; count: number }

let parseBookmark = (value: unknown, key: string): Bookmark => {
  let node = value as Record<string, unknown>
  if (!node || typeof node.name !== 'string') throw new Error('Invalid Brave bookmark entry')
  let bookmark: Bookmark = { id: key, title: node.name }
  if (node.type === 'url' && typeof node.url === 'string') bookmark.url = node.url
  else if (node.type === 'folder' && Array.isArray(node.children)) bookmark.children = node.children.map((child, index) => parseBookmark(child, `${key}/${index}`))
  else throw new Error('Invalid Brave bookmark type')
  return bookmark
}
export let countBookmarks = (nodes: Bookmark[]): number => nodes.reduce((sum, node) => sum + (node.url !== undefined ? 1 : countBookmarks(node.children ?? [])), 0)

export let readBraveProfiles = (directory: string): ImportedProfile[] => {
  let local = readJson(path.join(directory, 'Local State'))
  let cache = local?.profile?.info_cache
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) throw new Error('Brave profile list is missing')
  return Object.entries(cache).map(([folder, value]) => {
    if (!/^(Default|Profile \d+)$/.test(folder)) throw new Error('Unsupported Brave profile directory')
    let info = value as { name?: string }
    let file = path.join(directory, folder, 'Bookmarks')
    let bookmarks: Bookmark[] = []
    if (fs.existsSync(file)) {
      let data = readJson(file)
      if (!data.roots || typeof data.roots !== 'object' || Array.isArray(data.roots)) throw new Error('Brave bookmark roots are missing')
      bookmarks = Object.entries(data.roots).map(([key, node]) => parseBookmark(node, key))
    }
    return { directory: folder, name: typeof info?.name === 'string' && info.name.trim() ? info.name.trim() : folder, bookmarks, count: countBookmarks(bookmarks) }
  })
}
let uniqueName = (name: string, items: { name: string }[]) => {
  let candidate = name
  let index = 1
  while (items.some(item => item.name === candidate)) candidate = `${name} (Brave${index++ > 1 ? ` ${index - 1}` : ''})`
  return candidate
}

export let importBrave = (current: Model, directory = braveDirectory()) => {
  let source = fs.realpathSync(directory)
  // Parse every source before creating anything; unreadable data aborts the import.
  let imported = readBraveProfiles(source)
  let model = structuredClone(current)
  let reports = imported.map(item => {
    let profile = model.profiles.find(profile => profile.braveSource?.root === source && profile.braveSource.directory === item.directory)
    let created = !profile
    if (!profile) {
      profile = { id: id('profile'), name: uniqueName(item.name, model.profiles), background: /^bot$/i.test(item.name), braveSource: { root: source, directory: item.directory } } satisfies Profile
      model.profiles.push(profile)
      model.sessions.push(newSession(uniqueName(profile.name, model.sessions), profile.id))
    }
    profile.bookmarks = item.bookmarks
    return { profileId: profile.id, name: profile.name, sourceDirectory: item.directory, bookmarks: item.count, created }
  })
  return { model, profiles: reports }
}
