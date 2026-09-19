import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNavigationCrashMarker, recoverNavigationCrash } from '../src/main/crash-recovery'
import { id, initialModel, newPane } from '../src/main/model'

let directories: string[] = []
let directory = () => {
  let value = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-crash-recovery-'))
  directories.push(value)
  return value
}

afterEach(() => {
  for (let value of directories) fs.rmSync(value, { recursive: true, force: true })
  directories = []
})

it('removes the pane whose navigation was interrupted by an application crash', () => {
  let dataDirectory = directory(), model = initialModel(), session = model.sessions[0], window = session.windows[0]
  let retained = window.panes[0], crashed = newPane(session.defaultProfileId, 'https://chromewebstore.google.com/detail/example')
  window.panes.push(crashed)
  window.layout = { kind: 'split', id: id('split'), axis: 'horizontal', ratio: 0.5, first: { kind: 'pane', paneId: retained.id }, second: { kind: 'pane', paneId: crashed.id } }
  model.clients.push({ id: id('client'), sessionId: session.id, windowId: window.id, paneId: crashed.id, zoomedPaneId: crashed.id, width: 900, height: 700 })
  createNavigationCrashMarker(dataDirectory).mark(crashed.id, crashed.activeTabId, crashed.tabs[0].url)

  expect(recoverNavigationCrash(dataDirectory, model)).toBe('Removed a pane after chromewebstore.google.com crashed bmux during navigation.')
  expect(window.panes.map(pane => pane.id)).toEqual([retained.id])
  expect(window.layout).toEqual({ kind: 'pane', paneId: retained.id })
  expect(model.clients[0].paneId).toBe(retained.id)
  expect(model.clients[0].zoomedPaneId).toBeNull()
  expect(recoverNavigationCrash(dataDirectory, model)).toBeUndefined()
})

it('replaces the final pane with a blank session and ignores clean navigation state', () => {
  let dataDirectory = directory(), model = initialModel(), pane = model.sessions[0].windows[0].panes[0], originalSession = model.sessions[0].id
  let marker = createNavigationCrashMarker(dataDirectory)
  marker.mark(pane.id, pane.activeTabId, 'https://example.com/failing')
  marker.close()
  expect(recoverNavigationCrash(dataDirectory, model)).toBeUndefined()

  marker.mark(pane.id, pane.activeTabId, 'https://example.com/failing')
  expect(recoverNavigationCrash(dataDirectory, model)).toBe('Removed a pane after example.com crashed bmux during navigation.')
  expect(model.sessions[0].id).not.toBe(originalSession)
  expect(model.sessions[0].windows[0].panes[0].tabs[0].url).toBe('about:blank')
})
