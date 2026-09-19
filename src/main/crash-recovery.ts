import fs from 'node:fs'
import path from 'node:path'
import type { Model } from '../shared/types'
import { removePane, removeSession, repairClientSelections, walkPanes } from './model'
import { writeAtomic } from './store'

type NavigationMarker = { version: 2; paneId: string; tabId: string; url: string }
type RunMarker = { version: 1; recovery: boolean }

let markerPath = (directory: string) => path.join(directory, 'navigation-crash.json')
let runMarkerPath = (directory: string) => path.join(directory, 'browser-run.json')

let readMarker = (file: string): NavigationMarker | undefined => {
  try {
    let value = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<NavigationMarker>
    if (value.version === 2 && typeof value.paneId === 'string' && typeof value.tabId === 'string' && typeof value.url === 'string') return value as NavigationMarker
  } catch { /* Missing and invalid markers are not recoverable. */ }
  return undefined
}

let removeMarker = (file: string) => {
  try { fs.unlinkSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

let pageName = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, '') || 'a page' } catch { return 'a page' }
}

export let recoverNavigationCrash = (directory: string, model: Model) => {
  let file = markerPath(directory)
  let marker = readMarker(file)
  removeMarker(file)
  if (!marker) return undefined
  let found = walkPanes(model).find(({ pane }) => pane.id === marker.paneId && pane.tabs.some(tab => tab.id === marker.tabId))
  if (!found) return undefined
  let { session, window, pane } = found
  if (window.panes.length > 1) {
    window.layout = removePane(window.layout, pane.id)
    window.floating = window.floating?.filter(item => item.paneId !== pane.id)
    window.panes = window.panes.filter(item => item.id !== pane.id)
  } else if (session.windows.length > 1) session.windows = session.windows.filter(item => item.id !== window.id)
  else removeSession(model, session)
  repairClientSelections(model)
  return `Removed a pane after ${pageName(marker.url)} crashed bmux during navigation.`
}

export let createNavigationCrashMarker = (directory: string) => {
  let file = markerPath(directory)
  let current: NavigationMarker | undefined
  return {
    mark: (paneId: string, tabId: string, url: string) => {
      if (url === 'about:blank') return
      current = { version: 2, paneId, tabId, url }
      writeAtomic(file, JSON.stringify(current))
    },
    clear: (tabId: string, url?: string) => {
      if (current?.tabId !== tabId || (url !== undefined && current.url !== url)) return
      current = undefined
      removeMarker(file)
    },
    close: () => { current = undefined; removeMarker(file) },
  }
}

export let createSerialNavigationQueue = () => {
  let tail = Promise.resolve()
  return <T>(operation: () => Promise<T>) => {
    let result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

let readRunMarker = (file: string): RunMarker | undefined => {
  try {
    let value = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RunMarker>
    if (value.version === 1 && typeof value.recovery === 'boolean') return value as RunMarker
  } catch { /* A missing marker means the previous run shut down cleanly. */ }
  return undefined
}

export let startNavigationCrashRecovery = (directory: string, model: Model) => {
  let runFile = runMarkerPath(directory)
  let previous = readRunMarker(runFile)
  let startupNotice = previous?.recovery ? recoverNavigationCrash(directory, model) : undefined
  if (!previous?.recovery) removeMarker(markerPath(directory))
  let serializeRestores = previous?.recovery === false
  writeAtomic(runFile, JSON.stringify({ version: 1, recovery: serializeRestores } satisfies RunMarker))
  let marker = createNavigationCrashMarker(directory)
  return {
    marker,
    serializeRestores,
    startupNotice,
    close: () => { marker.close(); removeMarker(runFile) },
  }
}
