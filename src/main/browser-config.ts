import { DEFAULT_BROWSER, pageOrigin } from '../shared/browser-tools'
import type { BrowserSettings, DarkMode, ProfileTools, SiteSettings, UserScript } from '../shared/browser-tools'

let mapping = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Browser settings must be mappings')
  return value as Record<string, unknown>
}
let keys = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown browser setting') }
let boolean = (value: unknown, fallback: boolean) => { if (value === undefined) return fallback; if (typeof value !== 'boolean') throw new Error('Browser flags must be true or false'); return value }
let strings = (value: unknown, fallback: string[] = []): string[] => {
  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 4096)) throw new Error('Expected a list of nonempty strings')
  return value
}
let darkMode = (value: unknown): DarkMode => { if (!['off', 'dark', 'system'].includes(String(value))) throw new Error('darkMode must be off, dark, or system'); return value as DarkMode }
let site = (value: Record<string, unknown>): SiteSettings => ({ ...(value.adblock === undefined ? {} : { adblock: boolean(value.adblock, true) }), ...(value.darkMode === undefined ? {} : { darkMode: darkMode(value.darkMode) }) })
let patterns = (value: unknown) => {
  let result = strings(value)
  if (result.some(pattern => !/^https?:\/\/[^/]+\//.test(pattern))) throw new Error('Userscript matches need http(s) URL patterns including a path, such as https://example.com/*')
  return result
}
export let parseBrowserSettings = (raw: unknown): BrowserSettings => {
  if (raw === undefined) return structuredClone(DEFAULT_BROWSER)
  let value = mapping(raw)
  keys(value, ['adblock', 'darkMode', 'autoUpdateFilters', 'rules', 'profiles', 'userscripts'])
  let profiles: Record<string, ProfileTools> = {}
  for (let [id, rawProfile] of Object.entries(mapping(value.profiles ?? {}))) {
    if (!/^profile_[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Browser profile settings require a profile ID')
    let profile = mapping(rawProfile), sites: Record<string, SiteSettings> = {}
    keys(profile, ['adblock', 'darkMode', 'sites'])
    for (let [origin, rawSite] of Object.entries(mapping(profile.sites ?? {}))) {
      if (!pageOrigin(origin) || pageOrigin(origin) !== origin) throw new Error('Site keys must be exact origins without a trailing slash')
      let entry = mapping(rawSite); keys(entry, ['adblock', 'darkMode']); sites[origin] = site(entry)
    }
    profiles[id] = { ...site(profile), sites }
  }
  if (value.userscripts !== undefined && (!Array.isArray(value.userscripts) || value.userscripts.length > 100)) throw new Error('userscripts must be a list of at most 100 scripts')
  let userscripts = ((value.userscripts ?? []) as unknown[]).map((raw): UserScript => {
    let script = mapping(raw)
    keys(script, ['id', 'name', 'file', 'enabled', 'matches', 'exclude', 'profiles', 'runAt'])
    if (typeof script.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(script.id)) throw new Error('Userscript needs a unique id')
    if (typeof script.file !== 'string' || !/\.(js|css)$/.test(script.file) || script.file.length > 4096) throw new Error('Userscript file must end in .js or .css')
    if (script.name !== undefined && (typeof script.name !== 'string' || !script.name.trim() || script.name.length > 200)) throw new Error('Invalid userscript name')
    let matches = patterns(script.matches)
    if (!matches.length) throw new Error('Userscripts require explicit URL matches')
    let runAt = script.runAt ?? 'document-end'
    if (runAt !== 'document-start' && runAt !== 'document-end') throw new Error('runAt must be document-start or document-end')
    return { id: script.id, name: String(script.name ?? script.id), file: script.file, enabled: boolean(script.enabled, false), matches, exclude: patterns(script.exclude), profiles: strings(script.profiles), runAt, kind: script.file.endsWith('.css') ? 'css' : 'js' }
  })
  if (new Set(userscripts.map(script => script.id)).size !== userscripts.length) throw new Error('Duplicate userscript id')
  return { adblock: boolean(value.adblock, true), darkMode: value.darkMode === undefined ? 'off' : darkMode(value.darkMode), autoUpdateFilters: boolean(value.autoUpdateFilters, true), rules: strings(value.rules), profiles, userscripts }
}
