export type DarkMode = 'off' | 'dark' | 'system'
export type SiteSettings = { adblock?: boolean; darkMode?: DarkMode }
export type ProfileTools = SiteSettings & { sites: Record<string, SiteSettings> }
export type UserScript = { id: string; name: string; file: string; enabled: boolean; matches: string[]; exclude: string[]; profiles: string[]; runAt: 'document-start' | 'document-end'; kind: 'js' | 'css' }
export type BrowserSettings = {
  adblock: boolean
  darkMode: DarkMode
  autoUpdateFilters: boolean
  rules: string[]
  profiles: Record<string, ProfileTools>
  userscripts: UserScript[]
}
export type BlockedRequest = { host: string; type: string; time: number }
export type BrowserToolsState = {
  defaults: Required<SiteSettings>
  filters: { updatedAt: number; updating: boolean; error?: string; network: number; cosmetic: number }
  tabs: Record<string, { origin: string; adblock: boolean; darkMode: DarkMode; profileDefaults: Required<SiteSettings>; error?: string; blocked: number; recent: BlockedRequest[] }>
  scripts: { id: string; name: string; enabled: boolean; error?: string }[]
}
export let DEFAULT_BROWSER: BrowserSettings = { adblock: true, darkMode: 'off', autoUpdateFilters: true, rules: [], profiles: {}, userscripts: [] }
export let pageOrigin = (url: string) => { try { let parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.origin : '' } catch { return '' } }
export let siteSettings = (settings: BrowserSettings, profileId: string, url: string): Required<SiteSettings> => {
  let profile = settings.profiles[profileId], site = profile?.sites[pageOrigin(url)]
  return { adblock: site?.adblock ?? profile?.adblock ?? settings.adblock, darkMode: site?.darkMode ?? profile?.darkMode ?? settings.darkMode }
}
// Match the complete URL so a matching host cannot be used as an evil host's prefix.
export let matchesUrl = (pattern: string, url: string) => new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(url)
