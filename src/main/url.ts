import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { searchUrl } from '../shared/search-app'
import type { SearchApp } from '../shared/search-app'

export let normalizeUrl = (value: string, searchApp: SearchApp = 'google') => {
  if (value === 'about:blank') return value
  if (/^(https?:|file:)/i.test(value)) return new URL(value).href
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^localhost:\d+/.test(value)) throw new Error('Only http, https, file and about:blank URLs are supported')
  let local = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value
  let candidates = path.isAbsolute(local) ? [local] : [path.resolve(local), path.resolve(os.homedir(), local)]
  let file = candidates.find(candidate => fs.existsSync(candidate))
  if (file) return pathToFileURL(file).href
  if (/^localhost(?::\d+)?(?:\/|$)/.test(value) || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value)) return new URL(`http://${value}`).href
  if (!/\s/.test(value) && value.includes('.')) return new URL(`https://${value}`).href
  return searchUrl(value, searchApp)
}
