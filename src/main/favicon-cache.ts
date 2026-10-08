import fs from 'node:fs'
import path from 'node:path'

let MAX_ICONS = 128
let MAX_ICON_LENGTH = 180000
let validIcon = (icon: unknown): icon is string => typeof icon === 'string' && icon.length <= MAX_ICON_LENGTH && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:;[^,]*)?,/i.test(icon)
let siteKey = (profileId: string, url: string) => {
  try {
    let parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? `${profileId}\n${parsed.origin}` : undefined
  } catch { return undefined }
}

export let createFaviconCache = (directory: string) => {
  let file = path.join(directory, 'favicons.json')
  let stored = new Map<string, string>()
  let privateIcons = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let entries = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(entries)) for (let entry of entries.slice(-MAX_ICONS)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && validIcon(entry[1])) stored.set(entry[0], entry[1])
    }
  } catch { /* An empty or damaged cache can be rebuilt from page icons. */ }
  let flush = () => {
    clearTimeout(timer)
    timer = undefined
    try {
      let temporary = `${file}.tmp`
      fs.writeFileSync(temporary, JSON.stringify([...stored]), { mode: 0o600 })
      fs.renameSync(temporary, file)
    } catch { /* Favicon persistence must not interrupt browsing. */ }
  }
  let get = (profileId: string, url: string, privateSessionId?: string) => {
    let key = siteKey(profileId, url)
    return key ? (privateSessionId ? privateIcons : stored).get(privateSessionId ? `${privateSessionId}\n${key}` : key) : undefined
  }
  let set = (profileId: string, url: string, icon: string, privateSessionId?: string) => {
    let key = siteKey(profileId, url)
    if (!key || !validIcon(icon)) return
    let target = privateSessionId ? privateIcons : stored
    key = privateSessionId ? `${privateSessionId}\n${key}` : key
    if (target.get(key) === icon) return
    target.delete(key)
    target.set(key, icon)
    while (target.size > MAX_ICONS) target.delete(target.keys().next().value!)
    if (!privateSessionId) { clearTimeout(timer); timer = setTimeout(flush, 250) }
  }
  return { get, set, close: () => { if (timer) flush(); privateIcons.clear() } }
}
